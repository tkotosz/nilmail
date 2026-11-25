// A small in-memory Gmail behind Playwright's request routing: enough of the REST API for the app's calls, plus a log
// of every change so tests can check what reached Gmail.
import type { Page, Route } from 'playwright-core';

export interface FakeThread {
  id: string;
  from: string;
  subject: string;
  snippet: string;
  html?: string;
  text?: string;
  labelIds: string[];
  date: number;
  messages?: number;
  /** List-Unsubscribe and List-Unsubscribe-Post headers of the latest message. */
  unsubscribe?: { list: string; post?: string };
}

export type Change =
  { thread: string; op: 'modify'; add: string[]; remove: string[] } | { thread: string; op: 'trash' | 'untrash' };

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};

const base64Url = (text: string) => Buffer.from(text, 'utf8').toString('base64url');

const logo =
  'data:image/svg+xml,' +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="560" height="90"><rect width="560" height="90" fill="#fff"/><text x="40" y="60" font-family="Arial" font-weight="bold" font-size="40" fill="#000">SAMSUNG</text></svg>',
  );
/** A newsletter built like many real ones: a fixed 600px table, a logo picture, light cells and a dark banner. */
export const newsletterHtml = `<table role="presentation" width="600" style="width:600px;margin:0 auto;border-collapse:collapse" cellpadding="0" cellspacing="0">
<tr><td style="background:#ffffff;padding:20px;font:13px Arial;color:#555">Csapj le a Black Friday hetek ajánlataira!</td><td style="background:#ffffff;padding:20px;font:13px Arial;text-align:right"><a href="https://example.com" style="color:#555">Online megtekintés</a></td></tr>
<tr><td colspan="2"><img src="${logo}" width="600" alt="Samsung"></td></tr>
<tr><td style="background:#f4f4f4;padding:30px;font:16px Arial;color:#000"><b>Samsung hűségprogram</b><br>Te már a(z) Kék tagok közé tartozol!</td><td style="background:#f4f4f4;padding:30px;font:bold 16px Arial;color:#000;border-left:2px solid #000">Gyűjts Samsung hűségprogram pontokat minden alkalommal!</td></tr>
<tr><td colspan="2" style="background:#0e1735;padding:40px;font:bold 44px Arial;color:#ffffff;text-align:center">Még mindig várnak rád a Black Friday hetek ajánlatai!</td></tr>
</table>`;

const dot = (color: string) =>
  'data:image/svg+xml,' +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"><circle cx="12" cy="12" r="12" fill="${color}"/></svg>`,
  );
/** A notification built like GitHub's: a full-width table whose Status column holds only 24px icons. */
export const githubHtml = `<table width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;margin:0 auto"><tr><td style="padding:16px">
<table width="100%" style="border:1px solid #d0d7de;border-radius:6px;border-collapse:separate"><tr><td align="center" style="padding:24px;font:24px Arial">CI: Some jobs were not successful<br><br><a href="https://example.com" style="background:#1f883d;color:#ffffff;padding:12px 20px;border-radius:6px;text-decoration:none;font-size:16px">View workflow run</a></td></tr>
<tr><td style="border-top:1px solid #d0d7de;padding:16px"><table width="100%" style="font:16px Arial">
<tr><th align="left" style="padding:8px">Status</th><th align="left" style="padding:8px">Job</th><th align="left" style="padding:8px">Annotations</th></tr>
<tr><td style="padding:8px"><img class="status" src="${dot('#1a7f37')}" width="24" height="24" alt="Succeeded"></td><td style="padding:8px"><b>CI</b> / Browser tests<br>Succeeded in 2 minutes and 46 seconds</td><td></td></tr>
<tr><td style="padding:8px"><img class="status" src="${dot('#cf222e')}" width="24" height="24" alt="Failed"></td><td style="padding:8px"><b>CI</b> / Lint, build and unit tests<br>Failed in 27 seconds</td><td style="padding:8px">3</td></tr>
</table></td></tr></table></td></tr></table>`;

