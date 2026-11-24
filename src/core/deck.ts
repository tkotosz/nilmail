import { cardFromThread } from './message.ts';
import type { Gmail } from './gmail.ts';
import type { ActionId, GmailStep, MailCard } from './types.ts';

/** One conversation a decision changed. */
export interface ThreadChange {
  /** The card as it was before the action. */
  card: MailCard;
  /** The steps that put Gmail back. */
  undo: GmailStep[];
}

/** A decision the user can still undo. */
export interface Decision {
  id: number;
  action: ActionId;
  /** The card the user acted on first; then, when the decision covered all from its sender, the others. */
  changes: ThreadChange[];
}

export interface DeckState {
  /** Cards waiting for a decision; the first one is on top. */
  cards: MailCard[];
  /** Every thread that entered the deck since the last reload, so a later batch does not bring it back. */
  seen: ReadonlySet<string>;
  /** Newest last, at most `historyLimit`. */
  history: Decision[];
  loading: boolean;
  /** False once Gmail has nothing more for the search. */
  more: boolean;
}

export const historyLimit = 20;

export const emptyDeck: DeckState = { cards: [], seen: new Set(), history: [], loading: false, more: true };

export type DeckEvent =
  | { type: 'loading' }
  | { type: 'loaded'; cards: MailCard[]; more: boolean }
  | { type: 'loadFailed' }
  /** The decision's `id` is unique; the app hands it out. */
  | { type: 'decided'; decision: Decision }
  /** Gmail refused the decision for these threads: their cards go back on top, and the decision keeps the others. */
  | { type: 'decisionFailed'; id: number; threadIds: string[] }
  | { type: 'undone'; id: number }
  /** Gmail refused to undo the decision's threads: their cards leave again and can be undone once more. */
  | { type: 'undoFailed'; decision: Decision }
  /** The card changed in place, for example after the read view marked it read. */
  | { type: 'cardChanged'; card: MailCard }
  /** Starts the deck again from the newest thread, skipped ones included. */
  | { type: 'reset' };

const union = (seen: ReadonlySet<string>, ids: Iterable<string>) => new Set([...seen, ...ids]);
const threadIds = (decision: Decision) => new Set(decision.changes.map(change => change.card.threadId));
const withoutThreads = (cards: MailCard[], ids: ReadonlySet<string>) => cards.filter(card => !ids.has(card.threadId));

/** Puts the cards of the changes back on top, in order. */
function putBack(state: DeckState, changes: ThreadChange[]): Pick<DeckState, 'cards' | 'seen'> {
  const back = changes.map(change => change.card);
  const ids = new Set(back.map(card => card.threadId));
  // A reload since the decision forgot the threads, so a later batch would bring them in a second time.
  return { cards: [...back, ...withoutThreads(state.cards, ids)], seen: union(state.seen, ids) };
}

export function reduceDeck(state: DeckState, event: DeckEvent): DeckState {
  switch (event.type) {
    case 'loading':
      return { ...state, loading: true };
    case 'loaded': {
      const fresh = event.cards.filter(card => !state.seen.has(card.threadId));
      const seen = new Set(state.seen);
      for (const card of fresh) seen.add(card.threadId);
      return { ...state, cards: [...state.cards, ...fresh], seen, loading: false, more: event.more };
    }
    case 'loadFailed':
      return { ...state, loading: false };
    case 'decided': {
      const ids = threadIds(event.decision);
      return {
        ...state,
        cards: withoutThreads(state.cards, ids),
        // Threads from the sender that had not reached the deck yet stay out of later batches too.
        seen: union(state.seen, ids),
        history: [...state.history, event.decision].slice(-historyLimit),
      };
    }
    case 'decisionFailed': {
      const decision = state.history.find(item => item.id === event.id);
      if (!decision) return state;
      const failed = decision.changes.filter(change => event.threadIds.includes(change.card.threadId));
      const kept = decision.changes.filter(change => !event.threadIds.includes(change.card.threadId));
      return {
        ...state,
        ...putBack(state, failed),
        history: kept.length
          ? state.history.map(item => (item.id === event.id ? { ...item, changes: kept } : item))
          : state.history.filter(item => item.id !== event.id),
      };
    }
    case 'undone': {
      const decision = state.history.find(item => item.id === event.id);
      if (!decision) return state;
      return { ...state, ...putBack(state, decision.changes), history: state.history.filter(item => item.id !== event.id) };
    }
    case 'undoFailed':
      return {
        ...state,
        cards: withoutThreads(state.cards, threadIds(event.decision)),
        history: [...state.history, event.decision].slice(-historyLimit),
      };
    case 'cardChanged':
      return { ...state, cards: state.cards.map(card => (card.threadId === event.card.threadId ? event.card : card)) };
    case 'reset':
      // The decisions stay undoable: their changes in Gmail still stand.
      return { ...emptyDeck, history: state.history };
  }
}

/** The Gmail search for the conversations of the deck's search that come from one sender. */
export const senderQuery = (query: string, address: string) => `(${query}) from:"${address.replaceAll('"', '')}"`;

/** How many conversations from one sender a decision can cover. */
export const senderLimit = 100;

/**
 * The other conversations of the deck's search from the card's sender, newest first, at most `senderLimit` with the
 * card. `more` says the sender has more than that.
 */
export async function findFromSender(
  gmail: Gmail,
  query: string,
  card: MailCard,
): Promise<{ others: MailCard[]; more: boolean }> {
  const { cards, more } = await loadCards(gmail, senderQuery(query, card.from.address), new Set([card.threadId]), {
    limit: senderLimit - 1,
    maxPages: 3,
  });
  return { others: cards, more };
}

/** How many cards are left before the next batch loads. */
export const refillAt = 5;

/** Whether the deck should load its next batch now. */
export const needsCards = (state: DeckState) => state.more && !state.loading && state.cards.length <= refillAt;

/**
 * Loads up to `limit` cards for threads that match the search and are not in `exclude`. It always starts from the first
 * page, because the decisions since the last batch change which threads match, which would make an old page token skip
 * threads. Threads are fetched a few at a time, as Gmail refuses too many requests at once from one user.
 */
export async function loadCards(
  gmail: Gmail,
  query: string,
  exclude: ReadonlySet<string>,
  { limit = 15, parallel = 5, maxPages = 10 } = {},
): Promise<{ cards: MailCard[]; more: boolean }> {
  const ids: string[] = [];
  let pageToken: string | undefined;
  let pages = 0;
  do {
    const page = await gmail.listThreads(query, pageToken);
    for (const id of page.ids) if (!exclude.has(id) && !ids.includes(id)) ids.push(id);
    pageToken = page.nextPageToken;
    pages++;
  } while (ids.length < limit && pageToken && pages < maxPages);

  const wanted = ids.slice(0, limit);
  const cards: MailCard[] = [];
  for (let start = 0; start < wanted.length; start += parallel) {
    const threads = await Promise.all(wanted.slice(start, start + parallel).map(id => gmail.getThread(id, 'metadata')));
    cards.push(...threads.map(cardFromThread));
  }
  // A round that finds nothing new ends the deck, even when more pages exist: they would hold only threads already seen.
  return { cards, more: cards.length > 0 && (ids.length > limit || Boolean(pageToken)) };
}
