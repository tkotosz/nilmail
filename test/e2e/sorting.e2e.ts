// Walks through sorting in Chrome at phone width, against a fake Gmail (see fake-gmail.ts); the Worker's sign-in routes
// have their own unit tests. Run with `npm run test:e2e`. Set NILMAIL_CHROME to use a browser other than Chrome.
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { after, before, test } from 'node:test';
import { chromium, type Browser, type Page } from 'playwright-core';
import { FakeGmail, githubHtml, newsletterHtml, sampleThreads } from './fake-gmail.ts';

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
/** Opens a swipe's page in a pile's settings, such as the down swipe's; its row is named "Down swipe: <what it does>". */
const openSwipe = (page: Page, direction: string) =>
  page.getByRole('button', { name: new RegExp(`^${direction} swipe:`) }).click();

/** The Settings header's Back button, which shows on every page below the list of piles. */
const settingsBack = (page: Page) =>
  page.locator('dialog.settings-dialog').getByRole('button', { name: 'Back', exact: true }).click();

/** Closes Settings from any page: Back up to the list of piles, where the header offers Close. */
async function closeSettings(page: Page) {
  const settings = page.locator('dialog.settings-dialog');
  while (await settings.getByRole('button', { name: 'Back', exact: true }).isVisible()) await settingsBack(page);
  await settings.getByRole('button', { name: 'Close' }).click();
}

/** Adds an action from the open swipe page: Add an action, the action by name, and for Add or Remove label the label. */
async function addAction(page: Page, action: string, label?: string) {
  const settings = page.locator('dialog.settings-dialog');
  await settings.getByRole('button', { name: 'Add an action' }).click();
  await settings.getByRole('button', { name: new RegExp(`^${action}`) }).click();
  if (label) await settings.getByRole('button', { name: label, exact: true }).click();
  await settings.getByRole('button', { name: 'Add an action' }).waitFor();
}

/** Waits until a pile's tab shows `text`, its name and count, such as "Unread · 12". */
const waitForCount = (page: Page, text: string) =>
  page.getByRole('navigation', { name: 'Piles' }).getByRole('button', { name: text, exact: true }).waitFor();

/** A pile's tab, by the pile's name; its label adds the count, such as "Read · 3". */
const pileTab = (page: Page, name: string) =>
  page.getByRole('navigation', { name: 'Piles' }).getByRole('button', { name: new RegExp(`^${name}( · |$)`) });

/** The tabs' labels in order, such as ["Unread · 3", "Read · 3"]. */
const tabLabels = (page: Page) => page.locator('.pile-tab').evaluateAll(tabs => tabs.map(tab => tab.getAttribute('aria-label')));

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

  await page.locator('.action-bar').getByRole('button', { name: 'Mark read', exact: true }).click();
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
  const recipients = view.getByRole('button', { name: 'to me' });
  await recipients.click();
  assert.equal(await recipients.getAttribute('aria-expanded'), 'true');
  await view.getByText('Anna Kovács <anna@example.com>').waitFor();
  await recipients.click();
  await page.screenshot({ path: `${screenshots}read.png`, animations: 'disabled' });

  await view.getByRole('button', { name: 'Back to the deck' }).click();
  await view.waitFor({ state: 'hidden' });
  assert.equal(await topSubject(page), 'Message number 1', 'back keeps the card on top');
  await page.keyboard.press('ArrowUp');
  await view.waitFor();
  await page.goBack();
  await view.waitFor({ state: 'hidden' });
  assert.equal(await topSubject(page), 'Message number 1', "the phone's Back closes the read view, not the app");
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

test('a table of small icons keeps its columns, and the email gets nearly the full width', async () => {
  const threads = sampleThreads(1);
  threads[0]!.html = githubHtml;
  const gmail = new FakeGmail(threads);
  const { page, errors } = await open(gmail);
  await waitForCard(page);
  await page.keyboard.press('ArrowUp');
  const frame = page.frameLocator('.message-frame');
  await frame.getByText('Failed in 27 seconds').waitFor();
  const look = await page.locator('.message-frame').evaluate((element: HTMLIFrameElement) => {
    const doc = element.contentDocument!;
    const status = [...doc.querySelectorAll('th')].find(th => th.textContent === 'Status')!;
    return {
      frame: element.getBoundingClientRect().width,
      icon: doc.querySelector('img.status')!.getBoundingClientRect().width,
      header: status.getBoundingClientRect().height,
    };
  });
  assert.ok(look.frame >= 360, `the email uses nearly the full width of a 390px phone, not ${look.frame}px`);
  assert.equal(look.icon, 24, 'status icons keep their size');
  assert.ok(look.header < 40, `the Status header stays on one line, not ${look.header}px tall`);
  await page.screenshot({ path: `${screenshots}github.png`, animations: 'disabled' });
  assert.deepEqual(errors, []);
  await page.context().close();
});

