import { categoryNames, defaultSwipes, emptyFilters, swipe, unreadPile } from './pile.ts';
import {
  directions,
  gestureActionIds,
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
  archiveMarksRead: true,
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

/**
 * One saved swipe, or `fallback` when it cannot work: Add labels needs at least one label, and Remove label exactly one
 * (it keeps the first). Unsubscribe is never a swipe: only some conversations offer it, so it is a button on them.
 */
function restoreSwipe(saved: unknown, fallback: Swipe): Swipe {
  const input = asRecord(saved);
  const action = input.action as ActionId;
  if (!gestureActionIds.includes(action)) return fallback;
  const labels = restoreLabels(input.labels);
  const archive = typeof input.archive === 'boolean' ? input.archive : true;
  if (action === 'addLabels') return labels.length ? swipe(action, labels, archive) : fallback;
  if (action === 'removeLabel') return labels.length ? swipe(action, labels.slice(0, 1)) : fallback;
  return swipe(action);
}

function restoreSwipes(saved: unknown, fallback: Record<Direction, Swipe>): Record<Direction, Swipe> {
  const input = asRecord(saved);
  return Object.fromEntries(
    directions.map(direction => [direction, restoreSwipe(input[direction], fallback[direction])]),
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
function restorePile(saved: unknown): Pile | null {
  const input = asRecord(saved);
  const id = typeof input.id === 'string' ? input.id : '';
  const name = typeof input.name === 'string' ? input.name.trim() : '';
  if (!id || !name) return null;
  return { id, name, filters: restoreFilters(input.filters), swipes: restoreSwipes(input.swipes, defaultSwipes) };
}

/**
 * The swipes of one deck from before piles (`{ gestures, labels }`): a Label swipe becomes Add labels with its one label,
 * archiving as it did.
 */
function oldSwipes(saved: unknown, fallback: Record<Direction, Swipe>): Record<Direction, Swipe> {
  const input = asRecord(saved);
  const gestures = asRecord(input.gestures);
  const labels = asRecord(input.labels);
  return Object.fromEntries(
    directions.map(direction => {
      const action = gestures[direction];
      const label = labels[direction];
      const saved = action === 'label' ? { action: 'addLabels', labels: [label], archive: true } : { action };
      return [direction, restoreSwipe(saved, fallback[direction])];
    }),
  ) as Record<Direction, Swipe>;
}

/**
 * Settings from before piles: the Unread deck becomes the one pile, with its swipes and search. The Read deck is left
 * out, as it is not a default pile; the user can add it.
 */
function fromDecks(input: Record<string, unknown>): Pile[] {
  const swipes = asRecord(input.swipes);
  const query = typeof input.query === 'string' ? input.query.trim() : '';
  const unread: Pile =
    query && query !== oldDefaultQuery ? { ...unreadPile, filters: { ...emptyFilters, search: query } } : unreadPile;
  return [{ ...unread, swipes: oldSwipes(swipes.unread, unreadPile.swipes) }];
}

/**
 * Turns saved settings, possibly from an older version or edited by hand, into valid settings. Settings from before piles
 * become the Unread pile. Without a valid pile, the default pile comes back.
 */
export function restoreSettings(saved: unknown): Settings {
  const input = asRecord(saved);
  const restored = Array.isArray(input.piles) ? input.piles.map(restorePile).filter(pile => pile !== null) : fromDecks(input);
  const piles = restored.filter((pile, index) => restored.findIndex(other => other.id === pile.id) === index);
  return {
    piles: piles.length ? piles : defaultSettings.piles,
    archiveMarksRead: typeof input.archiveMarksRead === 'boolean' ? input.archiveMarksRead : defaultSettings.archiveMarksRead,
    loadImages: typeof input.loadImages === 'boolean' ? input.loadImages : defaultSettings.loadImages,
  };
}

/**
 * The settings with each label's current name from Gmail. A label Gmail no longer has leaves the filters, and a swipe
 * that needed it goes back to Skip.
 */
export function withCurrentLabels(settings: Settings, known: GmailLabel[]): Settings {
  const current = (labels: GmailLabel[]) =>
    labels.flatMap(label => {
      const found = known.find(item => item.id === label.id);
      return found ? [{ id: found.id, name: found.name }] : [];
    });
  const piles = settings.piles.map(pile => ({
    ...pile,
    filters: { ...pile.filters, hasLabels: current(pile.filters.hasLabels), lacksLabels: current(pile.filters.lacksLabels) },
    swipes: restoreSwipes(
      Object.fromEntries(
        directions.map(direction => [direction, { ...pile.swipes[direction], labels: current(pile.swipes[direction].labels) }]),
      ),
      Object.fromEntries(directions.map(direction => [direction, swipe('skip')])) as Record<Direction, Swipe>,
    ),
  }));
  return { ...settings, piles };
}
