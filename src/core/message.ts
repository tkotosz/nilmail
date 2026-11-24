import type { GmailHeader, GmailMessage, GmailPart, GmailThread } from './gmail.ts';
import type { MailCard, MessageView, Person, ThreadView, Unsubscribe } from './types.ts';

export function header(headers: GmailHeader[] | undefined, name: string): string {
  const wanted = name.toLowerCase();
  return headers?.find(item => item.name.toLowerCase() === wanted)?.value ?? '';
}

/** Reads a From header such as `"Doe, Jane" <jane@example.com>` or `jane@example.com`. */
export function parsePerson(value: string): Person {
  const match = /^\s*(.*?)\s*<([^<>]+)>\s*$/.exec(value);
  if (!match) return { name: value.trim(), address: value.trim() };
  const name = match[1]!
    .replace(/^"(.*)"$/, '$1')
    .replace(/\\(.)/g, '$1')
    .trim();
  const address = match[2]!.trim();
  return { name: name || address, address };
}

const namedEntities: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

/** Gmail's snippets are HTML-escaped text. */
export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (entity, code: string) => {
    if (code[0] === '#') {
      const point = code[1] === 'x' || code[1] === 'X' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(point) && point <= 0x10ffff ? String.fromCodePoint(point) : entity;
    }
    return namedEntities[code.toLowerCase()] ?? entity;
  });
}

const linkUrl = (value: string) => {
  try {
    return new URL(value.replace(/\s+/g, ''));
  } catch {
    return null;
  }
};

/**
 * Reads the List-Unsubscribe header, such as `<mailto:leave@example.com>, <https://example.com/leave?u=1>`, with its
 * List-Unsubscribe-Post companion. A one-click link beats a web page, which beats an email: it needs nothing from the
 * reader. One-click links must use https.
 * https://www.rfc-editor.org/rfc/rfc2369 and https://www.rfc-editor.org/rfc/rfc8058
 */
export function parseUnsubscribe(list: string, post: string): Unsubscribe | null {
  const urls = [...list.matchAll(/<([^<>]+)>/g)].map(match => linkUrl(match[1]!)).filter(url => url !== null);
  const web = urls.find(url => url.protocol === 'https:') ?? urls.find(url => url.protocol === 'http:');
  if (web?.protocol === 'https:' && /^\s*List-Unsubscribe\s*=\s*One-Click\s*$/i.test(post)) {
    return { kind: 'oneClick', url: web.href };
  }
  if (web) return { kind: 'web', url: web.href };
  const mailto = urls.find(url => url.protocol === 'mailto:');
  return mailto ? { kind: 'mailto', url: mailto.href } : null;
}

const latest = (thread: GmailThread): GmailMessage | undefined => thread.messages?.at(-1);

/** A thread fetched with the `metadata` format, as a card. */
export function cardFromThread(thread: GmailThread): MailCard {
  const messages = thread.messages ?? [];
  const last = latest(thread);
  const headers = last?.payload?.headers;
  return {
    threadId: thread.id,
    from: parsePerson(header(headers, 'From')),
    subject: header(headers, 'Subject') || '(no subject)',
    date: Number(last?.internalDate ?? 0),
    snippet: decodeEntities(last?.snippet ?? ''),
    messageCount: messages.length,
    // The metadata format has no parts; a mixed multipart message almost always carries attachments.
    hasAttachment: messages.some(message => message.payload?.mimeType === 'multipart/mixed'),
    labelIds: [...new Set(messages.flatMap(message => message.labelIds ?? []))],
    unsubscribe:
      messages
        .toReversed()
        .map(message => {
          const headers = message.payload?.headers;
          return parseUnsubscribe(header(headers, 'List-Unsubscribe'), header(headers, 'List-Unsubscribe-Post'));
        })
        .find(unsubscribe => unsubscribe !== null) ?? null,
  };
}

function base64UrlBytes(data: string): Uint8Array {
  const base64 = data.replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(base64), char => char.charCodeAt(0));
}

/**
 * Decodes a body part. Text that is valid UTF-8 is read as UTF-8 whatever the part declares, since mail often declares
 * the wrong character set; otherwise the declared one is used, and Latin-1 when that is unknown.
 */
export function decodeBody(data: string, contentType: string): string {
  const bytes = base64UrlBytes(data);
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    const charset = /charset="?([^";\s]+)"?/i.exec(contentType)?.[1] ?? 'iso-8859-1';
    try {
      return new TextDecoder(charset).decode(bytes);
    } catch {
      return new TextDecoder('iso-8859-1').decode(bytes);
    }
  }
}

function isAttachment(part: GmailPart): boolean {
  return Boolean(part.filename) || /^\s*attachment/i.test(header(part.headers, 'Content-Disposition'));
}

/** Every leaf part of a message, in order. */
function leaves(part: GmailPart | undefined): GmailPart[] {
  if (!part) return [];
  return part.parts?.length ? part.parts.flatMap(leaves) : [part];
}

export function messageView(message: GmailMessage): MessageView {
  const headers = message.payload?.headers;
  const parts = leaves(message.payload);
  const body = (mimeType: string) => {
    const part = parts.find(item => item.mimeType === mimeType && !isAttachment(item) && item.body?.data);
    return part ? decodeBody(part.body!.data!, header(part.headers, 'Content-Type')) : null;
  };
  const html = body('text/html');
  return {
    id: message.id,
    from: parsePerson(header(headers, 'From')),
    to: header(headers, 'To'),
    cc: header(headers, 'Cc'),
    subject: header(headers, 'Subject'),
    date: Number(message.internalDate ?? 0),
    snippet: decodeEntities(message.snippet ?? ''),
    html,
    text: html ? null : body('text/plain'),
    attachments: parts
      .filter(isAttachment)
      .map(part => ({ filename: part.filename || 'attachment', size: part.body?.size ?? 0 })),
  };
}

/** A thread fetched with the `full` format, newest message first. */
export function threadView(thread: GmailThread): ThreadView {
  const messages = (thread.messages ?? []).map(messageView).toReversed();
  return { threadId: thread.id, subject: messages.find(message => message.subject)?.subject || '(no subject)', messages };
}
