import type { Direction, GmailLabel, GmailSearch, Pile, PileFilters, Swipe } from './types.ts';

/** Gmail's ids for labels the user made start with this; Gmail's own labels, such as INBOX or STARRED, do not. */
export const isUserLabel = (id: string) => id.startsWith('Label_');

/**
 * A label's name as Gmail search writes it: spaces become hyphens, and nested labels keep their slash.
 * https://support.google.com/vault/answer/2474474
 */
export const searchLabelName = (name: string) => name.trim().replace(/\s+/g, '-');

/** The Gmail search for a pile. Labels it must have go by id, so their names cannot break the search. */
export function pileSearch(filters: PileFilters): GmailSearch {
  const terms = [
    filters.read === 'unread' ? 'is:unread' : filters.read === 'read' ? 'is:read' : '',
    filters.where === 'inbox' ? 'in:inbox' : filters.where === 'archived' ? '-in:inbox' : '',
    ...filters.lacksLabels.map(label => `-label:"${searchLabelName(label.name).replaceAll('"', '')}"`),
    filters.search.trim() ? `(${filters.search.trim()})` : '',
  ];
  return { q: terms.filter(Boolean).join(' '), labelIds: filters.hasLabels.map(label => label.id) };
}

/** Narrows a search to one sender. */
export const senderSearch = (search: GmailSearch, address: string): GmailSearch => ({
  q: [search.q, `from:"${address.replaceAll('"', '')}"`].filter(Boolean).join(' '),
  labelIds: search.labelIds,
});

/**
 * How to count a pile exactly from one label's own numbers, when its filters allow: the inbox, or a single label, each
 * unread, read or either. Any other pile has only Gmail's estimate for its search.
 */
export function pileCount(filters: PileFilters): { labelId: string; read: PileFilters['read'] } | null {
  if (filters.search.trim() || filters.lacksLabels.length) return null;
  if (filters.where === 'inbox' && !filters.hasLabels.length) {
    return { labelId: 'INBOX', read: filters.read };
  }
  if (filters.where === 'anywhere' && filters.hasLabels.length === 1) {
    return { labelId: filters.hasLabels[0]!.id, read: filters.read };
  }
  return null;
}

/** A pile's count from its label's numbers: unread ones, read ones (the rest), or all. */
export function countFromLabel(numbers: { total: number; unread: number }, read: PileFilters['read']): number {
  if (read === 'unread') return numbers.unread;
  if (read === 'read') return Math.max(0, numbers.total - numbers.unread);
  return numbers.total;
}

/** A short description of the filters, such as "Inbox · unread · has Invoices". */
export function pileSummary(filters: PileFilters): string {
  const names = (labels: GmailLabel[]) => labels.map(label => label.name).join(', ');
  return [
    { inbox: 'Inbox', archived: 'Archived', anywhere: 'Anywhere' }[filters.where],
    { unread: 'unread', read: 'read', any: 'read or unread' }[filters.read],
    filters.hasLabels.length ? `has ${names(filters.hasLabels)}` : '',
    filters.lacksLabels.length ? `not ${names(filters.lacksLabels)}` : '',
    filters.search.trim() ? `“${filters.search.trim()}”` : '',
  ]
    .filter(Boolean)
    .join(' · ');
}

export const swipe = (action: Swipe['action'], labels: GmailLabel[] = [], archive = true): Swipe => ({ action, labels, archive });

const swipes = (down: Swipe['action']): Record<Direction, Swipe> => ({
  right: swipe('archive'),
  left: swipe('delete'),
  up: swipe('read'),
  down: swipe(down),
});

export const unreadPile: Pile = {
  id: 'unread',
  name: 'Unread',
  filters: { read: 'unread', where: 'inbox', hasLabels: [], lacksLabels: [], search: '' },
  swipes: swipes('markRead'),
};

/** The swipes of a new pile, where down skips. */
export const defaultSwipes = swipes('skip');

/** A pile the user adds: unread inbox mail and the default swipes, until they change it. */
export const newPile = (id: string, name: string): Pile => ({
  id,
  name,
  filters: structuredClone(unreadPile.filters),
  swipes: structuredClone(defaultSwipes),
});
