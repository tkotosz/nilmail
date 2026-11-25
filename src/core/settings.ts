import { coversSender } from './actions.ts';
import { categoryNames, defaultSwipes, emptyFilters, swipeOf, unreadPile } from './pile.ts';
import {
  directions,
  gestureActionIds,
  standaloneActionIds,
  type Action,
  type ActionId,
  type Direction,
  type GmailLabel,
  type Pile,
  type PileFilters,
  type Settings,
  type Swipe,
} from './types.ts';

/** The search that filled the deck before piles; a different one saved then becomes the Unread pile's search. */
const oldDefaultQuery = 'in:inbox is:unread';

export const defaultSettings: Settings = {
  piles: [unreadPile],
  loadImages: true,
};

const asRecord = (value: unknown) => (typeof value === 'object' && value !== null ? value : {}) as Record<string, unknown>;

const isLabel = (value: unknown): value is GmailLabel =>
  typeof value === 'object' &&
  value !== null &&
  typeof (value as GmailLabel).id === 'string' &&
  (value as GmailLabel).id !== '' &&
  typeof (value as GmailLabel).name === 'string';

/** The valid labels of a saved list, each once. */
function restoreLabels(saved: unknown): GmailLabel[] {
  if (!Array.isArray(saved)) return [];
  const labels: GmailLabel[] = [];
  for (const item of saved) {
    if (isLabel(item) && !labels.some(label => label.id === item.id)) labels.push({ id: item.id, name: item.name });
  }
  return labels;
}

/** How long a swipe's name can be; its button has room for about two short lines. */
export const swipeNameLimit = 30;

/** One saved action, or null when it cannot work: Add label and Remove label need their label. */
function restoreAction(saved: unknown): Action | null {
  const input = asRecord(saved);
  const id = input.id as ActionId;
  if (!gestureActionIds.includes(id)) return null;
  if (id !== 'addLabel' && id !== 'removeLabel') return { id };
  return isLabel(input.label) ? { id, label: { id: input.label.id, name: input.label.name } } : null;
}

/**
 * The actions of a swipe saved with one action (`{ action, labels, archive }`). Archive also marks read when the old
 * "Archive also marks as read" setting was on; Add labels becomes an Add label for each label, and Archive when it
 * archived.
 */
function oldActions(input: Record<string, unknown>, archiveMarksRead: boolean): unknown[] {
  const labels = restoreLabels(input.labels);
  switch (input.action) {
    case 'archive':
      return archiveMarksRead ? [{ id: 'markRead' }, { id: 'archive' }] : [{ id: 'archive' }];
    case 'addLabels':
      // Without a label it never worked, so the swipe falls back to its default.
      if (!labels.length) return [];
      return [...labels.map(label => ({ id: 'addLabel', label })), ...(input.archive === false ? [] : [{ id: 'archive' }])];
    case 'removeLabel':
      return labels.slice(0, 1).map(label => ({ id: 'removeLabel', label }));
    default:
      return [{ id: input.action }];
  }
}

/**
 * One saved swipe, or `fallback` when it has no action that can work. Each action counts once, and an action that only
 * works on its own (Read, Skip) replaces the rest. A Reply saved before Reply was removed is dropped. Unsubscribe is never a swipe: only some conversations offer it.
 */
function restoreSwipe(saved: unknown, fallback: Swipe, archiveMarksRead: boolean): Swipe {
  const input = asRecord(saved);
  const raw = Array.isArray(input.actions) ? input.actions : oldActions(input, archiveMarksRead);
  const valid = raw.map(restoreAction).filter(action => action !== null);
  const key = (action: Action) => `${action.id}:${action.label?.id ?? ''}`;
  let actions = valid.filter((action, index) => valid.findIndex(other => key(other) === key(action)) === index);
  const standalone = actions.find(action => standaloneActionIds.includes(action.id));
  if (standalone) actions = [standalone];
  if (!actions.length) return fallback;
  const name = typeof input.name === 'string' ? input.name.trim().slice(0, swipeNameLimit) : '';
  const restored: Swipe = { actions, allFromSender: false, name };
  return { ...restored, allFromSender: input.allFromSender === true && coversSender(restored) };
}

function restoreSwipes(saved: unknown, fallback: Record<Direction, Swipe>, archiveMarksRead: boolean): Record<Direction, Swipe> {
  const input = asRecord(saved);
  return Object.fromEntries(
    directions.map(direction => [direction, restoreSwipe(input[direction], fallback[direction], archiveMarksRead)]),
  ) as Record<Direction, Swipe>;
}

