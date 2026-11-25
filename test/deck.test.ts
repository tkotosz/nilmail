import assert from 'node:assert/strict';
import test from 'node:test';
import {
  emptyDeck,
  findFromSender,
  historyLimit,
  loadCards,
  needsCards,
  reduceDeck,
  senderQuery,
  type DeckEvent,
  type DeckState,
} from '../src/core/deck.ts';
import { applyChanges, type Gmail, type GmailThread } from '../src/core/gmail.ts';
import type { ActionId, MailCard } from '../src/core/types.ts';

const card = (threadId: string, labelIds = ['INBOX', 'UNREAD']): MailCard => ({
  threadId,
  from: { name: 'Ann', address: 'ann@example.com' },
  subject: threadId,
  date: 0,
  snippet: '',
  messageCount: 1,
  hasAttachment: false,
  labelIds,
  unsubscribe: null,
});

const decided = (id: number, cards: MailCard[], action: ActionId = 'archive'): DeckEvent => ({
  type: 'decided',
  decision: { id, action, changes: cards.map(card => ({ card, undo: [] })) },
});

const ids = (state: DeckState) => state.cards.map(item => item.threadId);

const loaded = (state: DeckState, ids: string[], more = true) =>
  reduceDeck(reduceDeck(state, { type: 'loading' }), { type: 'loaded', cards: ids.map(id => card(id)), more });