test('an email shows before its pictures arrive, and grows when they do', async () => {
  const threads = sampleThreads(1);
  threads[0]!.html = '<p>Text first.</p><img src="https://img.example.com/slow.png" width="300"><p>After the picture.</p>';
  const gmail = new FakeGmail(threads);
  const { page, errors } = await open(gmail);
  let release = () => {};
  const arrived = new Promise<void>(resolve => (release = resolve));
  await page.context().route('https://img.example.com/**', async route => {
    await arrived;
    const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
    await route.fulfill({ body: Buffer.from(png, 'base64'), contentType: 'image/png' });
  });
  await waitForCard(page);
  await page.keyboard.press('ArrowUp');
  const frame = page.locator('.message-frame');
  await page.waitForFunction(
    () => (document.querySelector('.message-frame') as HTMLElement | null)?.style.visibility === 'visible',
    null,
    {
      timeout: 3000,
    },
  );
  const before = await frame.evaluate(element => element.clientHeight);
  release();
  await page.waitForFunction(height => (document.querySelector('.message-frame') as HTMLElement).clientHeight > height, before);
  assert.deepEqual(errors, []);
  await page.context().close();
});

test('a long email scrolls in the read view by touch, on the email itself too', async () => {
  const threads = sampleThreads(2);
  threads[0]!.html = Array.from({ length: 60 }, (_, index) => `<p>Paragraph ${index + 1} of a long email.</p>`).join('');
  const gmail = new FakeGmail(threads);
  const { page, errors } = await open(gmail, { userAgent: 'Mozilla/5.0 (Linux; Android 16) Mobile' });
  await waitForCard(page);
  await page.keyboard.press('ArrowUp');
  await page.frameLocator('.message-frame').getByText('Paragraph 60').waitFor({ state: 'attached' });
  const scrolled = () => page.locator('.read-body').evaluate(body => body.scrollTop);
  assert.ok(
    await page.locator('.read-body').evaluate(body => body.scrollHeight > body.clientHeight * 2),
    'the conversation is taller than the screen, not cut off',
  );
  const cdp = await page.context().newCDPSession(page);
  const swipeUp = async (x: number, y: number, distance: number) => {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
    for (let step = 1; step <= 12; step++) {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: y - (distance * step) / 12 }] });
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  };
  await swipeUp(195, 600, 300);
  await page.waitForFunction(() => document.querySelector('.read-body')!.scrollTop > 100);
  const afterEmail = await scrolled();
  await swipeUp(195, 300, 200);
  await page.waitForFunction(top => document.querySelector('.read-body')!.scrollTop > top + 50, afterEmail);
  assert.deepEqual(errors, []);
  await page.context().close();
});

for (const colorScheme of ['light', 'dark'] as const) {
  test(`a wide newsletter zooms out to fit; in dark it darkens as Gmail does (${colorScheme})`, async () => {
    const threads = sampleThreads(1);
    threads[0]!.html = newsletterHtml;
    const gmail = new FakeGmail(threads);
    const { page, errors } = await open(gmail, { colorScheme });
    await waitForCard(page);
    await page.keyboard.press('ArrowUp');
    const frame = page.frameLocator('.message-frame');
    await frame.getByText('Még mindig').waitFor();
    await page.waitForFunction(() => {
      const body = (document.querySelector('.message-frame') as HTMLIFrameElement | null)?.contentDocument?.body;
      return Boolean(body?.style.zoom);
    });
    const look = await page.locator('.message-frame').evaluate((element: HTMLIFrameElement) => {
      const doc = element.contentDocument!;
      const cell = (text: string) => [...doc.querySelectorAll('td')].find(td => td.textContent?.includes(text))!;
      const style = (td: HTMLElement) => getComputedStyle(td);
      return {
        zoom: Number(doc.body.style.zoom),
        light: style(cell('Kék tagok')).backgroundColor,
        lightText: style(cell('Kék tagok')).color,
        banner: style(cell('Még mindig')).backgroundColor,
        bannerText: style(cell('Még mindig')).color,
      };
    });
    assert.ok(look.zoom > 0.55 && look.zoom < 0.65, `a 604px email in a 366px frame zooms to about 0.6, not ${look.zoom}`);
    assert.equal(look.banner, 'rgb(14, 23, 53)', 'the dark banner keeps its color');
    assert.equal(look.bannerText, 'rgb(255, 255, 255)');
    if (colorScheme === 'dark') {
      assert.equal(look.light, 'rgb(35, 35, 35)', 'a light cell turns dark');
      assert.equal(look.lightText, 'rgb(230, 230, 230)', 'its black text turns light');
    } else {
      assert.equal(look.light, 'rgb(244, 244, 244)');
      assert.equal(look.lightText, 'rgb(0, 0, 0)');
    }
    await page.screenshot({ path: `${screenshots}newsletter-${colorScheme}.png`, animations: 'disabled' });
    assert.deepEqual(errors, []);
    await page.context().close();
  });
}

