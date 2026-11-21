import { cardFromThread } from './message.ts';
import type { Gmail } from './gmail.ts';
import type { ActionId, GmailStep, MailCard } from './types.ts';

/** A decision the user can still undo. */
export interface Decision {
  id: number;
  action: ActionId;
  /** The card as it was before the action. */
  card: MailCard;
  /** The steps that put Gmail back. */
  undo: GmailStep[];
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
  /** `id` is unique per decision; the app hands it out. */
  | { type: 'decided'; id: number; card: MailCard; action: ActionId; undo: GmailStep[] }
  /** Gmail refused a decision: the card goes back on top. */
  | { type: 'decisionFailed'; id: number }
  | { type: 'undone'; id: number }
  /** Gmail refused an undo: the card leaves again and the decision can be undone once more. */
  | { type: 'undoFailed'; decision: Decision }
  /** The card changed in place, for example after the read view marked it read. */
  | { type: 'cardChanged'; card: MailCard }
  | { type: 'reset' };

const withoutCard = (cards: MailCard[], threadId: string) => cards.filter(card => card.threadId !== threadId);

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
      const decision: Decision = { id: event.id, action: event.action, card: event.card, undo: event.undo };
      return {
        ...state,
        cards: withoutCard(state.cards, event.card.threadId),
        history: [...state.history, decision].slice(-historyLimit),
      };
    }
    case 'decisionFailed':
    case 'undone': {
      const decision = state.history.find(item => item.id === event.id);
      if (!decision) return state;
      return {
        ...state,
        cards: [decision.card, ...withoutCard(state.cards, decision.card.threadId)],
        history: state.history.filter(item => item.id !== event.id),
      };
    }
    case 'undoFailed':
      return {
        ...state,
        cards: withoutCard(state.cards, event.decision.card.threadId),
        history: [...state.history, event.decision].slice(-historyLimit),
      };
    case 'cardChanged':
      return { ...state, cards: state.cards.map(card => (card.threadId === event.card.threadId ? event.card : card)) };
    case 'reset':
      return emptyDeck;
  }
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
