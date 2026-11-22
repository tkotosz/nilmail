// Walks through sorting in Chrome at phone width, against a fake Gmail (see fake-gmail.ts); the Worker's sign-in routes
// have their own unit tests. Run with `npm run test:e2e`. Set NILMAIL_CHROME to use a browser other than Chrome.
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { after, before, test } from 'node:test';
import { chromium, type Browser, type Page } from 'playwright-core';
import { FakeGmail, sampleThreads } from './fake-gmail.ts';

const port = 4199;
const base = `http://127.0.0.1:${port}/`;
const screenshots = new URL('./screenshots/', import.meta.url).pathname;
let server: ChildProcess;
let browser: Browser;

before(async () => {
  // NILMAIL_DEV_VARS points at nothing, so the server runs without the developer's sign-in secrets.
  server = spawn(process.execPath, ['scripts/dev.mjs'], {
    env: { ...process.env, NILMAIL_PORT: String(port), NILMAIL_DEV_VARS: '/nonexistent/nilmail.dev.vars' },
    stdio: 'ignore',
  });
  for (let attempt = 0; attempt < 100; attempt++) {
    const response = await fetch(base).catch(() => null);
    if (response?.ok) break;
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  await mkdir(screenshots, { recursive: true });
  const executablePath = process.env.NILMAIL_CHROME;
  browser = await chromium.launch(executablePath ? { executablePath } : { channel: 'chrome' });
});

after(async () => {
  await browser?.close();
  server?.kill();
});

async function open(gmail: FakeGmail | null, { width = 390, height = 844, userAgent = undefined as string | undefined } = {}) {
  const context = await browser.newContext({
    viewport: { width, height },
    locale: 'en-GB',
    timezoneId: 'Europe/Budapest',
    hasTouch: Boolean(userAgent),
    ...(userAgent ? { userAgent } : {}),
  });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => {
    if (message.type() === 'error') errors.push(message.text());
  });
  if (gmail) await gmail.attach(page);
  await page.goto(base);
  return { page, errors };
}

const topSubject = (page: Page) => page.locator('.swipe-card .mail-card-subject').textContent();
const waitForCard = (page: Page) => page.locator('.swipe-card .mail-card').waitFor();

/** Drags the top card like a finger would, holding it mid-way for `pause` (to see the swipe label) before letting go. */
async function drag(page: Page, dx: number, dy: number, pause?: (page: Page) => Promise<void>) {
  const box = (await page.locator('.swipe-card').boundingBox())!;
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx * 0.5, y + dy * 0.5, { steps: 8 });
  await pause?.(page);
  await page.mouse.move(x + dx, y + dy, { steps: 8 });
  await page.mouse.up();
}

const settle = (gmail: FakeGmail, count: number) =>
  (async () => {
    for (let attempt = 0; attempt < 50 && gmail.changes.length < count; attempt++)
      await new Promise(resolve => setTimeout(resolve, 50));
  })();

test('without a server secret the app says sign-in is not set up; signed out it offers Google sign-in', async () => {
  const { page, errors } = await open(null);
  await page.getByText('Sign-in is not set up on this server yet.').waitFor();

  await page.route('**/api/auth/token', route => route.fulfill({ status: 401, json: { error: 'signed-out' } }));
  await page.goto(`${base}?signin=permission`);
  const signIn = page.getByRole('link', { name: 'Sign in with Google' });
  await signIn.waitFor();
  assert.equal(await signIn.getAttribute('href'), '/api/auth/start');
  await page.getByText('nilmail needs the Gmail permission').waitFor();
  assert.equal(new URL(page.url()).search, '', 'the sign-in problem is removed from the address');
  await page.getByText('Private app: only invited Google accounts can sign in.').waitFor();

  await page.goto(`${base}?signin=not-allowed`);
  await page.getByText('This nilmail is private. Ask its owner to add your Google account.').waitFor();
  await page.screenshot({ path: `${screenshots}signin.png` });
  await page.context().close();
  assert.deepEqual(
    errors.filter(error => !/401|503/.test(error)),
    [],
  );
});

test('swiping right archives the newest unread thread, and undo puts it back', async () => {
  const gmail = new FakeGmail(sampleThreads(12));
  const { page, errors } = await open(gmail);
  await waitForCard(page);
  assert.equal(await topSubject(page), 'Message number 1');
  await page.getByText('12 unread').waitFor();
  await page.screenshot({ path: `${screenshots}deck.png` });

  await drag(page, 320, 10, async page => {
    await page.locator('.swipe-intent', { hasText: 'Archive' }).waitFor();
    await page.screenshot({ path: `${screenshots}deck-dragging.png` });
  });
  await page.getByRole('status').filter({ hasText: 'Archived' }).waitFor();
  await settle(gmail, 1);
  assert.deepEqual(gmail.changes, [{ thread: 'thread000', op: 'modify', add: [], remove: ['INBOX', 'UNREAD'] }]);
  assert.equal(await topSubject(page), 'Message number 2');
  await page.getByText('11 unread').waitFor();

  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await settle(gmail, 2);
  assert.deepEqual(gmail.changes[1], { thread: 'thread000', op: 'modify', add: ['INBOX', 'UNREAD'], remove: [] });
  assert.equal(await topSubject(page), 'Message number 1');
  await page.getByText('12 unread').waitFor();
  assert.deepEqual(errors, []);
  await page.context().close();
});