test('cards have no buttons of their own; reply, from the read view, opens the conversation in Gmail', async () => {
  const gmail = new FakeGmail(sampleThreads(3));
  const { page } = await open(gmail);
  await page.context().route('https://mail.google.com/**', route => route.fulfill({ body: 'Gmail' }));
  await waitForCard(page);
  assert.equal(await page.locator('.swipe-card button').count(), 0, 'the card itself has no buttons');
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

  assert.equal(await page.locator('.swipe-card button').count(), 0, 'the card itself has no buttons');
  await page.keyboard.press('ArrowUp');
  const view = page.locator('dialog.read-view');
  await view.waitFor();
  await view.getByRole('button', { name: 'Unsubscribe and archive' }).click();
  await page.getByRole('status').filter({ hasText: 'Unsubscribed and archived' }).waitFor();
  await settle(gmail, 2);
  assert.deepEqual(sent, [{ method: 'POST', body: 'List-Unsubscribe=One-Click', cookie: undefined }]);
  assert.deepEqual(
    gmail.changes[1],
    { thread: 'thread000', op: 'modify', add: [], remove: ['INBOX'] },
    'opening it marked it read',
  );
  assert.equal(await topSubject(page), 'Message number 2');

  await page.keyboard.press('ArrowUp');
  await view.waitFor();
  const [popup] = await Promise.all([
    page.waitForEvent('popup'),
    view.getByRole('button', { name: 'Unsubscribe and archive' }).click(),
  ]);
  assert.equal(popup.url(), 'https://shop.example/preferences');
  await page.getByRole('status').filter({ hasText: 'Finish unsubscribing in the new tab' }).waitFor();
  await settle(gmail, 4);
  assert.deepEqual(gmail.changes[3], { thread: 'thread001', op: 'modify', add: [], remove: ['INBOX'] });
  assert.deepEqual(errors, []);
  await page.context().close();
});

