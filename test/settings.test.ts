import assert from 'node:assert/strict';
import test from 'node:test';
import { actionsWithoutGesture, defaultQuery, defaultSettings, restoreSettings } from '../src/core/settings.ts';

test('missing or broken settings fall back to the defaults', () => {
  assert.deepEqual(restoreSettings(null), defaultSettings);
  assert.deepEqual(restoreSettings('nonsense'), defaultSettings);
  assert.deepEqual(
    restoreSettings({ gestures: { left: 'explode', up: 'markRead' }, archiveMarksRead: 'yes', loadImages: false, query: '   ' }),
    { ...defaultSettings, gestures: { ...defaultSettings.gestures, up: 'markRead' }, loadImages: false, query: defaultQuery },
  );
});

test('unsubscribe cannot be a swipe: not every conversation offers it', () => {
  assert.deepEqual(restoreSettings({ gestures: { left: 'unsubscribe' } }).gestures.left, defaultSettings.gestures.left);
  assert.ok(!actionsWithoutGesture(defaultSettings).includes('unsubscribe'));
});

test('the default swipes are archive, delete, read and skip', () => {
  assert.deepEqual(defaultSettings.gestures, { right: 'archive', left: 'delete', up: 'read', down: 'skip' });
  assert.equal(defaultSettings.archiveMarksRead, true);
  assert.equal(defaultSettings.query, 'in:inbox is:unread');
});

test('actions without a swipe become card buttons', () => {
  assert.deepEqual(actionsWithoutGesture(defaultSettings), ['markRead', 'reply']);
  const allArchive = {
    ...defaultSettings,
    gestures: { left: 'archive', right: 'archive', up: 'archive', down: 'archive' },
  } as const;
  assert.deepEqual(actionsWithoutGesture(allArchive), ['delete', 'markRead', 'read', 'reply', 'skip']);
});
