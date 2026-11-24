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
  /** Answer every change with this status instead, to test failures. */
  failChanges: number | null = null;

  constructor(threads: FakeThread[]) {
    for (const thread of threads) this.threads.set(thread.id, structuredClone(thread));
  }

  labels(id: string): string[] {
    return this.threads.get(id)!.labelIds;
  }

  /** Unread inbox threads; of these, a search with `from:"address"` matches only that sender's. */
  private matching(query = ''): FakeThread[] {
    const from = /from:"([^"]+)"/.exec(query)?.[1];
    return [...this.threads.values()]
      .filter(thread => thread.labelIds.includes('INBOX') && thread.labelIds.includes('UNREAD'))
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
    if (path === '/labels/INBOX') return reply({ id: 'INBOX', threadsUnread: this.matching().length });
    if (path === '/threads') {
      const all = this.matching(url.searchParams.get('q') ?? '');
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