test('a swipe set to all from the sender sorts every unread conversation from them, with one undo', async () => {
  const fromSender = (action: string) => ({ action, labels: [], archive: true, allFromSender: true });
  const settings = {
    piles: [
      {
        id: 'unread',
        name: 'Unread',
        filters: { read: 'unread', where: 'inbox' },
        swipes: { right: fromSender('archive'), down: fromSender('skip') },
      },
    ],
  };
  const gmail = new FakeGmail(sampleThreads(12));
  const { page, errors } = await open(gmail, { settings });
  await waitForCard(page);
  await page
    .locator('.action-bar')
    .getByRole('button', { name: /Archive \+1 all/ })
    .waitFor();
  await page.screenshot({ path: `${screenshots}all-from-sender.png` });

  await page.keyboard.press('ArrowRight');
  await page.getByRole('status').filter({ hasText: 'Archived: 3 conversations' }).waitFor();
  await settle(gmail, 3);
  assert.deepEqual(gmail.changes.map(change => change.thread).toSorted(), ['thread000', 'thread004', 'thread008']);
  assert.equal(await topSubject(page), 'Message number 2');
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
  await page.waitForFunction(() => document.querySelector('.swipe-card .mail-card-subject')?.textContent === 'Message number 1');
  await waitForCount(page, 'Unread · 12');

  await page.keyboard.press('ArrowDown');
  await page.getByRole('status').filter({ hasText: 'Skipped: 3 conversations' }).waitFor();
  for (const subject of ['Message number 2', 'Message number 3', 'Message number 4']) {
    await page.waitForFunction(text => document.querySelector('.swipe-card .mail-card-subject')?.textContent === text, subject);
    await page.keyboard.press('ArrowDown');
    await page.getByRole('status').filter({ hasText: 'Skipped: 3 conversations' }).waitFor();
  }
  await page.getByRole('heading', { name: 'Nothing left to sort' }).waitFor();
  assert.equal(gmail.changes.length, 6, 'skip changes nothing in Gmail');

  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByRole('button', { name: /^Edit Unread/ }).click();
  await page.getByRole('button', { name: 'Right swipe: Mark read, archive, all from the sender' }).click();
  assert.ok(await page.getByRole('switch', { name: /All from this sender/ }).isChecked());
  await addAction(page, 'Read');
  assert.equal(await page.getByRole('switch', { name: /All from this sender/ }).count(), 0, 'reading is about one conversation');
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
  await page.getByRole('button', { name: 'Down swipe: Mark read' }).waitFor();
  await openSwipe(page, 'Left');
  await addAction(page, 'Skip');
  assert.deepEqual(await page.locator('.settings-group .row .row-title').first().textContent(), 'Skip', 'Skip stands alone');
  await settingsBack(page);
  await page.getByRole('button', { name: 'Left swipe: Skip' }).waitFor();
  await settingsBack(page);
  await page.getByRole('button', { name: /^Edit Read/ }).click();
  await page.getByRole('button', { name: 'Down swipe: Skip' }).waitFor();
  await openSwipe(page, 'Left');
  await page.getByRole('button', { name: 'Remove Delete' }).click();
  await addAction(page, 'Archive');
  // The phone's Back steps up: the swipe, the pile, the list of piles, then out of Settings.
  const title = page.locator('#dialog-title');
  await page.goBack();
  await page.waitForFunction(() => document.querySelector('#dialog-title')?.textContent === 'Read');
  await page.goBack();
  await page.waitForFunction(() => document.querySelector('#dialog-title')?.textContent === 'Settings');
  assert.equal(await title.textContent(), 'Settings');
  await page.goBack();
  await page.locator('dialog').waitFor({ state: 'hidden' });
  assert.equal(new URL(page.url()).origin, new URL(base).origin, 'Back closed Settings and stayed in the app');

  await page.reload();
  await waitForCard(page);
  await page.keyboard.press('ArrowLeft');
  await page.getByRole('status').filter({ hasText: 'Skipped' }).waitFor();
  assert.equal(await topSubject(page), 'Message number 2');

  await pileTab(page, 'Read').click();
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
  await openSwipe(page, 'Down');
  await page.getByRole('button', { name: 'Remove Mark read' }).click();
  await page.getByText('Choose what the down swipe does. Until then, this change is not saved.').waitFor();
  await settingsBack(page);
  await settingsBack(page);
  // The phone's Back from the list of piles would leave Settings: it asks first, as Close does.
  await page.goBack();
  await page.getByRole('heading', { name: 'Leave without this change?' }).waitFor();
  await page.screenshot({ path: `${screenshots}settings-leave.png`, animations: 'disabled' });
  await page.getByRole('button', { name: 'Fix it' }).click();
  await page.getByRole('button', { name: 'Add an action' }).click();
  await page.screenshot({ path: `${screenshots}settings-add-action.png` });
  await page.getByRole('button', { name: /^Add label/ }).click();
  assert.deepEqual(await page.locator('.settings-group .row .row-title').allTextContents(), ['Receipts'], 'only user labels');
  await page.getByRole('button', { name: 'Receipts', exact: true }).click();
  await page.getByText('Choose what the down swipe does.').waitFor({ state: 'hidden' });
  await page.getByRole('button', { name: 'Add an action' }).click();
  await page.getByRole('button', { name: /^Add label/ }).click();
  assert.equal(await page.getByRole('button', { name: 'Receipts' }).isDisabled(), true, 'a label already added is dimmed');
  await page.getByLabel('New label').fill('todo accounting');
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await page.getByRole('button', { name: 'Remove Add label todo accounting' }).waitFor();
  const todo = gmail.labelList.find(label => label.name === 'todo accounting')!;
  assert.ok(todo, 'the new label is created in Gmail as soon as it is added');
  await addAction(page, 'Archive');
  assert.deepEqual(await page.locator('.settings-group').first().locator('.row-text').allTextContents(), [
    'Add labelReceipts',
    'Add labeltodo accounting',
    'Archive',
  ]);
  await page.screenshot({ path: `${screenshots}settings-labels.png` });
  await closeSettings(page);
  await page.locator('dialog').waitFor({ state: 'hidden' });

  await page.keyboard.press('ArrowDown');
  await page.getByRole('status').filter({ hasText: 'Labeled Receipts, labeled todo accounting and archived' }).waitFor();
  await settle(gmail, 1);
  assert.deepEqual(gmail.changes[0], { thread: 'thread000', op: 'modify', add: ['Label_receipts', todo.id], remove: ['INBOX'] });
  assert.ok(gmail.labels('thread000').includes('UNREAD'), 'still unread');

  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByRole('button', { name: 'New pile' }).click();
  await page.getByLabel('Name', { exact: true }).fill('Accounting');
  await page.getByRole('combobox', { name: 'Read or unread' }).selectOption('any');
  await page.getByRole('combobox', { name: 'Where' }).selectOption('anywhere');
  await page.getByRole('button', { name: /^Has labels/ }).click();
  await page.getByRole('checkbox', { name: 'todo accounting' }).check();
  await settingsBack(page);
  await openSwipe(page, 'Right');
  await page.getByRole('button', { name: 'Remove Mark read' }).click();
  await page.getByRole('button', { name: 'Remove Archive' }).click();
  await page.getByRole('button', { name: 'Add an action' }).click();
  await page.getByRole('button', { name: /^Remove label/ }).click();
  assert.equal(
    await page.locator('.settings-group .row .row-title').first().textContent(),
    'todo accounting',
    "the pile's own label comes first",
  );
  await page.getByRole('button', { name: 'todo accounting', exact: true }).click();
  await settingsBack(page);
  await page.locator('.group-note', { hasText: 'Anywhere · read or unread · has todo accounting' }).waitFor();
  await page.screenshot({ path: `${screenshots}settings-pile.png` });
  await settingsBack(page);
  await page.screenshot({ path: `${screenshots}settings.png` });
  await closeSettings(page);
  await page.locator('dialog').waitFor({ state: 'hidden' });

  await waitForCount(page, 'Accounting · 1');
  await pileTab(page, 'Accounting').click();
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
  assert.equal(await pileTab(page, 'Anna').getAttribute('title'), "About 2 (Gmail's estimate)");
  assert.equal(await topSubject(page), 'Message number 1');
  await page.keyboard.press('ArrowDown');
  await page.waitForFunction(() => document.querySelector('.swipe-card .mail-card-subject')?.textContent === 'Message number 9');
  await page.keyboard.press('ArrowDown');
  await page.getByText('Nothing left in Anna.').waitFor();
  assert.deepEqual(errors, []);
  await page.context().close();
});

