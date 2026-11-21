import assert from 'node:assert/strict';
import test from 'node:test';
import type { GmailThread } from '../src/core/gmail.ts';
import { cardFromThread, decodeBody, decodeEntities, parsePerson, threadView } from '../src/core/message.ts';

const base64Url = (bytes: Uint8Array | string) =>
  Buffer.from(typeof bytes === 'string' ? Buffer.from(bytes, 'utf8') : bytes).toString('base64url');

test('senders are read from the usual From header shapes', () => {
  assert.deepEqual(parsePerson('Jane Doe <jane@example.com>'), { name: 'Jane Doe', address: 'jane@example.com' });
  assert.deepEqual(parsePerson('"Doe, Jane" <jane@example.com>'), { name: 'Doe, Jane', address: 'jane@example.com' });
  assert.deepEqual(parsePerson('<noreply@example.com>'), { name: 'noreply@example.com', address: 'noreply@example.com' });
  assert.deepEqual(parsePerson('plain@example.com'), { name: 'plain@example.com', address: 'plain@example.com' });
});

test('snippets lose their HTML escapes', () => {
  assert.equal(
    decodeEntities('Tom &amp; Jerry&#39;s &quot;show&quot; &#x1F600; &unknown;'),
    'Tom & Jerry\'s "show" 😀 &unknown;',
  );
});

test('a metadata thread becomes a card for its latest message', () => {
  const thread: GmailThread = {
    id: 'abc',
    messages: [
      {
        id: 'm1',
        threadId: 'abc',
        labelIds: ['INBOX'],
        internalDate: '1000',
        snippet: 'first',
        payload: { mimeType: 'multipart/mixed', headers: [{ name: 'Subject', value: 'Old' }] },
      },
      {
        id: 'm2',
        threadId: 'abc',
        labelIds: ['INBOX', 'UNREAD'],
        internalDate: '2000',
        snippet: 'Fish &amp; chips',
        payload: {
          mimeType: 'multipart/alternative',
          headers: [
            { name: 'from', value: 'Bob <bob@example.com>' },
            { name: 'Subject', value: 'Re: Lunch' },
          ],
        },
      },
    ],
  };
  assert.deepEqual(cardFromThread(thread), {
    threadId: 'abc',
    from: { name: 'Bob', address: 'bob@example.com' },
    subject: 'Re: Lunch',
    date: 2000,
    snippet: 'Fish & chips',
    messageCount: 2,
    hasAttachment: true,
    labelIds: ['INBOX', 'UNREAD'],
  });
  assert.equal(cardFromThread({ id: 'x', messages: [{ id: 'm', threadId: 'x' }] }).subject, '(no subject)');
});

test('bodies are decoded as UTF-8 when they are, and with the declared character set otherwise', () => {
  assert.equal(decodeBody(base64Url('Árvíztűrő tükörfúrógép'), 'text/plain; charset=iso-8859-2'), 'Árvíztűrő tükörfúrógép');
  const latin2 = new Uint8Array([0xc1, 0x72, 0x76, 0xed, 0x7a, 0x74, 0xfb, 0x72, 0xf5]); // "Árvíztűrő" in ISO-8859-2
  assert.equal(decodeBody(base64Url(latin2), 'text/plain; charset="ISO-8859-2"'), 'Árvíztűrő');
  assert.equal(decodeBody(base64Url(new Uint8Array([0xe9])), 'text/plain; charset=made-up'), 'é');
});

test('the read view prefers the HTML body, lists attachments and puts the newest message first', () => {
  const thread: GmailThread = {
    id: 't',
    messages: [
      {
        id: 'old',
        threadId: 't',
        internalDate: '1',
        payload: {
          mimeType: 'text/plain',
          headers: [{ name: 'Subject', value: 'Question' }],
          body: { data: base64Url('Plain only') },
        },
      },
      {
        id: 'new',
        threadId: 't',
        internalDate: '2',
        payload: {
          mimeType: 'multipart/mixed',
          headers: [
            { name: 'From', value: 'Ann <ann@example.com>' },
            { name: 'To', value: 'me@example.com' },
          ],
          parts: [
            {
              mimeType: 'multipart/alternative',
              parts: [
                { mimeType: 'text/plain', body: { data: base64Url('Hi') } },
                { mimeType: 'text/html', body: { data: base64Url('<p>Hi</p>') } },
              ],
            },
            { mimeType: 'application/pdf', filename: 'bill.pdf', body: { size: 2048, attachmentId: 'a1' } },
          ],
        },
      },
    ],
  };
  const view = threadView(thread);
  assert.equal(view.subject, 'Question');
  assert.deepEqual(
    view.messages.map(message => message.id),
    ['new', 'old'],
  );
  assert.equal(view.messages[0].html, '<p>Hi</p>');
  assert.equal(view.messages[0].text, null);
  assert.deepEqual(view.messages[0].attachments, [{ filename: 'bill.pdf', size: 2048 }]);
  assert.equal(view.messages[0].to, 'me@example.com');
  assert.equal(view.messages[1].text, 'Plain only');
});
