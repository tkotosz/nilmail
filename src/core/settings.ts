import { directions, gestureActionIds, type ActionId, type Direction, type GmailLabel, type Settings } from './types.ts';

export const defaultQuery = 'in:inbox is:unread';

/** The search of the Read deck: conversations in the inbox that have been read. */
export const readQuery = 'in:inbox is:read';

export const defaultSettings: Settings = {
  gestures: { right: 'archive', left: 'delete', up: 'read', down: 'skip' },
  labels: {},
  archiveMarksRead: true,
  loadImages: true,
  query: defaultQuery,
};

const isLabel = (value: unknown): value is GmailLabel =>
  typeof value === 'object' &&
  value !== null &&
  typeof (value as GmailLabel).id === 'string' &&
  (value as GmailLabel).id !== '' &&
  typeof (value as GmailLabel).name === 'string';

const isGestureAction = (value: unknown): value is ActionId => gestureActionIds.includes(value as ActionId);

/** Turns saved settings, possibly from an older version or edited by hand, into valid settings. */
export function restoreSettings(saved: unknown): Settings {
  const input = (typeof saved === 'object' && saved !== null ? saved : {}) as Partial<Record<keyof Settings, unknown>>;
  const savedGestures = (typeof input.gestures === 'object' && input.gestures !== null ? input.gestures : {}) as Record<
    string,
    unknown
  >;
  const savedLabels = (typeof input.labels === 'object' && input.labels !== null ? input.labels : {}) as Record<string, unknown>;
  const labels: Partial<Record<Direction, GmailLabel>> = {};
  for (const direction of directions) {
    const label = savedLabels[direction];
    if (isLabel(label)) labels[direction] = { id: label.id, name: label.name };
  }
  const gestures = Object.fromEntries(
    directions.map(direction => {
      const value = savedGestures[direction];
      // A label swipe without its label falls back to the default.
      const valid = isGestureAction(value) && (value !== 'label' || labels[direction]);
      return [direction, valid ? value : defaultSettings.gestures[direction]];
    }),
  ) as Record<Direction, ActionId>;
  // Only label swipes keep a label, so a swipe changed to something else forgets it.
  for (const direction of directions) if (gestures[direction] !== 'label') delete labels[direction];
  const query = typeof input.query === 'string' ? input.query.trim() : '';
  return {
    gestures,
    labels,
    archiveMarksRead: typeof input.archiveMarksRead === 'boolean' ? input.archiveMarksRead : defaultSettings.archiveMarksRead,
    loadImages: typeof input.loadImages === 'boolean' ? input.loadImages : defaultSettings.loadImages,
    query: query || defaultQuery,
  };
}

/** The swipe actions no gesture reaches; the card offers them as buttons. */
export function actionsWithoutGesture(settings: Settings): ActionId[] {
  const mapped = new Set(Object.values(settings.gestures));
  // Label needs a label, which only a swipe has.
  return gestureActionIds.filter(action => action !== 'label' && !mapped.has(action));
}
