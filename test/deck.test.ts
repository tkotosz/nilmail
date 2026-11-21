import assert from 'node:assert/strict';
import test from 'node:test';
import { emptyDeck, historyLimit, loadCards, needsCards, reduceDeck, type DeckState } from '../src/core/deck.ts';
import type { Gmail, GmailThread } from '../src/core/gmail.ts';
import type { MailCard } from '../src/core/types.ts';

const card = (threadId: string, labelIds = ['INBOX', 'UNREAD']): MailCard => ({
  threadId,
  from: { name: 'Ann', address: 'ann@example.com' },
  subject: threadId,
  date: 0,
  snippet: '',
  messageCount: 1,
  hasAttachment: false,
  labelIds,
});

const loaded = (state: DeckState, ids: string[], more = true) =>
  reduceDeck(reduceDeck(state, { type: 'loading' }), { type: 'loaded', cards: ids.map(id => card(id)), more });

test('a batch adds only threads the deck has not seen since the last reload', () => {
  let state = loaded(emptyDeck, ['a', 'b']);
  state = reduceDeck(state, { type: 'decided', id: 1, card: card('a'), action: 'skip', undo: [] });
  state = loaded(state, ['a', 'b', 'c']);
  assert.deepEqual(
    state.cards.map(item => item.threadId),
    ['b', 'c'],
  );
  assert.equal(state.loading, false);
  state = reduceDeck(state, { type: 'reset' });
  assert.deepEqual(
    loaded(state, ['a']).cards.map(item => item.threadId),
    ['a'],
    'a reload forgets skipped threads',
  );
});

test('a decision leaves the deck, and undo or a failure in Gmail puts it back on top', () => {
  let state = loaded(emptyDeck, ['a', 'b', 'c']);
  state = reduceDeck(state, { type: 'decided', id: 1, card: card('b'), action: 'archive', undo: [] });
  assert.deepEqual(
    state.cards.map(item => item.threadId),
    ['a', 'c'],
  );
  assert.equal(state.history.length, 1);

  const undone = reduceDeck(state, { type: 'undone', id: 1 });
  assert.deepEqual(
    undone.cards.map(item => item.threadId),
    ['b', 'a', 'c'],
  );
  assert.equal(undone.history.length, 0);
  assert.deepEqual(reduceDeck(state, { type: 'decisionFailed', id: 1 }).cards, undone.cards);
  assert.equal(reduceDeck(undone, { type: 'undone', id: 1 }), undone, 'an unknown decision changes nothing');

  const failedUndo = reduceDeck(undone, { type: 'undoFailed', decision: state.history[0] });
  assert.deepEqual(
    failedUndo.cards.map(item => item.threadId),
    ['a', 'c'],
  );
  assert.deepEqual(failedUndo.history, state.history);
});

test('history keeps the latest decisions only', () => {
  let state = loaded(
    emptyDeck,
    Array.from({ length: 30 }, (_, index) => `t${index}`),
  );
  for (let index = 0; index < 25; index++) {
    state = reduceDeck(state, { type: 'decided', id: index, card: card(`t${index}`), action: 'skip', undo: [] });
  }
  assert.equal(state.history.length, historyLimit);
  assert.equal(state.history[0].id, 5);
});

test('the deck asks for more cards when it runs low and Gmail has more', () => {
  assert.equal(needsCards(emptyDeck), true);
  assert.equal(needsCards(loaded(emptyDeck, ['a', 'b', 'c', 'd', 'e', 'f'])), false);
  assert.equal(needsCards(loaded(emptyDeck, ['a'])), true);
  assert.equal(needsCards(loaded(emptyDeck, ['a'], false)), false);
  assert.equal(needsCards(reduceDeck(emptyDeck, { type: 'loading' })), false);
});

function fakeGmail(pages: string[][]): Gmail & { requested: string[] } {
  const requested: string[] = [];
  return {
    requested,
    async listThreads(_query, pageToken) {
      const index = Number(pageToken ?? 0);
      return { ids: pages[index] ?? [], nextPageToken: index + 1 < pages.length ? String(index + 1) : undefined };
    },
    async getThread(id): Promise<GmailThread> {
      requested.push(id);
      return { id, messages: [{ id: `${id}-m`, threadId: id, labelIds: ['INBOX', 'UNREAD'], internalDate: '0' }] };
    },
    async modifyThread() {},
    async trashThread() {},
    async untrashThread() {},
  };
}

test('loading starts from the first page and pages past threads already seen', async () => {
  const gmail = fakeGmail([
    ['a', 'b'],
    ['c', 'd'],
    ['e', 'f'],
  ]);
  const result = await loadCards(gmail, 'in:inbox', new Set(['a', 'b', 'c']), { limit: 2, parallel: 1 });
  assert.deepEqual(
    result.cards.map(item => item.threadId),
    ['d', 'e'],
  );
  assert.equal(result.more, true);
  assert.deepEqual(gmail.requested, ['d', 'e'], 'only the new threads are fetched');

  const last = await loadCards(gmail, 'in:inbox', new Set(['a', 'b', 'c', 'd', 'e']), { limit: 2 });
  assert.deepEqual(
    last.cards.map(item => item.threadId),
    ['f'],
  );
  assert.equal(last.more, false);

  const none = await loadCards(gmail, 'in:inbox', new Set(['a', 'b', 'c', 'd', 'e', 'f']));
  assert.deepEqual(none, { cards: [], more: false });
});
