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
    env: {
      ...process.env,
      NILMAIL_PORT: String(port),
      NILMAIL_DEV_VARS: '/nonexistent/nilmail.dev.vars',
      NILMAIL_VERSION: 'v9.9.9',
    },
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

/** Saved settings where a down swipe skips unread mail too, for tests about skipping. */
const downSkips = {
  swipes: {
    unread: { gestures: { right: 'archive', left: 'delete', up: 'read', down: 'skip' } },
    read: { gestures: { right: 'archive', left: 'delete', up: 'read', down: 'skip' } },
  },
};

const inbox = (read: 'unread' | 'read') => ({ read, where: 'inbox', hasLabels: [], lacksLabels: [], search: '' });
/** Saved settings with a Read pile added after Unread, as a user would add it. */
const unreadAndRead = {
  piles: [
    {
      id: 'unread',
      name: 'Unread',
      filters: inbox('unread'),
      swipes: { down: { action: 'markRead', labels: [], archive: true } },
    },
    { id: 'read', name: 'Read', filters: inbox('read'), swipes: {} },
  ],
};

async function open(
  gmail: FakeGmail | null,
  {
    width = 390,
    height = 844,
    userAgent = undefined as string | undefined,
    /** Settings saved before the page opens. */
    settings = undefined as unknown,
    colorScheme = 'light' as 'light' | 'dark',
  } = {},
) {
  const context = await browser.newContext({
    viewport: { width, height },
    colorScheme,
    locale: 'en-GB',
    timezoneId: 'Europe/Budapest',
    hasTouch: Boolean(userAgent),
    ...(userAgent ? { userAgent } : {}),
  });
  if (settings) {
    // Settings with piles are today's; the others are from before piles, which the app converts.
    const key = 'piles' in (settings as object) ? 'nilmail.settings.v3' : 'nilmail.settings.v2';
    await context.addInitScript(
      ([key, saved]) => {
        if (!localStorage.getItem('nilmail.settings.v3')) localStorage.setItem(key!, saved!);
      },
      [key, JSON.stringify(settings)],
    );
  }
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
/** Waits until the pile picker offers `text`, such as "Unread · 12"; its options are never visible while it is closed. */
const waitForCount = (page: Page, text: string) =>
  page.waitForFunction(
    text => [...document.querySelectorAll('.deck-picker option')].some(option => option.textContent === text),
    text,
  );

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
  await waitForCount(page, 'Unread · 12');
  assert.equal(await page.locator('.app-version').textContent(), 'v9.9.9', 'the build puts its version under the logo');
  await page.screenshot({ path: `${screenshots}deck.png` });

  await drag(page, 320, 10, async page => {
    await page.locator('.swipe-intent', { hasText: 'Archive' }).waitFor();
    await page.screenshot({ path: `${screenshots}deck-dragging.png` });
    // The page itself must not scroll, yet keeps the browser's pull-to-refresh (no overflow or overscroll rules on body).
    const scroll = await page.evaluate(() => {
      const root = document.scrollingElement!;
      return { wide: root.scrollWidth > root.clientWidth, tall: root.scrollHeight > root.clientHeight };
    });
    assert.deepEqual(scroll, { wide: false, tall: false }, 'a card dragged off screen does not make the page scroll');
  });
  await page.getByRole('status').filter({ hasText: 'Archived' }).waitFor();
  await settle(gmail, 1);
  assert.deepEqual(gmail.changes, [{ thread: 'thread000', op: 'modify', add: [], remove: ['INBOX', 'UNREAD'] }]);
  assert.equal(await topSubject(page), 'Message number 2');
  await waitForCount(page, 'Unread · 11');

  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await settle(gmail, 2);
  assert.deepEqual(gmail.changes[1], { thread: 'thread000', op: 'modify', add: ['INBOX', 'UNREAD'], remove: [] });
  assert.equal(await topSubject(page), 'Message number 1');
  await waitForCount(page, 'Unread · 12');
  assert.deepEqual(errors, []);
  await page.context().close();
});

