import type { GmailSearch, GmailStep } from './types.ts';

// The parts of the Gmail API's thread resource this app reads.
// https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.threads

export interface GmailHeader {
  name: string;
  value: string;
}

export interface GmailPart {
  partId?: string;
  mimeType?: string;
  filename?: string;
  headers?: GmailHeader[];
  body?: { size?: number; data?: string; attachmentId?: string };
  parts?: GmailPart[];
}

export interface GmailMessage {
  id: string;
  threadId: string;
  labelIds?: string[];
  snippet?: string;
  /** Milliseconds since the epoch, as a string. */
  internalDate?: string;
  payload?: GmailPart;
}

export interface GmailThread {
  id: string;
  messages?: GmailMessage[];
}

/** The Gmail calls the core needs; the web app implements them over HTTP. */
export interface Gmail {
  listThreads(search: GmailSearch, pageToken?: string): Promise<{ ids: string[]; nextPageToken?: string }>;
  /** `metadata` brings only the headers a card shows, such as From and Subject; `full` brings the bodies too. */
  getThread(id: string, format: 'metadata' | 'full'): Promise<GmailThread>;
  modifyThread(id: string, add: string[], remove: string[]): Promise<void>;
  trashThread(id: string): Promise<void>;
  untrashThread(id: string): Promise<void>;
}

/** Applies the steps to a thread, one after the other. */
export async function applyToGmail(gmail: Gmail, threadId: string, steps: GmailStep[]): Promise<void> {
  for (const step of steps) {
    if (step.op === 'modify') await gmail.modifyThread(threadId, step.add, step.remove);
    else if (step.op === 'trash') await gmail.trashThread(threadId);
    else await gmail.untrashThread(threadId);
  }
}

/**
 * Applies each thread's steps, a few threads at a time so Gmail's per-user rate limit holds. Threads Gmail refuses are
 * reported with the first error, instead of stopping the others.
 */
export async function applyChanges(
  gmail: Gmail,
  changes: { threadId: string; steps: GmailStep[] }[],
  parallel = 3,
): Promise<{ failed: string[]; error?: unknown }> {
  const failed: string[] = [];
  let error: unknown;
  const pending = changes.filter(change => change.steps.length);
  for (let start = 0; start < pending.length; start += parallel) {
    await Promise.all(
      pending.slice(start, start + parallel).map(change =>
        applyToGmail(gmail, change.threadId, change.steps).catch((reason: unknown) => {
          failed.push(change.threadId);
          error ??= reason;
        }),
      ),
    );
  }
  return error === undefined ? { failed } : { failed, error };
}