export function sampleThreads(count: number, start = Date.UTC(2026, 10, 21, 9)): FakeThread[] {
  const senders = [
    'Anna Kovács <anna@example.com>',
    'GitHub <noreply@github.com>',
    '"Bank, The" <alerts@bank.example>',
    'Peter <peter@example.org>',
  ];
  return Array.from({ length: count }, (_, index) => ({
    id: `thread${String(index).padStart(3, '0')}`,
    from: senders[index % senders.length]!,
    subject: `Message number ${index + 1}`,
    snippet: `Preview of message ${index + 1} &amp; some more text so the card has something to show.`,
    html: `<h1>Message ${index + 1}</h1><p>Hello from the fake Gmail.</p><p><a href="https://example.com/${index}">A link</a></p>`,
    labelIds: ['INBOX', 'UNREAD'],
    date: start - index * 3_600_000,
    messages: index % 3 === 0 ? 2 : 1,
  }));
}

export class FakeGmail {
  readonly threads = new Map<string, FakeThread>();
  readonly changes: Change[] = [];
  readonly requests: string[] = [];
  /** The user's labels; Gmail also lists its own system labels, which the app must leave out. */
  readonly labelList: { id: string; name: string; type: 'user' | 'system' }[] = [
    { id: 'INBOX', name: 'INBOX', type: 'system' },
    { id: 'STARRED', name: 'STARRED', type: 'system' },
  ];
  /** Answer every change with this status instead, to test failures. */
  failChanges: number | null = null;

  constructor(threads: FakeThread[]) {
    for (const thread of threads) this.threads.set(thread.id, structuredClone(thread));
  }

  labels(id: string): string[] {
    return this.threads.get(id)!.labelIds;
  }

  /** The label's name as Gmail search writes it: spaces become hyphens, in any case. */
  private searchName(id: string): string | undefined {
    return this.labelList
      .find(label => label.id === id)
      ?.name.toLowerCase()
      .replace(/\s+/g, '-');
  }