test('arrow keys and buttons act too: left deletes, Ctrl+Z restores it to the inbox unread, down marks read', async () => {
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

  await page
    .locator('.action-bar')
    .getByRole('button', { name: /Mark read/ })
    .click();
  await page.getByRole('status').filter({ hasText: 'Marked read' }).waitFor();
  assert.equal(await topSubject(page), 'Message number 2');
  await settle(gmail, 4);
  assert.deepEqual(gmail.changes[3], { thread: 'thread000', op: 'modify', add: [], remove: ['UNREAD'] });
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

test('cards offer no extra action buttons; reply, from the read view, opens the conversation in Gmail', async () => {
  const gmail = new FakeGmail(sampleThreads(3));
  const { page } = await open(gmail);
  await page.context().route('https://mail.google.com/**', route => route.fulfill({ body: 'Gmail' }));
  await waitForCard(page);
  assert.deepEqual(
    (await page.locator('.card-extras button').allTextContents()).map(text => text.trim()),
    ['All from sender'],
  );
  await page.keyboard.press('ArrowUp');
  const view = page.locator('dialog.read-view');
  await view.waitFor();
  const [popup] = await Promise.all([page.waitForEvent('popup'), view.getByRole('button', { name: 'Reply' }).click()]);
  assert.equal(popup.url(), 'https://mail.google.com/mail/?authuser=me%40example.com#all/thread000');
  assert.equal(await topSubject(page), 'Message number 2');
  await settle(gmail, 1);
  assert.equal(gmail.changes.length, 1, 'only opening it changed Gmail: it marked it read');
  await page.context().close();
});

test("Unsubscribe sends the one-click request from the browser and archives; a web link opens the sender's page", async () => {
  const threads = sampleThreads(4);
  threads[0]!.unsubscribe = {
    list: '<mailto:leave@news.example>, <https://news.example/leave?u=1>',
    post: 'List-Unsubscribe=One-Click',
  };
  threads[1]!.unsubscribe = { list: '<https://shop.example/preferences>' };
  const gmail = new FakeGmail(threads);
  const { page, errors } = await open(gmail);
  const sent: { method: string; body: string | null; cookie?: string }[] = [];
  await page.context().route('https://news.example/**', async route => {
    sent.push({ method: route.request().method(), body: route.request().postData(), cookie: route.request().headers().cookie });
    await route.fulfill({ status: 200, body: 'Unsubscribed' });
  });
  await page.context().route('https://shop.example/**', route => route.fulfill({ body: 'Preferences' }));
  await waitForCard(page);
  await page.screenshot({ path: `${screenshots}unsubscribe.png` });

  await page.locator('.card-extras').getByRole('button', { name: 'Unsubscribe' }).click();
  await page.getByRole('status').filter({ hasText: 'Unsubscribed and archived' }).waitFor();
  await settle(gmail, 1);
  assert.deepEqual(sent, [{ method: 'POST', body: 'List-Unsubscribe=One-Click', cookie: undefined }]);
  assert.deepEqual(gmail.changes[0], { thread: 'thread000', op: 'modify', add: [], remove: ['INBOX', 'UNREAD'] });
  assert.equal(await topSubject(page), 'Message number 2');

  await page.keyboard.press('ArrowUp');
  const view = page.locator('dialog.read-view');
  await view.waitFor();
  const [popup] = await Promise.all([
    page.waitForEvent('popup'),
    view.getByRole('button', { name: 'Unsubscribe and archive' }).click(),
  ]);
  assert.equal(popup.url(), 'https://shop.example/preferences');
  await page.getByRole('status').filter({ hasText: 'Finish unsubscribing in the new tab' }).waitFor();
  await settle(gmail, 3);
  assert.deepEqual(gmail.changes[2], { thread: 'thread001', op: 'modify', add: [], remove: ['INBOX'] });
  assert.equal(await page.locator('.card-extras').getByRole('button', { name: 'Unsubscribe' }).count(), 0);
  assert.deepEqual(errors, []);
  await page.context().close();
});

test('All from sender applies one swipe to every unread conversation from the sender, with one undo', async () => {
  const gmail = new FakeGmail(sampleThreads(12));
  const { page, errors } = await open(gmail, { settings: downSkips });
  await waitForCard(page);
  const toggle = page.getByRole('button', { name: /from sender/ });
  assert.equal(await toggle.getAttribute('aria-pressed'), 'false');
  await toggle.click();
  await page.getByRole('button', { name: 'All 3 from sender' }).waitFor();
  assert.equal(await toggle.getAttribute('aria-pressed'), 'true');
  await page
    .locator('.action-bar')
    .getByRole('button', { name: /Archive 3/ })
    .waitFor();
  await page.screenshot({ path: `${screenshots}all-from-sender.png` });

  await page.keyboard.press('ArrowRight');
  await page.getByRole('status').filter({ hasText: 'Archived: 3 conversations' }).waitFor();
  await settle(gmail, 3);
  assert.deepEqual(gmail.changes.map(change => change.thread).toSorted(), ['thread000', 'thread004', 'thread008']);
  assert.equal(await topSubject(page), 'Message number 2');
  assert.equal(await toggle.getAttribute('aria-pressed'), 'false', 'the next card starts with the switch off');
  await waitForCount(page, 'Unread · 9');

  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await settle(gmail, 6);
  assert.deepEqual(
    gmail.changes.slice(3).map(change => change.op === 'modify' && change.add),
    [
      ['INBOX', 'UNREAD'],
      ['INBOX', 'UNREAD'],
      ['INBOX', 'UNREAD'],
    ],
  );
  assert.equal(await topSubject(page), 'Message number 1');
  await waitForCount(page, 'Unread · 12');

  await toggle.click();
  await page.getByRole('button', { name: 'All 3 from sender' }).waitFor();
  await page.keyboard.press('ArrowDown');
  await page.getByRole('status').filter({ hasText: 'Skipped: 3 conversations' }).waitFor();
  for (const subject of ['Message number 2', 'Message number 3', 'Message number 4']) {
    assert.equal(await topSubject(page), subject);
    await page.keyboard.press('ArrowDown');
    await page.waitForFunction(text => document.querySelector('.swipe-card .mail-card-subject')?.textContent !== text, subject);
  }
  assert.equal(await topSubject(page), 'Message number 6', "the sender's skipped conversations stay out of the deck");
  assert.equal(gmail.changes.length, 6, 'skip changes nothing in Gmail');
  assert.deepEqual(errors, []);
  await page.context().close();
});

test('each pile has its own swipes in settings, and they stay after a reload', async () => {
  const threads = sampleThreads(4).map((thread, index) =>
    index < 2 ? thread : { ...thread, labelIds: thread.labelIds.filter(label => label !== 'UNREAD') },
  );
  const gmail = new FakeGmail(threads);
  const { page, errors } = await open(gmail, { settings: unreadAndRead });
  await waitForCard(page);
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByRole('button', { name: /^Edit Unread/ }).click();
  assert.equal(await page.getByRole('combobox', { name: 'Down', exact: true }).inputValue(), 'markRead');
  await page.getByRole('combobox', { name: 'Left', exact: true }).selectOption('skip');
  await page.getByRole('button', { name: 'All piles' }).click();
  await page.getByRole('button', { name: /^Edit Read/ }).click();
  assert.equal(await page.getByRole('combobox', { name: 'Down', exact: true }).inputValue(), 'skip');
  await page.getByRole('combobox', { name: 'Left', exact: true }).selectOption('archive');
  await page.getByRole('button', { name: 'Save' }).click();
  await page.locator('dialog').waitFor({ state: 'hidden' });

  await page.reload();
  await waitForCard(page);
  await page.keyboard.press('ArrowLeft');
  await page.getByRole('status').filter({ hasText: 'Skipped' }).waitFor();
  assert.equal(await topSubject(page), 'Message number 2');

  await page.getByLabel('Pile to sort').selectOption('read');
  await page.waitForFunction(() => document.querySelector('.swipe-card .mail-card-subject')?.textContent === 'Message number 3');
  await page.keyboard.press('ArrowLeft');
  await page.getByRole('status').filter({ hasText: 'Archived' }).waitFor();
  await settle(gmail, 1);
  assert.deepEqual(gmail.changes, [{ thread: 'thread002', op: 'modify', add: [], remove: ['INBOX'] }]);
  assert.deepEqual(errors, []);
  await page.context().close();
});

test('a swipe adds several labels, new and existing; a pile built on a label removes it again, with undo', async () => {
  const gmail = new FakeGmail(sampleThreads(6));
  gmail.labelList.push({ id: 'Label_receipts', name: 'Receipts', type: 'user' });
  const { page, errors } = await open(gmail);
  await waitForCard(page);

  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByRole('button', { name: /^Edit Unread/ }).click();
  await page.getByRole('combobox', { name: 'Down', exact: true }).selectOption('addLabels');
  await page.getByRole('button', { name: 'Save' }).click();
  await page.getByText('Choose a label for the down swipe.').waitFor();
  const addTo = page.getByLabel('Add to down swipe labels');
  assert.deepEqual(
    await addTo.locator('option').allTextContents(),
    ['Add a label…', 'Receipts', 'New label…'],
    'only user labels',
  );
  await addTo.selectOption({ label: 'Receipts' });
  await page.getByLabel('Add to down swipe labels').selectOption({ label: 'New label…' });
  await page.getByLabel('New label for down swipe labels').fill('todo accounting');
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await page.locator('.label-chips', { hasText: 'todo accounting' }).waitFor();
  await page.screenshot({ path: `${screenshots}settings-labels.png` });
  await page.getByRole('button', { name: 'Save' }).click();
  await page.locator('dialog').waitFor({ state: 'hidden' });
  const todo = gmail.labelList.find(label => label.name === 'todo accounting')!;
  assert.ok(todo, 'the new label is created in Gmail');

  await page.keyboard.press('ArrowDown');
  await page.getByRole('status').filter({ hasText: 'Moved to Receipts, todo accounting' }).waitFor();
  await settle(gmail, 1);
  assert.deepEqual(gmail.changes[0], { thread: 'thread000', op: 'modify', add: ['Label_receipts', todo.id], remove: ['INBOX'] });
  assert.ok(gmail.labels('thread000').includes('UNREAD'), 'still unread');

  await page.getByLabel('Pile to sort').selectOption({ label: 'Edit piles…' });
  await page.getByRole('button', { name: 'New pile' }).click();
  await page.getByLabel('Name').fill('Accounting');
  await page.getByRole('radio', { name: 'Either' }).click();
  await page.getByRole('radio', { name: 'Anywhere' }).click();
  await page.getByLabel('Add to has labels').selectOption({ label: 'todo accounting' });
  await page.getByRole('combobox', { name: 'Right', exact: true }).selectOption('removeLabel');
  assert.equal(await page.getByLabel('Right swipe label to remove').inputValue(), todo.id, "the pile's own label comes first");
  await page.locator('.pile-summary', { hasText: 'Anywhere · read or unread · has todo accounting' }).waitFor();
  await page.screenshot({ path: `${screenshots}settings-pile.png` });
  await page.getByRole('button', { name: 'All piles' }).click();
  await page.screenshot({ path: `${screenshots}settings.png` });
  await page.getByRole('button', { name: 'Save' }).click();
  await page.locator('dialog').waitFor({ state: 'hidden' });

  await waitForCount(page, 'Accounting · 1');
  await page.getByLabel('Pile to sort').selectOption({ label: 'Accounting · 1' });
  await page.waitForFunction(() => document.querySelector('.swipe-card .mail-card-subject')?.textContent === 'Message number 1');
  await page
    .locator('.action-bar')
    .getByRole('button', { name: /− todo accounting/ })
    .waitFor();
  await page.keyboard.press('ArrowRight');
  await page.getByRole('status').filter({ hasText: 'Removed todo accounting' }).waitFor();
  await settle(gmail, 2);
  assert.deepEqual(gmail.changes[1], { thread: 'thread000', op: 'modify', add: [], remove: [todo.id] });
  await page.getByText('Nothing left in Accounting.').waitFor();
  await waitForCount(page, 'Accounting · 0');

  await page.keyboard.press('Control+z');
  await settle(gmail, 3);
  assert.deepEqual(gmail.changes[2], { thread: 'thread000', op: 'modify', add: [todo.id], remove: [] });
  await page.waitForFunction(() => document.querySelector('.swipe-card .mail-card-subject')?.textContent === 'Message number 1');

  await page.reload();
  await waitForCard(page);
  assert.equal(await topSubject(page), 'Message number 2', 'the app opens on the first pile');
  await waitForCount(page, 'Accounting · 1');
  assert.deepEqual(errors, []);
  await page.context().close();
});

test('a pile Gmail can only estimate shows its count as a guess; it leaves out a label it must not have', async () => {
  const receipts = { id: 'Label_receipts', name: 'Paid receipts' };
  const threads = sampleThreads(12);
  threads[4]!.labelIds.push(receipts.id);
  const gmail = new FakeGmail(threads);
  gmail.labelList.push({ ...receipts, type: 'user' });
  const anna = {
    id: 'anna',
    name: 'Anna',
    filters: { read: 'any', where: 'anywhere', hasLabels: [], lacksLabels: [receipts], search: 'from:"anna@example.com"' },
    swipes: {},
  };
  const { page, errors } = await open(gmail, { settings: { piles: [anna] } });
  await waitForCard(page);
  await waitForCount(page, 'Anna · ~2');
  const picker = page.getByLabel('Pile to sort');
  assert.equal(await picker.getAttribute('title'), "About 2 (Gmail's estimate)");
  assert.equal(await topSubject(page), 'Message number 1');
  await page.keyboard.press('ArrowDown');
  await page.waitForFunction(() => document.querySelector('.swipe-card .mail-card-subject')?.textContent === 'Message number 9');
  await page.keyboard.press('ArrowDown');
  await page.getByText('Nothing left in Anna.').waitFor();
  assert.deepEqual(errors, []);
  await page.context().close();
});

test('More filters stay folded until used, and a pile built with them loads its mail', async () => {
  const gmail = new FakeGmail(sampleThreads(12));
  const { page, errors } = await open(gmail);
  await waitForCard(page);
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByRole('button', { name: 'New pile' }).click();
  await page.getByLabel('Name').fill('Anna');
  await page.getByRole('radio', { name: 'Either' }).click();
  const more = page.locator('details.more-filters');
  assert.equal(await more.getAttribute('open'), null, 'folded while none is set');
  await more.locator('summary').click();
  await page.getByLabel('Category').selectOption('updates');
  await page.getByLabel('Older than, amount').fill('6');
  await page.getByLabel('Older than, unit').selectOption('m');
  await page.getByLabel('From', { exact: true }).fill('anna@example.com');
  await page.getByLabel('Has an attachment').check();
  await page
    .locator('.pile-summary', {
      hasText: 'Inbox · read or unread · Updates · older than 6 months · from anna@example.com · with attachment',
    })
    .waitFor();
  await page.screenshot({ path: `${screenshots}settings-more-filters.png` });
  await page.getByRole('button', { name: 'All piles' }).click();
  await page.getByRole('button', { name: /^Edit Anna/ }).click();
  assert.notEqual(await page.locator('details.more-filters').getAttribute('open'), null, 'open when one is set');
  await page.getByRole('button', { name: 'Save' }).click();
  await page.locator('dialog').waitFor({ state: 'hidden' });

  await waitForCount(page, 'Anna · ~3');
  await page.getByLabel('Pile to sort').selectOption({ label: 'Anna · ~3' });
  await page.waitForFunction(() => document.querySelector('.swipe-card .mail-card-subject')?.textContent === 'Message number 1');
  await page.keyboard.press('ArrowDown');
  await page.waitForFunction(() => document.querySelector('.swipe-card .mail-card-subject')?.textContent === 'Message number 5');
  assert.deepEqual(errors, []);
  await page.context().close();
});

test('the dark theme covers the deck, the read view, settings and sign-in', async () => {
  const threads = sampleThreads(4);
  threads[0]!.unsubscribe = { list: '<https://news.example/unsubscribe>' };
  const gmail = new FakeGmail(threads);
  const { page, errors } = await open(gmail, { colorScheme: 'dark' });
  await waitForCard(page);
  const surface = await page.evaluate(() => getComputedStyle(document.documentElement).backgroundColor);
  assert.equal(surface, 'rgb(22, 19, 16)', 'the dark surface');
  await page.screenshot({ path: `${screenshots}dark-deck.png` });
  await drag(page, -150, 10, async page => {
    await page.locator('.swipe-intent').waitFor();
    await page.screenshot({ path: `${screenshots}dark-dragging.png` });
  });
  await page.keyboard.press('ArrowUp');
  await page.frameLocator('.message-frame').getByRole('heading').first().waitFor();
  await page.screenshot({ path: `${screenshots}dark-read.png`, animations: 'disabled' });
  await page.getByRole('button', { name: 'Back to the deck' }).click();
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByRole('button', { name: /^Edit Unread/ }).click();
  await page.screenshot({ path: `${screenshots}dark-settings.png` });
  await page.getByLabel('Name').fill('Unread mail');
  await page.getByRole('button', { name: 'Close' }).click();
  await page.getByRole('heading', { name: 'Discard changes?' }).waitFor();
  await page.screenshot({ path: `${screenshots}dark-discard.png`, animations: 'disabled' });
  await page.getByRole('button', { name: 'Discard' }).click();
  await page.locator('dialog').first().waitFor({ state: 'hidden' });
  assert.deepEqual(errors, []);
  await page.context().close();

  const { page: welcome } = await open(null, { colorScheme: 'dark' });
  await welcome.route('**/api/auth/token', route => route.fulfill({ status: 401, json: { error: 'signed-out' } }));
  await welcome.reload();
  await welcome.getByRole('link', { name: 'Sign in with Google' }).waitFor();
  await welcome.screenshot({ path: `${screenshots}dark-welcome.png` });
  await welcome.context().close();
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
  const { page, errors } = await open(gmail, { settings: downSkips });
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
  await waitForCount(page, 'Unread · 8');

  await page.keyboard.press('Control+z');
  await page.waitForFunction(() => document.querySelector('.swipe-card .mail-card-subject')?.textContent === 'Message number 2');
  await page.keyboard.press('Control+z');
  await settle(gmail, 2);
  assert.deepEqual(gmail.changes[1], { thread: 'thread000', op: 'modify', add: ['INBOX', 'UNREAD'], remove: [] });
  assert.equal(await topSubject(page), 'Message number 1');
  await waitForCount(page, 'Unread · 9');
  assert.deepEqual(errors, []);
  await page.context().close();
});

test('the picker switches to read conversations, with their own swipes, and back; undo still works', async () => {
  const threads = sampleThreads(6).map((thread, index) =>
    index < 3 ? thread : { ...thread, labelIds: thread.labelIds.filter(label => label !== 'UNREAD') },
  );
  const gmail = new FakeGmail(threads);
  const { page, errors } = await open(gmail, { settings: unreadAndRead });
  await waitForCard(page);
  assert.equal(await topSubject(page), 'Message number 1', 'the app starts on unread');
  await waitForCount(page, 'Unread · 3');
  await waitForCount(page, 'Read · 3');
  const markRead = page.locator('.action-bar').getByRole('button', { name: /Mark read/ });
  assert.equal(await markRead.count(), 1, 'down marks unread mail read');

  await page.getByLabel('Pile to sort').selectOption('read');
  await page.waitForFunction(() => document.querySelector('.swipe-card .mail-card-subject')?.textContent === 'Message number 4');
  assert.equal(await markRead.count(), 0, 'down skips read mail');
  await page.locator('.action-bar').getByRole('button', { name: /Skip/ }).waitFor();
  await page.screenshot({ path: `${screenshots}read-deck.png` });
  await page.keyboard.press('ArrowRight');
  await page.getByRole('status').filter({ hasText: 'Archived' }).waitFor();
  await settle(gmail, 1);
  assert.deepEqual(gmail.changes, [{ thread: 'thread003', op: 'modify', add: [], remove: ['INBOX'] }]);
  assert.equal(await topSubject(page), 'Message number 5');
  await waitForCount(page, 'Read · 2');

  await page.getByLabel('Pile to sort').selectOption('unread');
  await page.waitForFunction(() => document.querySelector('.swipe-card .mail-card-subject')?.textContent === 'Message number 1');
  await page.keyboard.press('Control+z');
  await settle(gmail, 2);
  assert.deepEqual(gmail.changes[1], { thread: 'thread003', op: 'modify', add: ['INBOX'], remove: [] });
  await waitForCount(page, 'Read · 3');

  await page.getByLabel('Pile to sort').selectOption('read');
  for (const subject of ['Message number 4', 'Message number 5', 'Message number 6']) {
    await page.waitForFunction(text => document.querySelector('.swipe-card .mail-card-subject')?.textContent === text, subject);
    await page.keyboard.press('ArrowDown');
  }
  await page.getByText('3 skipped conversations still belong in Read.').waitFor();
  assert.deepEqual(errors, []);
  await page.context().close();
});

test('sorting everything ends at inbox zero, and a long inbox keeps loading', async () => {
  const gmail = new FakeGmail(sampleThreads(22));
  const { page, errors } = await open(gmail, { settings: downSkips });
  await waitForCard(page);
  for (let index = 0; index < 22; index++) {
    await page.waitForFunction(
      n => document.querySelector('.swipe-card .mail-card-subject')?.textContent === `Message number ${n}`,
      index + 1,
    );
    await page.keyboard.press(index === 3 ? 'ArrowDown' : 'ArrowRight');
  }
  await page.getByRole('heading', { name: 'Nothing left to sort' }).waitFor();
  await page.getByText('One skipped conversation still belongs in Unread.').waitFor();
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
