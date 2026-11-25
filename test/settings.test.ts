import assert from 'node:assert/strict';
import test from 'node:test';
import { deckActionIds, defaultQuery, defaultSettings, restoreSettings } from '../src/core/settings.ts';

test('missing or broken settings fall back to the defaults', () => {
  assert.deepEqual(restoreSettings(null), defaultSettings);
  assert.deepEqual(restoreSettings('nonsense'), defaultSettings);
  assert.deepEqual(
    restoreSettings({
      swipes: { unread: { gestures: { left: 'explode', up: 'skip' } }, read: 'nonsense' },
      archiveMarksRead: 'yes',
      loadImages: false,
      query: '   ',
    }),
    {
      ...defaultSettings,
      swipes: {
        unread: { gestures: { ...defaultSettings.swipes.unread.gestures, up: 'skip' }, labels: {} },
        read: defaultSettings.swipes.read,
      },
      loadImages: false,
      query: defaultQuery,
    },
  );
});

test('the decks swipe differently by default: down marks unread mail read and skips read mail', () => {
  assert.deepEqual(defaultSettings.swipes.unread.gestures, { right: 'archive', left: 'delete', up: 'read', down: 'markRead' });
  assert.deepEqual(defaultSettings.swipes.read.gestures, { right: 'archive', left: 'delete', up: 'read', down: 'skip' });
  assert.equal(defaultSettings.archiveMarksRead, true);
  assert.equal(defaultSettings.query, 'in:inbox is:unread');
});

test('each deck keeps its own swipes', () => {
  const restored = restoreSettings({
    swipes: { unread: { gestures: { down: 'skip' } }, read: { gestures: { down: 'archive' } } },
  });
  assert.equal(restored.swipes.unread.gestures.down, 'skip');
  assert.equal(restored.swipes.read.gestures.down, 'archive');
});

test('settings saved before each deck had its own swipes keep all but their swipes', () => {
  const restored = restoreSettings({
    gestures: { right: 'delete', left: 'archive', up: 'read', down: 'skip' },
    labels: {},
    archiveMarksRead: false,
    loadImages: false,
    query: 'in:inbox is:unread category:promotions',
  });
  assert.deepEqual(restored, {
    ...defaultSettings,
    archiveMarksRead: false,
    loadImages: false,
    query: 'in:inbox is:unread category:promotions',
  });
});

test('unsubscribe cannot be a swipe, and the Read deck has nothing to mark read', () => {
  assert.ok(!deckActionIds('unread').includes('unsubscribe'), 'not every conversation offers it');
  assert.ok(deckActionIds('unread').includes('markRead'));
  assert.ok(!deckActionIds('read').includes('markRead'));
  const restored = restoreSettings({
    swipes: { unread: { gestures: { left: 'unsubscribe' } }, read: { gestures: { up: 'markRead' } } },
  });
  assert.equal(restored.swipes.unread.gestures.left, 'delete');
  assert.equal(restored.swipes.read.gestures.up, 'read');
});

test('a label swipe keeps its label; without one it falls back, and other swipes keep none', () => {
  const later = { id: 'Label_1', name: 'Later' };
  const restored = restoreSettings({
    swipes: {
      read: { gestures: { down: 'label', left: 'label', up: 'archive' }, labels: { down: later, left: { id: '' }, up: later } },
      unread: { gestures: { down: 'label' } },
    },
  });
  assert.deepEqual(restored.swipes.read.gestures, { right: 'archive', left: 'delete', up: 'archive', down: 'label' });
  assert.deepEqual(restored.swipes.read.labels, { down: later });
  assert.equal(restored.swipes.unread.gestures.down, 'markRead');
  assert.deepEqual(restored.swipes.unread.labels, {});
});