  /**
   * Threads outside the Bin that have every label of `labelIds` and match the search terms the app writes: `is:unread`,
   * `is:read`, `in:inbox`, `-in:inbox`, `-label:"name"` and `from:"address"`. Other terms are ignored.
   */
  private matching(q = '', labelIds: string[] = []): FakeThread[] {
    const from = /from:"([^"]+)"/.exec(q)?.[1];
    const lacking = [...q.matchAll(/-label:"([^"]+)"/g)].map(match => match[1]!.toLowerCase());
    const has = (thread: FakeThread, label: string) => thread.labelIds.includes(label);
    return [...this.threads.values()]
      .filter(thread => !has(thread, 'TRASH'))
      .filter(thread => labelIds.every(label => has(thread, label)))
      .filter(thread => !/(^|\s)is:unread/.test(q) || has(thread, 'UNREAD'))
      .filter(thread => !/(^|\s)is:read/.test(q) || !has(thread, 'UNREAD'))
      .filter(thread => !/(^|\s)in:inbox/.test(q) || has(thread, 'INBOX'))
      .filter(thread => !/(^|\s)-in:inbox/.test(q) || !has(thread, 'INBOX'))
      .filter(thread => !thread.labelIds.some(label => lacking.includes(this.searchName(label) ?? '')))
      .filter(thread => !from || thread.from.includes(`<${from}>`))
      .sort((a, b) => b.date - a.date);
  }

  private threadJson(thread: FakeThread, format: string) {
    const count = thread.messages ?? 1;
    return {
      id: thread.id,
      messages: Array.from({ length: count }, (_, index) => {
        const latest = index === count - 1;
        const headers = [
          { name: 'From', value: latest ? thread.from : 'Me <me@example.com>' },
          { name: 'To', value: 'me@example.com' },
          { name: 'Subject', value: thread.subject },
          ...(latest && thread.unsubscribe
            ? [
                { name: 'List-Unsubscribe', value: thread.unsubscribe.list },
                ...(thread.unsubscribe.post ? [{ name: 'List-Unsubscribe-Post', value: thread.unsubscribe.post }] : []),
              ]
            : []),
        ];
        const body = latest ? thread : { html: undefined, text: `Earlier message ${index + 1}` };
        return {
          id: `${thread.id}-m${index}`,
          threadId: thread.id,
          labelIds: latest ? thread.labelIds : thread.labelIds.filter(label => label !== 'UNREAD'),
          snippet: latest ? thread.snippet : `Earlier message ${index + 1}`,
          internalDate: String(thread.date - (count - 1 - index) * 60_000),
          payload:
            format === 'full'
              ? {
                  mimeType: 'multipart/alternative',
                  headers,
                  parts: [
                    ...(body.text ? [{ mimeType: 'text/plain', body: { data: base64Url(body.text) } }] : []),
                    ...(body.html ? [{ mimeType: 'text/html', body: { data: base64Url(body.html) } }] : []),
                  ],
                }
              : { mimeType: 'multipart/alternative', headers },
        };
      }),
    };
  }

  private async handle(route: Route) {
    const request = route.request();
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    const url = new URL(request.url());
    const path = url.pathname.replace('/gmail/v1/users/me', '');
    this.requests.push(`${request.method()} ${path}`);
    const reply = (json: unknown, status = 200) => route.fulfill({ status, headers: cors, json });

    if (path === '/profile') return reply({ emailAddress: 'me@example.com' });
    if (path === '/labels' && request.method() === 'GET') return reply({ labels: this.labelList });
    if (path === '/labels' && request.method() === 'POST') {
      const { name } = request.postDataJSON() as { name: string };
      const label = { id: `Label_${this.labelList.length + 1}`, name, type: 'user' as const };
      this.labelList.push(label);
      return reply(label);
    }
    const label = /^\/labels\/([^/]+)$/.exec(path);
    if (label && request.method() === 'GET') {
      const id = decodeURIComponent(label[1]!);
      const labeled = this.matching('', [id]);
      return reply({
        id,
        threadsTotal: labeled.length,
        threadsUnread: labeled.filter(thread => thread.labelIds.includes('UNREAD')).length,
      });
    }
    if (path === '/threads') {
      const all = this.matching(url.searchParams.get('q') ?? '', url.searchParams.getAll('labelIds'));
      const size = Number(url.searchParams.get('maxResults') ?? 100);
      const start = Number(url.searchParams.get('pageToken') ?? 0);
      const page = all.slice(start, start + size);
      return reply({
        threads: page.map(thread => ({ id: thread.id })),
        nextPageToken: start + size < all.length ? String(start + size) : undefined,
        resultSizeEstimate: all.length,
      });
    }
    const match = /^\/threads\/([^/]+)(?:\/(modify|trash|untrash))?$/.exec(path);
    const thread = match && this.threads.get(match[1]!);
    if (!match || !thread) return reply({ error: { message: 'Not found' } }, 404);
    if (!match[2]) return reply(this.threadJson(thread, url.searchParams.get('format') ?? 'full'));

    if (this.failChanges) return reply({ error: { message: 'Refused' } }, this.failChanges);
    if (match[2] === 'modify') {
      const { addLabelIds = [], removeLabelIds = [] } = request.postDataJSON() as {
        addLabelIds?: string[];
        removeLabelIds?: string[];
      };
      thread.labelIds = [
        ...thread.labelIds.filter(label => !removeLabelIds.includes(label)),
        ...addLabelIds.filter(label => !thread.labelIds.includes(label)),
      ];
      this.changes.push({ thread: thread.id, op: 'modify', add: addLabelIds, remove: removeLabelIds });
    } else if (match[2] === 'trash') {
      thread.labelIds = [...thread.labelIds.filter(label => label !== 'INBOX'), 'TRASH'];
      this.changes.push({ thread: thread.id, op: 'trash' });
    } else {
      thread.labelIds = thread.labelIds.filter(label => label !== 'TRASH');
      this.changes.push({ thread: thread.id, op: 'untrash' });
    }
    return reply(this.threadJson(thread, 'minimal'));
  }

  /** Routes the page's Gmail calls here, and hands out access tokens in place of the Worker. */
  async attach(page: Page): Promise<void> {
    await page.route('https://gmail.googleapis.com/**', route => this.handle(route));
    await page.route('**/api/auth/token', route => route.fulfill({ json: { accessToken: 'fake-token', expiresIn: 3600 } }));
  }
}
