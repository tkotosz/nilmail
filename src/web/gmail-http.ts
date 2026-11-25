import type { Gmail, GmailThread } from '../core/gmail.ts';
import type { GmailLabel, GmailSearch } from '../core/types.ts';
import { SessionError, type Session } from './session.ts';

// The Gmail API over HTTP, called straight from the browser with the session's access token.
// https://developers.google.com/workspace/gmail/api/reference/rest

const base = 'https://gmail.googleapis.com/gmail/v1/users/me';

/** The headers a card needs; see `cardFromThread`. */
const metadataHeaders = ['From', 'Subject', 'Date', 'List-Unsubscribe', 'List-Unsubscribe-Post'];

export class GmailError extends Error {
  /** The HTTP status, or 0 when Gmail could not be reached. */
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/** A label's own numbers of conversations. */
export interface LabelCounts {
  total: number;
  unread: number;
}

export interface WebGmail extends Gmail {
  /** How many conversations have the label, and how many of those are unread, without listing any. */
  labelCounts(labelId: string): Promise<LabelCounts>;
  /** Gmail's estimate of how many conversations match the search: one list call asking for a single result. */
  estimateThreads(search: GmailSearch): Promise<number>;
  emailAddress(): Promise<string>;
  /** The labels the user made, by name. */
  userLabels(): Promise<GmailLabel[]>;
  createLabel(name: string): Promise<GmailLabel>;
}

/** A thread search as list parameters: the search text, and each label the threads must have. */
function searchParams(search: GmailSearch, maxResults: number): URLSearchParams {
  const params = new URLSearchParams({ maxResults: String(maxResults) });
  if (search.q) params.set('q', search.q);
  for (const id of search.labelIds) params.append('labelIds', id);
  return params;
}

export function httpGmail(session: Session): WebGmail {
  async function call<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
    const send = async (token: string) => {
      try {
        return await fetch(`${base}${path}`, {
          method: init.method ?? 'GET',
          headers: {
            Authorization: `Bearer ${token}`,
            ...(init.body === undefined ? {} : { 'Content-Type': 'application/json' }),
          },
          body: init.body === undefined ? undefined : JSON.stringify(init.body),
        });
      } catch {
        throw new GmailError(0, 'Gmail could not be reached.');
      }
    };
    let response = await send(await session.accessToken());
    // The token can expire or be revoked between two requests: ask for a new one once.
    if (response.status === 401) response = await send(await session.accessToken(true));
    if (response.status === 401) throw new SessionError('signed-out');
    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as { error?: { message?: string } } | null;
      throw new GmailError(response.status, body?.error?.message ?? `Gmail answered ${response.status}.`);
    }
    const text = await response.text();
    return (text ? JSON.parse(text) : null) as T;
  }

  return {
    async listThreads(search, pageToken) {
      const params = searchParams(search, 50);
      if (pageToken) params.set('pageToken', pageToken);
      const page = await call<{ threads?: { id: string }[]; nextPageToken?: string }>(`/threads?${params}`);
      return { ids: (page.threads ?? []).map(thread => thread.id), nextPageToken: page.nextPageToken };
    },
    getThread(id, format) {
      const params = new URLSearchParams({ format });
      if (format === 'metadata') for (const name of metadataHeaders) params.append('metadataHeaders', name);
      return call<GmailThread>(`/threads/${encodeURIComponent(id)}?${params}`);
    },
    async modifyThread(id, add, remove) {
      await call(`/threads/${encodeURIComponent(id)}/modify`, {
        method: 'POST',
        body: { addLabelIds: add, removeLabelIds: remove },
      });
    },
    async trashThread(id) {
      await call(`/threads/${encodeURIComponent(id)}/trash`, { method: 'POST' });
    },
    async untrashThread(id) {
      await call(`/threads/${encodeURIComponent(id)}/untrash`, { method: 'POST' });
    },
    async labelCounts(labelId) {
      const { threadsTotal = 0, threadsUnread = 0 } = await call<{ threadsTotal?: number; threadsUnread?: number }>(
        `/labels/${encodeURIComponent(labelId)}`,
      );
      return { total: threadsTotal, unread: threadsUnread };
    },
    async estimateThreads(search) {
      return (await call<{ resultSizeEstimate?: number }>(`/threads?${searchParams(search, 1)}`)).resultSizeEstimate ?? 0;
    },
    async emailAddress() {
      return (await call<{ emailAddress: string }>('/profile')).emailAddress;
    },
    async userLabels() {
      const { labels = [] } = await call<{ labels?: (GmailLabel & { type?: string })[] }>('/labels');
      return labels
        .filter(label => label.type === 'user')
        .map(({ id, name }) => ({ id, name }))
        .toSorted((a, b) => a.name.localeCompare(b.name));
    },
    async createLabel(name) {
      const { id } = await call<GmailLabel>('/labels', {
        method: 'POST',
        body: { name, labelListVisibility: 'labelShow', messageListVisibility: 'show' },
      });
      return { id, name };
    },
  };
}

/** Opens the conversation in Gmail: the Gmail app on Android when it handles Gmail links, the website otherwise. */
export const gmailLink = (email: string, threadId: string) =>
  `https://mail.google.com/mail/?authuser=${encodeURIComponent(email)}#all/${encodeURIComponent(threadId)}`;

/** A sentence for the user about a failed Gmail call. */
export function problemText(error: unknown): string {
  if (error instanceof GmailError && error.status === 0) return 'Gmail could not be reached. Check your connection.';
  if (error instanceof GmailError && error.status === 429) return 'Gmail asks to slow down. Try again in a minute.';
  if (error instanceof GmailError && error.status === 404) return 'That conversation no longer exists in Gmail.';
  if (error instanceof SessionError && error.code === 'offline') return 'You are offline.';
  return 'Gmail refused the change. Try again.';
}