function restoreFilters(saved: unknown): PileFilters {
  const input = asRecord(saved);
  return {
    read: input.read === 'read' || input.read === 'any' ? input.read : 'unread',
    where: input.where === 'archived' || input.where === 'anywhere' ? input.where : 'inbox',
    hasLabels: restoreLabels(input.hasLabels),
    lacksLabels: restoreLabels(input.lacksLabels),
    category:
      typeof input.category === 'string' && input.category in categoryNames ? (input.category as PileFilters['category']) : '',
    olderThan: restoreAge(input.olderThan),
    from: typeof input.from === 'string' ? input.from.trim() : '',
    hasAttachment: input.hasAttachment === true,
    noLabels: input.noLabels === true,
    search: typeof input.search === 'string' ? input.search.trim() : '',
  };
}

/** A saved age: a whole number of days, months or years, at least one. */
function restoreAge(saved: unknown): PileFilters['olderThan'] {
  const input = asRecord(saved);
  const count = input.count;
  const unit = input.unit;
  if (typeof count !== 'number' || !Number.isInteger(count) || count < 1) return null;
  return unit === 'd' || unit === 'm' || unit === 'y' ? { count, unit } : null;
}

/** A saved pile, or null when it has no id or name. Its swipes start from the defaults of a new pile. */
function restorePile(saved: unknown, archiveMarksRead: boolean): Pile | null {
  const input = asRecord(saved);
  const id = typeof input.id === 'string' ? input.id : '';
  const name = typeof input.name === 'string' ? input.name.trim() : '';
  if (!id || !name) return null;
  return {
    id,
    name,
    filters: restoreFilters(input.filters),
    swipes: restoreSwipes(input.swipes, defaultSwipes, archiveMarksRead),
  };
}

/**
 * The swipes of one deck from before piles (`{ gestures, labels }`): a Label swipe becomes Add labels with its one label,
 * archiving as it did.
 */
function oldSwipes(saved: unknown, fallback: Record<Direction, Swipe>, archiveMarksRead: boolean): Record<Direction, Swipe> {
  const input = asRecord(saved);
  const gestures = asRecord(input.gestures);
  const labels = asRecord(input.labels);
  return Object.fromEntries(
    directions.map(direction => {
      const action = gestures[direction];
      const label = labels[direction];
      const saved = action === 'label' ? { action: 'addLabels', labels: [label], archive: true } : { action };
      return [direction, restoreSwipe(saved, fallback[direction], archiveMarksRead)];
    }),
  ) as Record<Direction, Swipe>;
}

/**
 * Settings from before piles: the Unread deck becomes the one pile, with its swipes and search. The Read deck is left
 * out, as it is not a default pile; the user can add it.
 */
function fromDecks(input: Record<string, unknown>, archiveMarksRead: boolean): Pile[] {
  const swipes = asRecord(input.swipes);
  const query = typeof input.query === 'string' ? input.query.trim() : '';
  const unread: Pile =
    query && query !== oldDefaultQuery ? { ...unreadPile, filters: { ...emptyFilters, search: query } } : unreadPile;
  return [{ ...unread, swipes: oldSwipes(swipes.unread, unreadPile.swipes, archiveMarksRead) }];
}

/**
 * Turns saved settings, possibly from an older version or edited by hand, into valid settings. Settings from before piles
 * become the Unread pile. Without a valid pile, the default pile comes back.
 */
export function restoreSettings(saved: unknown): Settings {
  const input = asRecord(saved);
  // The old "Archive also marks as read" setting, on by default, decides how saved Archive swipes carry over.
  const archiveMarksRead = input.archiveMarksRead !== false;
  const restored = Array.isArray(input.piles)
    ? input.piles.map(pile => restorePile(pile, archiveMarksRead)).filter(pile => pile !== null)
    : fromDecks(input, archiveMarksRead);
  const piles = restored.filter((pile, index) => restored.findIndex(other => other.id === pile.id) === index);
  return {
    piles: piles.length ? piles : defaultSettings.piles,
    loadImages: typeof input.loadImages === 'boolean' ? input.loadImages : defaultSettings.loadImages,
  };
}

/**
 * The settings with each label's current name from Gmail. A label Gmail no longer has leaves the filters and the swipes'
 * actions; a swipe left with no action skips.
 */
export function withCurrentLabels(settings: Settings, known: GmailLabel[]): Settings {
  const current = (label: GmailLabel) => {
    const found = known.find(item => item.id === label.id);
    return found ? { id: found.id, name: found.name } : null;
  };
  const currentList = (labels: GmailLabel[]) => labels.map(current).filter(label => label !== null);
  const piles = settings.piles.map(pile => ({
    ...pile,
    filters: {
      ...pile.filters,
      hasLabels: currentList(pile.filters.hasLabels),
      lacksLabels: currentList(pile.filters.lacksLabels),
    },
    swipes: Object.fromEntries(
      directions.map(direction => {
        const { actions, allFromSender, name } = pile.swipes[direction];
        const kept = actions.map(action => (action.label ? { ...action, label: current(action.label) } : action));
        return [direction, restoreSwipe({ actions: kept, allFromSender, name }, swipeOf('skip'), false)];
      }),
    ) as Record<Direction, Swipe>,
  }));
  return { ...settings, piles };
}
