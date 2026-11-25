import {
  deckKinds,
  directions,
  gestureActionIds,
  type ActionId,
  type DeckKind,
  type Direction,
  type GmailLabel,
  type Settings,
  type Swipes,
} from './types.ts';

export const defaultQuery = 'in:inbox is:unread';

/** The search of the Read deck: conversations in the inbox that have been read. */
export const readQuery = 'in:inbox is:read';

export const defaultSettings: Settings = {
  swipes: {
    unread: { gestures: { right: 'archive', left: 'delete', up: 'read', down: 'markRead' }, labels: {} },
    read: { gestures: { right: 'archive', left: 'delete', up: 'read', down: 'skip' }, labels: {} },
  },
  archiveMarksRead: true,
  loadImages: true,
  query: defaultQuery,
};

/** The actions a deck's swipes can do: a read conversation has nothing to mark read. */
export const deckActionIds = (kind: DeckKind): readonly ActionId[] =>
  kind === 'read' ? gestureActionIds.filter(action => action !== 'markRead') : gestureActionIds;

const isLabel = (value: unknown): value is GmailLabel =>
  typeof value === 'object' &&
  value !== null &&
  typeof (value as GmailLabel).id === 'string' &&
  (value as GmailLabel).id !== '' &&
  typeof (value as GmailLabel).name === 'string';

const asRecord = (value: unknown) => (typeof value === 'object' && value !== null ? value : {}) as Record<string, unknown>;

/** One deck's saved swipes, with anything the deck cannot do replaced by its default. */
function restoreSwipes(kind: DeckKind, saved: unknown): Swipes {
  const input = asRecord(saved);
  const savedGestures = asRecord(input.gestures);
  const savedLabels = asRecord(input.labels);
  const defaults = defaultSettings.swipes[kind].gestures;
  const allowed = deckActionIds(kind);
  const labels: Partial<Record<Direction, GmailLabel>> = {};
  for (const direction of directions) {
    const label = savedLabels[direction];
    if (isLabel(label)) labels[direction] = { id: label.id, name: label.name };
  }
  const gestures = Object.fromEntries(
    directions.map(direction => {
      const value = savedGestures[direction] as ActionId;
      // A label swipe without its label falls back to the default.
      const valid = allowed.includes(value) && (value !== 'label' || labels[direction]);
      return [direction, valid ? value : defaults[direction]];
    }),
  ) as Record<Direction, ActionId>;
  // Only label swipes keep a label, so a swipe changed to something else forgets it.
  for (const direction of directions) if (gestures[direction] !== 'label') delete labels[direction];
  return { gestures, labels };
}

/**
 * Turns saved settings, possibly from an older version or edited by hand, into valid settings. Settings saved before
 * each deck had its own swipes keep everything but their swipes, which start from the defaults.
 */
export function restoreSettings(saved: unknown): Settings {
  const input = asRecord(saved);
  const swipes = asRecord(input.swipes);
  const query = typeof input.query === 'string' ? input.query.trim() : '';
  return {
    swipes: Object.fromEntries(deckKinds.map(kind => [kind, restoreSwipes(kind, swipes[kind])])) as Settings['swipes'],
    archiveMarksRead: typeof input.archiveMarksRead === 'boolean' ? input.archiveMarksRead : defaultSettings.archiveMarksRead,
    loadImages: typeof input.loadImages === 'boolean' ? input.loadImages : defaultSettings.loadImages,
    query: query || defaultQuery,
  };
}