test('More filters have a page of their own, and a pile built with them loads its mail', async () => {
  const gmail = new FakeGmail(sampleThreads(12));
  const { page, errors } = await open(gmail);
  await waitForCard(page);
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByRole('button', { name: 'New pile' }).click();
  await page.getByLabel('Name', { exact: true }).fill('Anna');
  await page.getByRole('combobox', { name: 'Read or unread' }).selectOption('any');
  await page.getByRole('button', { name: /^More filters/ }).click();
  await page.getByRole('combobox', { name: 'Category' }).selectOption('updates');
  await page.getByLabel('Older than, amount').fill('6');
  await page.getByLabel('Older than, unit').selectOption('m');
  await page.getByLabel('From', { exact: true }).fill('anna@example.com');
  await page.getByRole('switch', { name: 'Has an attachment' }).check();
  await page.screenshot({ path: `${screenshots}settings-more-filters.png` });
  await settingsBack(page);
  await page
    .getByRole('button', { name: /^More filters/ })
    .filter({ hasText: 'Updates · older than 6 months · from anna@example.com · with attachment' })
    .waitFor();
  await settingsBack(page);
  await closeSettings(page);
  await page.locator('dialog').waitFor({ state: 'hidden' });

  await waitForCount(page, 'Anna · ~3');
  await pileTab(page, 'Anna').click();
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
  await settingsBack(page);
  await page.getByRole('button', { name: 'New pile' }).click();
  await page.getByRole('button', { name: 'Delete this pile' }).click();
  await page.getByRole('heading', { name: 'Delete New pile?' }).waitFor();
  await page.screenshot({ path: `${screenshots}dark-delete.png`, animations: 'disabled' });
  await page.locator('dialog.basic-dialog').getByRole('button', { name: 'Delete', exact: true }).click();
  await page.getByRole('button', { name: /^Edit New pile/ }).waitFor({ state: 'detached' });
  await page.screenshot({ path: `${screenshots}dark-settings-list.png` });
  await page.getByRole('button', { name: 'Close' }).click();
  await page.locator('dialog').first().waitFor({ state: 'hidden' });
  assert.deepEqual(await tabLabels(page), ['Unread · 3'], 'the deleted pile is gone, saved without a Save button');
  assert.deepEqual(errors, []);
  await page.context().close();

  const { page: welcome } = await open(null, { colorScheme: 'dark' });
  await welcome.route('**/api/auth/token', route => route.fulfill({ status: 401, json: { error: 'signed-out' } }));
  await welcome.reload();
  await welcome.getByRole('link', { name: 'Sign in with Google' }).waitFor();
  await welcome.screenshot({ path: `${screenshots}dark-welcome.png` });
  await welcome.context().close();
});