test('a batch adds only threads the deck has not seen since the last reload', () => {
  let state = loaded(emptyDeck, ['a', 'b']);
  state = reduceDeck(state, decided(1, [card('a')], 'skip'));
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

test('a reload keeps the decisions undoable, and an undone thread does not come back a second time', () => {
  let state = loaded(emptyDeck, ['a', 'b']);
  state = reduceDeck(state, decided(1, [card('a')], 'archive'));
  state = reduceDeck(state, { type: 'reset' });
  assert.deepEqual(state.cards, []);
  assert.equal(state.history.length, 1);
  state = loaded(state, ['b']);
  state = reduceDeck(state, { type: 'undone', id: 1 });
  state = loaded(state, ['a', 'b']);
  assert.deepEqual(
    state.cards.map(item => item.threadId),
    ['a', 'b'],
  );
});

test('a decision leaves the deck, and undo or a failure in Gmail puts it back on top', () => {
  let state = loaded(emptyDeck, ['a', 'b', 'c']);
  state = reduceDeck(state, decided(1, [card('b')], 'archive'));
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
  assert.deepEqual(reduceDeck(state, { type: 'decisionFailed', id: 1, threadIds: ['b'] }).cards, undone.cards);
  assert.equal(reduceDeck(undone, { type: 'undone', id: 1 }), undone, 'an unknown decision changes nothing');

  const failedUndo = reduceDeck(undone, { type: 'undoFailed', decision: state.history[0] });
  assert.deepEqual(
    failedUndo.cards.map(item => item.threadId),
    ['a', 'c'],
  );
  assert.deepEqual(failedUndo.history, state.history);
});

test('a decision over all from a sender takes every card out, keeps unseen threads out of later batches, and undoes at once', () => {
  let state = loaded(emptyDeck, ['a', 'b', 'c', 'd']);
  state = reduceDeck(state, decided(1, [card('b'), card('d'), card('x')]));
  assert.deepEqual(ids(state), ['a', 'c']);
  assert.deepEqual(ids(loaded(state, ['x', 'y'])), ['a', 'c', 'y'], 'x had not reached the deck yet, and stays out');

  const undone = reduceDeck(state, { type: 'undone', id: 1 });
  assert.deepEqual(ids(undone), ['b', 'd', 'x', 'a', 'c'], 'the card acted on comes back on top, then the others');
  assert.deepEqual(undone.history, []);
});

test('when Gmail refuses some threads of a decision, only those come back, and undo covers the rest', () => {
  let state = loaded(emptyDeck, ['a', 'b', 'c']);
  state = reduceDeck(state, decided(1, [card('a'), card('b'), card('x')]));
  state = reduceDeck(state, { type: 'decisionFailed', id: 1, threadIds: ['b'] });
  assert.deepEqual(ids(state), ['b', 'c']);
  assert.deepEqual(
    state.history[0]!.changes.map(change => change.card.threadId),
    ['a', 'x'],
  );
  assert.deepEqual(reduceDeck(state, { type: 'decisionFailed', id: 1, threadIds: ['a', 'x'] }).history, []);

  const decision = state.history[0]!;
  state = reduceDeck(state, { type: 'undone', id: 1 });
  assert.deepEqual(ids(state), ['a', 'x', 'b', 'c']);
  state = reduceDeck(state, { type: 'undoFailed', decision: { ...decision, changes: decision.changes.slice(1) } });
  assert.deepEqual(ids(state), ['a', 'b', 'c'], 'the thread that could not be undone leaves again');
  assert.deepEqual(
    state.history[0]!.changes.map(change => change.card.threadId),
    ['x'],
  );
});

test('history keeps the latest decisions only', () => {
  let state = loaded(
    emptyDeck,
    Array.from({ length: 30 }, (_, index) => `t${index}`),
  );
  for (let index = 0; index < 25; index++) {
    state = reduceDeck(state, decided(index, [card(`t${index}`)], 'skip'));
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

test('a huge inbox loads one batch at a time and never lists more than ten pages for it', async () => {
  const ids = Array.from({ length: 5000 }, (_, index) => `t${index}`);
  const gmail = fakeGmail(Array.from({ length: 100 }, (_, page) => ids.slice(page * 50, page * 50 + 50)));
  let lists = 0;
  const list = gmail.listThreads;
  gmail.listThreads = (query, pageToken) => (lists++, list(query, pageToken));

  const first = await loadCards(gmail, 'in:inbox is:read', new Set());
  assert.equal(first.cards.length, 15);
  assert.equal(first.more, true);
  assert.equal(gmail.requested.length, 15, 'only one batch of threads is fetched');
  assert.equal(lists, 1);

  // Skipped read threads still match the search, so a later batch has to page past them, but only so far.
  lists = 0;
  gmail.requested.length = 0;
  const deep = await loadCards(gmail, 'in:inbox is:read', new Set(ids.slice(0, 2000)));
  assert.equal(lists, 10);
  assert.deepEqual(deep, { cards: [], more: false });
  assert.equal(gmail.requested.length, 0);
});

test('the sender search narrows the deck search to one address', () => {
  assert.equal(senderQuery('in:inbox is:unread', 'ann@example.com'), '(in:inbox is:unread) from:"ann@example.com"');
  assert.equal(senderQuery('label:a OR label:b', 'odd"@example.com'), '(label:a OR label:b) from:"odd@example.com"');
});

test('finding all from a sender leaves out the card itself', async () => {
  const gmail = fakeGmail([['a', 'b', 'c']]);
  const queries: string[] = [];
  const list = gmail.listThreads;
  gmail.listThreads = (query, pageToken) => (queries.push(query), list(query, pageToken));
  const result = await findFromSender(gmail, 'in:inbox', card('b'));
  assert.deepEqual(
    result.others.map(item => item.threadId),
    ['a', 'c'],
  );
  assert.equal(result.more, false);
  assert.deepEqual(queries, ['(in:inbox) from:"ann@example.com"']);
});

test('applying changes to many threads goes on past a refusal and reports which threads failed', async () => {
  const done: string[] = [];
  const gmail = fakeGmail([]);
  gmail.modifyThread = async id => {
    if (id === 'b') throw new Error('refused');
    done.push(id);
  };
  const steps = [{ op: 'modify' as const, add: [], remove: ['INBOX'] }];
  const result = await applyChanges(
    gmail,
    ['a', 'b', 'c', 'd'].map(threadId => ({ threadId, steps })).concat({ threadId: 'skip', steps: [] }),
    2,
  );
  assert.deepEqual(result.failed, ['b']);
  assert.equal((result.error as Error).message, 'refused');
  assert.deepEqual(done.toSorted(), ['a', 'c', 'd']);
  assert.deepEqual(await applyChanges(gmail, [{ threadId: 'a', steps }]), { failed: [] });
});