test('arrow keys and buttons act too: left deletes, Ctrl+Z restores it to the inbox unread, down skips', async () => {
  const gmail = new FakeGmail(sampleThreads(8));
  const { page, errors } = await open(gmail, { width: 1280, height: 900 });
  await waitForCard(page);
  await page.screenshot({ path: `${screenshots}desktop.png` });

  await page.keyboard.press('ArrowLeft');
  await page.getByRole('status').filter({ hasText: 'Moved to Bin' }).waitFor();
  await settle(gmail, 1);
  assert.deepEqual(gmail.changes[0], { thread: 'thread000', op: 'trash' });
  assert.ok(gmail.labels('thread000').includes('TRASH'));

  await page.keyboard.press('Control+z');
  await settle(gmail, 3);
  assert.deepEqual(gmail.changes.slice(1), [
    { thread: 'thread000', op: 'untrash' },
    { thread: 'thread000', op: 'modify', add: ['INBOX', 'UNREAD'], remove: [] },
  ]);
  assert.deepEqual(gmail.labels('thread000').toSorted(), ['INBOX', 'UNREAD']);
  assert.equal(await topSubject(page), 'Message number 1');

  await page.locator('.action-bar').getByRole('button', { name: /Skip/ }).click();
  await page.getByRole('status').filter({ hasText: 'Skipped' }).waitFor();
  assert.equal(await topSubject(page), 'Message number 2');
  assert.equal(gmail.changes.length, 3, 'skip changes nothing in Gmail');
  assert.deepEqual(errors, []);
  await page.context().close();
});

test('swiping up opens the conversation, marks it read, and an action there sorts it', async () => {
  const gmail = new FakeGmail(sampleThreads(6));
  const { page, errors } = await open(gmail);
  await waitForCard(page);

  await drag(page, 0, -340);
  const view = page.locator('dialog.read-view');
  await view.waitFor();
  await view.getByRole('heading', { name: 'Message number 1' }).waitFor();
  const frame = page.frameLocator('.message-frame');
  await frame.getByRole('heading', { name: 'Message 1' }).waitFor();
  await settle(gmail, 1);
  assert.deepEqual(gmail.changes[0], { thread: 'thread000', op: 'modify', add: [], remove: ['UNREAD'] });
  assert.equal(await frame.getByRole('link', { name: 'A link' }).getAttribute('href'), 'https://example.com/0');
  await page.getByRole('button', { name: /Show all 2 messages/ }).waitFor();
  await page.screenshot({ path: `${screenshots}read.png` });

  await view.getByRole('button', { name: 'Back to the deck' }).click();
  await view.waitFor({ state: 'hidden' });
  assert.equal(await topSubject(page), 'Message number 1', 'back keeps the card on top');
  await page.locator('.swipe-card .fact', { hasText: 'Read' }).waitFor();

  await page.keyboard.press('ArrowUp');
  await view.waitFor();
  await view.getByRole('button', { name: 'Archive' }).click();
  await view.waitFor({ state: 'hidden' });
  await settle(gmail, 2);
  assert.deepEqual(gmail.changes[1], { thread: 'thread000', op: 'modify', add: [], remove: ['INBOX'] });
  assert.equal(await topSubject(page), 'Message number 2');
  assert.deepEqual(errors, []);
  await page.context().close();
});

test('reply opens the conversation in Gmail for the signed-in account', async () => {
  const gmail = new FakeGmail(sampleThreads(3));
  const { page } = await open(gmail);
  await page.context().route('https://mail.google.com/**', route => route.fulfill({ body: 'Gmail' }));
  await waitForCard(page);
  const [popup] = await Promise.all([
    page.waitForEvent('popup'),
    page.locator('.card-extras').getByRole('button', { name: 'Reply' }).click(),
  ]);
  assert.equal(popup.url(), 'https://mail.google.com/mail/?authuser=me%40example.com#all/thread000');
  assert.equal(await topSubject(page), 'Message number 2');
  assert.equal(gmail.changes.length, 0);
  await page.context().close();
});