test('piles reorder by dragging their handle, or with the arrow keys on it', async () => {
  const threads = sampleThreads(6).map((thread, index) =>
    index < 3 ? thread : { ...thread, labelIds: thread.labelIds.filter(label => label !== 'UNREAD') },
  );
  const gmail = new FakeGmail(threads);
  const { page, errors } = await open(gmail, { settings: unreadAndRead });
  await waitForCard(page);
  await page.getByRole('button', { name: 'Settings' }).click();
  const names = () => page.locator('.pile-row .row-title').allTextContents();
  assert.deepEqual(await names(), ['Unread', 'Read']);

  const handle = page.getByRole('button', { name: /^Move Read/ });
  const box = (await handle.boundingBox())!;
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x, y - box.height * 0.6, { steps: 6 });
  await page.screenshot({ path: `${screenshots}settings-drag.png` });
  await page.mouse.move(x, y - box.height * 1.1, { steps: 6 });
  await page.mouse.up();
  assert.deepEqual(await names(), ['Read', 'Unread'], 'dragged above Unread');

  await page.getByRole('button', { name: /^Move Read/ }).press('ArrowDown');
  assert.deepEqual(await names(), ['Unread', 'Read'], 'moved back down with a key');
  await page.getByRole('button', { name: /^Move Unread/ }).press('ArrowDown');
  assert.deepEqual(await names(), ['Read', 'Unread']);

  await closeSettings(page);
  await page.locator('dialog').waitFor({ state: 'hidden' });
  assert.deepEqual(await tabLabels(page), ['Read · 3', 'Unread · 3']);
  assert.deepEqual(errors, []);
  await page.context().close();
});

test("the phone's Back, a close request to the dialog, steps up one level at a time, even pressed in a row", async () => {
  const gmail = new FakeGmail(sampleThreads(3));
  const { page, errors } = await open(gmail);
  await waitForCard(page);
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByRole('button', { name: /^Edit Unread/ }).click();
  await openSwipe(page, 'Left');
  await page.locator('dialog.settings-dialog').getByRole('button', { name: 'Add an action' }).click();
  const title = () => page.locator('#dialog-title').textContent();
  assert.equal(await title(), 'Add an action');
  // Escape is the same close request as Android's Back; pressed in a row, Chrome lets only the first be stopped.
  for (const expected of ['← Left swipe', 'Unread', 'Settings']) {
    await page.keyboard.press('Escape');
    await page.waitForFunction(text => document.querySelector('#dialog-title')?.textContent === text, expected);
  }
  await page.keyboard.press('Escape');
  await page.locator('dialog.settings-dialog').waitFor({ state: 'detached' });
  assert.equal(await topSubject(page), 'Message number 1', 'Settings closed onto the deck');

  await page.keyboard.press('ArrowUp');
  await page.locator('dialog.read-view').waitFor();
  await page.keyboard.press('Escape');
  await page.locator('dialog.read-view').waitFor({ state: 'detached' });
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
  await page.screenshot({ path: `${screenshots}pile-tabs.png` });
  const markRead = page.locator('.action-bar').getByRole('button', { name: 'Mark read', exact: true });
  assert.equal(await markRead.count(), 1, 'down marks unread mail read');

  await pileTab(page, 'Read').click();
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

  await pileTab(page, 'Unread').click();
  await page.waitForFunction(() => document.querySelector('.swipe-card .mail-card-subject')?.textContent === 'Message number 1');
  await page.keyboard.press('Control+z');
  await settle(gmail, 2);
  assert.deepEqual(gmail.changes[1], { thread: 'thread003', op: 'modify', add: ['INBOX'], remove: [] });
  await waitForCount(page, 'Read · 3');

  await pileTab(page, 'Read').click();
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
