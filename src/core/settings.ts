import { actionIds, directions, type ActionId, type Direction, type Settings } from './types.ts';

export const defaultQuery = 'in:inbox is:unread';

export const defaultSettings: Settings = {
  gestures: { right: 'archive', left: 'delete', up: 'read', down: 'skip' },
  archiveMarksRead: true,
  loadImages: true,
  query: defaultQuery,
};

const isAction = (value: unknown): value is ActionId => actionIds.includes(value as ActionId);

/** Turns saved settings, possibly from an older version or edited by hand, into valid settings. */
export function restoreSettings(saved: unknown): Settings {
  const input = (typeof saved === 'object' && saved !== null ? saved : {}) as Partial<Record<keyof Settings, unknown>>;
  const savedGestures = (typeof input.gestures === 'object' && input.gestures !== null ? input.gestures : {}) as Record<
    string,
    unknown
  >;
  const gestures = Object.fromEntries(
    directions.map(direction => {
      const value = savedGestures[direction];
      return [direction, isAction(value) ? value : defaultSettings.gestures[direction]];
    }),
  ) as Record<Direction, ActionId>;
  const query = typeof input.query === 'string' ? input.query.trim() : '';
  return {
    gestures,
    archiveMarksRead: typeof input.archiveMarksRead === 'boolean' ? input.archiveMarksRead : defaultSettings.archiveMarksRead,
    loadImages: typeof input.loadImages === 'boolean' ? input.loadImages : defaultSettings.loadImages,
    query: query || defaultQuery,
  };
}

/** The actions no gesture reaches; the card offers them as buttons. */
export function actionsWithoutGesture(settings: Settings): ActionId[] {
  const mapped = new Set(Object.values(settings.gestures));
  return actionIds.filter(action => !mapped.has(action));
}