test('settings change what a swipe does, and stay after a reload', async () => {
  const gmail = new FakeGmail(sampleThreads(4));
  const { page, errors } = await open(gmail);
  await waitForCard(page);
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByLabel('Left').selectOption('markRead');
  await page.screenshot({ path: `${screenshots}settings.png` });
  await page.getByRole('button', { name: 'Save' }).click();

  await page.reload();
  await waitForCard(page);
  await page
    .locator('.action-bar')
    .getByRole('button', { name: /Mark read/ })
    .waitFor();
  await page.locator('.card-extras').getByRole('button', { name: 'Delete' }).waitFor();
  await page.keyboard.press('ArrowLeft');
  await settle(gmail, 1);
  assert.deepEqual(gmail.changes[0], { thread: 'thread000', op: 'modify', add: [], remove: ['UNREAD'] });
  assert.deepEqual(errors, []);
  await page.context().close();
});

test('a change Gmail refuses puts the card back with a message', async () => {
  const gmail = new FakeGmail(sampleThreads(3));
  gmail.failChanges = 500;
  const { page } = await open(gmail);
  await waitForCard(page);
  await page.keyboard.press('ArrowRight');
  await page.getByRole('status').filter({ hasText: 'Gmail refused the change' }).waitFor();
  assert.equal(await topSubject(page), 'Message number 1');
  await page.context().close();
});

test('Refresh starts again from the newest thread, brings back skipped ones, and keeps undo', async () => {
  const gmail = new FakeGmail(sampleThreads(8));
  const { page, errors } = await open(gmail);
  await waitForCard(page);
  await page.keyboard.press('ArrowRight');
  await page.getByRole('status').filter({ hasText: 'Archived' }).waitFor();
  await page.keyboard.press('ArrowDown');
  await page.getByRole('status').filter({ hasText: 'Skipped' }).waitFor();
  assert.equal(await topSubject(page), 'Message number 3');
  await settle(gmail, 1);

  const [arrived] = sampleThreads(1, Date.UTC(2026, 10, 21, 12));
  gmail.threads.set('thread-new', { ...arrived!, id: 'thread-new', subject: 'Just arrived' });
  await page.getByRole('button', { name: 'Refresh' }).click();
  await page.waitForFunction(() => document.querySelector('.swipe-card .mail-card-subject')?.textContent === 'Just arrived');
  await page.getByText('8 unread').waitFor();

  await page.keyboard.press('Control+z');
  await page.waitForFunction(() => document.querySelector('.swipe-card .mail-card-subject')?.textContent === 'Message number 2');
  await page.keyboard.press('Control+z');
  await settle(gmail, 2);
  assert.deepEqual(gmail.changes[1], { thread: 'thread000', op: 'modify', add: ['INBOX', 'UNREAD'], remove: [] });
  assert.equal(await topSubject(page), 'Message number 1');
  await page.getByText('9 unread').waitFor();
  assert.deepEqual(errors, []);
  await page.context().close();
});

test('sorting everything ends at inbox zero, and a long inbox keeps loading', async () => {
  const gmail = new FakeGmail(sampleThreads(22));
  const { page, errors } = await open(gmail);
  await waitForCard(page);
  for (let index = 0; index < 22; index++) {
    await page.waitForFunction(
      n => document.querySelector('.swipe-card .mail-card-subject')?.textContent === `Message number ${n}`,
      index + 1,
    );
    await page.keyboard.press(index === 3 ? 'ArrowDown' : 'ArrowRight');
  }
  await page.getByRole('heading', { name: 'Nothing left to sort' }).waitFor();
  await page.getByText('One skipped conversation is still unread in the inbox.').waitFor();
  await page.screenshot({ path: `${screenshots}inbox-zero.png` });
  await settle(gmail, 21);
  assert.equal(gmail.changes.length, 21);
  assert.deepEqual(errors, []);
  await page.context().close();
});

test("Install: hidden without an offer, one tap with Chrome's offer, instructions on an iPhone", async () => {
  const { page, errors } = await open(new FakeGmail(sampleThreads(2)));
  await waitForCard(page);
  const install = page.getByRole('button', { name: 'Install app' });
  assert.equal(await install.count(), 0, 'no button before the browser offers installing');

  // Chrome's offer, as Chrome sends it once the site has been used for a while.
  await page.evaluate(() => {
    const offer = new Event('beforeinstallprompt', { cancelable: true }) as Event & { prompt(): Promise<void> };
    offer.prompt = async () => void ((window as Window & { prompted?: boolean }).prompted = true);
    window.dispatchEvent(offer);
  });
  await install.click();
  assert.equal(await page.evaluate(() => (window as Window & { prompted?: boolean }).prompted), true);
  await install.waitFor({ state: 'detached' });
  await page.context().close();

  const iphone =
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
  const apple = await open(new FakeGmail(sampleThreads(2)), { userAgent: iphone });
  await waitForCard(apple.page);
  await apple.page.getByRole('button', { name: 'Install app' }).click();
  const dialog = apple.page.getByRole('dialog', { name: 'Install nilmail' });
  await dialog.getByText('Add to Home Screen').waitFor();
  await apple.page.screenshot({ path: `${screenshots}install-iphone.png` });
  await apple.page.context().close();
  assert.deepEqual([...errors, ...apple.errors], []);
});
