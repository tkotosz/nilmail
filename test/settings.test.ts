import assert from 'node:assert/strict';
import test from 'node:test';
import { defaultSwipes, newPile, readPile, swipe, unreadPile } from '../src/core/pile.ts';
import { defaultSettings, restoreSettings, withCurrentLabels } from '../src/core/settings.ts';

const later = { id: 'Label_1', name: 'Later' };
const bills = { id: 'Label_2', name: 'Bills' };

test('missing or broken settings fall back to the Unread and Read piles', () => {
  assert.deepEqual(restoreSettings(null), defaultSettings);
  assert.deepEqual(restoreSettings('nonsense'), defaultSettings);
  assert.deepEqual(restoreSettings({ piles: [{ name: 'No id' }, { id: 'x', name: '  ' }] }).piles, defaultSettings.piles);
  assert.deepEqual(
    defaultSettings.piles.map(pile => pile.name),
    ['Unread', 'Read'],
  );
  assert.equal(unreadPile.swipes.down.action, 'markRead');
  assert.equal(readPile.swipes.down.action, 'skip');
});

test('a saved pile keeps its filters and swipes; anything invalid falls back', () => {
  const restored = restoreSettings({
    piles: [
      {
        id: 'p1',
        name: ' Accounting ',
        filters: {
          read: 'any',
          where: 'nowhere',
          hasLabels: [later, later, { id: '' }],
          lacksLabels: 'x',
          search: ' older_than:30d ',
        },
        swipes: {
          right: { action: 'removeLabel', labels: [later, bills] },
          left: { action: 'addLabels', labels: [later, bills], archive: false },
          up: { action: 'addLabels', labels: [] },
          down: { action: 'unsubscribe' },
        },
      },
      { id: 'p1', name: 'Same id again' },
    ],
    archiveMarksRead: false,
  });
  assert.equal(restored.piles.length, 1, 'ids are unique');
  assert.deepEqual(restored.piles[0], {
    id: 'p1',
    name: 'Accounting',
    filters: { read: 'any', where: 'inbox', hasLabels: [later], lacksLabels: [], search: 'older_than:30d' },
    swipes: {
      right: swipe('removeLabel', [later]),
      left: swipe('addLabels', [later, bills], false),
      up: defaultSwipes.up,
      down: defaultSwipes.down,
    },
  });
  assert.equal(restored.archiveMarksRead, false);
});

test('settings from before piles become the Unread and Read piles, with their swipes and search', () => {
  const restored = restoreSettings({
    swipes: {
      unread: { gestures: { right: 'archive', left: 'label', up: 'read', down: 'markRead' }, labels: { left: later } },
      read: { gestures: { right: 'delete', left: 'archive', up: 'read', down: 'skip' } },
    },
    archiveMarksRead: false,
    loadImages: false,
    query: 'in:inbox is:unread',
  });
  assert.deepEqual(restored.piles[0], {
    ...unreadPile,
    swipes: { ...unreadPile.swipes, left: swipe('addLabels', [later], true) },
  });
  assert.deepEqual(restored.piles[1], {
    ...readPile,
    swipes: { ...readPile.swipes, right: swipe('delete'), left: swipe('archive') },
  });
  assert.equal(restored.loadImages, false);

  const custom = restoreSettings({ query: 'in:inbox is:unread category:promotions' });
  assert.deepEqual(custom.piles[0]!.filters, {
    read: 'any',
    where: 'anywhere',
    hasLabels: [],
    lacksLabels: [],
    search: 'in:inbox is:unread category:promotions',
  });
  assert.deepEqual(custom.piles[0]!.swipes, unreadPile.swipes, 'settings older still start from the default swipes');
});

test('labels take their current names from Gmail, and a deleted one drops out', () => {
  const pile = {
    ...newPile('p1', 'Accounting'),
    filters: { ...newPile('p1', 'x').filters, hasLabels: [later], lacksLabels: [bills] },
    swipes: { ...defaultSwipes, right: swipe('removeLabel', [later]), left: swipe('addLabels', [later, bills]) },
  };
  const renamed = withCurrentLabels({ ...defaultSettings, piles: [pile] }, [{ id: 'Label_1', name: 'Todo accounting' }]);
  const updated = renamed.piles[0]!;
  assert.deepEqual(updated.filters.hasLabels, [{ id: 'Label_1', name: 'Todo accounting' }]);
  assert.deepEqual(updated.filters.lacksLabels, []);
  assert.deepEqual(updated.swipes.right, swipe('removeLabel', [{ id: 'Label_1', name: 'Todo accounting' }]));
  assert.deepEqual(updated.swipes.left, swipe('addLabels', [{ id: 'Label_1', name: 'Todo accounting' }]));

  const gone = withCurrentLabels({ ...defaultSettings, piles: [pile] }, []).piles[0]!;
  assert.deepEqual(gone.swipes.right, swipe('skip'), 'a swipe without its label skips');
  assert.deepEqual(gone.swipes.left, swipe('skip'));
});
