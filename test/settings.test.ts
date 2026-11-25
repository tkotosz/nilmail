import assert from 'node:assert/strict';
import test from 'node:test';
import { defaultSwipes, emptyFilters, newPile, swipeOf, unreadPile } from '../src/core/pile.ts';
import { defaultSettings, restoreSettings, withCurrentLabels } from '../src/core/settings.ts';

const later = { id: 'Label_1', name: 'Later' };
const bills = { id: 'Label_2', name: 'Bills' };
const addLabel = (label: typeof later) => ({ id: 'addLabel' as const, label });
const removeLabel = (label: typeof later) => ({ id: 'removeLabel' as const, label });

test('missing or broken settings fall back to the Unread pile, the only default', () => {
  assert.deepEqual(restoreSettings(null), defaultSettings);
  assert.deepEqual(restoreSettings('nonsense'), defaultSettings);
  assert.deepEqual(restoreSettings({ piles: [{ name: 'No id' }, { id: 'x', name: '  ' }] }).piles, defaultSettings.piles);
  assert.deepEqual(
    defaultSettings.piles.map(pile => pile.name),
    ['Unread'],
  );
  assert.deepEqual(unreadPile.swipes.right, swipeOf('markRead', 'archive'), 'right marks read and archives');
  assert.deepEqual(unreadPile.swipes.down, swipeOf('markRead'));
  assert.deepEqual(newPile('p1', 'Later').swipes.right, swipeOf('markRead', 'archive'));
  assert.deepEqual(newPile('p1', 'Later').swipes.down, swipeOf('skip'), 'piles the user adds skip on down');
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
    filters: { ...emptyFilters, where: 'inbox', hasLabels: [later], search: 'older_than:30d' },
    swipes: {
      right: { actions: [removeLabel(later)], allFromSender: false },
      left: { actions: [addLabel(later), addLabel(bills)], allFromSender: false },
      up: defaultSwipes.up,
      down: defaultSwipes.down,
    },
  });
});

test('settings from before piles become the Unread pile, with its swipes and search; Read is left out', () => {
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
    swipes: {
      ...unreadPile.swipes,
      right: swipeOf('archive'),
      left: { actions: [addLabel(later), { id: 'archive' }], allFromSender: false },
    },
  });
  assert.equal(restored.piles.length, 1);
  assert.equal(restored.loadImages, false);

  const custom = restoreSettings({ query: 'in:inbox is:unread category:promotions' });
  assert.deepEqual(custom.piles[0]!.filters, { ...emptyFilters, search: 'in:inbox is:unread category:promotions' });
  assert.deepEqual(custom.piles[0]!.swipes, unreadPile.swipes, 'settings older still start from the default swipes');
});

test('saved Archive swipes keep marking read while the old setting was on, which it was by default', () => {
  const pile = (archiveMarksRead?: boolean) =>
    restoreSettings({ piles: [{ id: 'p', name: 'P', swipes: { right: { action: 'archive' } } }], archiveMarksRead }).piles[0]!;
  assert.deepEqual(pile().swipes.right, swipeOf('markRead', 'archive'));
  assert.deepEqual(pile(true).swipes.right, swipeOf('markRead', 'archive'));
  assert.deepEqual(pile(false).swipes.right, swipeOf('archive'));
  assert.ok(!('archiveMarksRead' in restoreSettings({ archiveMarksRead: true })), 'the setting itself is gone');
});

test('a swipe of several actions is restored; each counts once, and Read, Reply or Skip stand alone', () => {
  const restore = (saved: unknown) =>
    restoreSettings({ piles: [{ id: 'p', name: 'P', swipes: { right: saved } }] }).piles[0]!.swipes.right;
  assert.deepEqual(
    restore({
      actions: [{ id: 'markRead' }, addLabel(later), addLabel(later), { id: 'addLabel' }, { id: 'archive' }, { id: 'nope' }],
    }),
    { actions: [{ id: 'markRead' }, addLabel(later), { id: 'archive' }], allFromSender: false },
  );
  assert.deepEqual(restore({ actions: [{ id: 'archive' }, { id: 'reply' }] }), swipeOf('reply'));
  assert.deepEqual(restore({ actions: [] }), defaultSwipes.right, 'a swipe with no action falls back');
  assert.deepEqual(restore({ actions: [{ id: 'unsubscribe' }] }), defaultSwipes.right, 'unsubscribe is not a swipe');
});

test('the dedicated filters are restored when valid, and left empty otherwise', () => {
  const restore = (filters: unknown) => restoreSettings({ piles: [{ id: 'p', name: 'P', filters }] }).piles[0]!.filters;
  assert.deepEqual(
    restore({ category: 'updates', olderThan: { count: 6, unit: 'm' }, from: ' bank ', hasAttachment: true, noLabels: true }),
    {
      ...emptyFilters,
      read: 'unread',
      where: 'inbox',
      category: 'updates',
      olderThan: { count: 6, unit: 'm' },
      from: 'bank',
      hasAttachment: true,
      noLabels: true,
    },
  );
  const broken = restore({ category: 'spam', olderThan: { count: 0.5, unit: 'w' }, from: 3, hasAttachment: 'yes' });
  assert.deepEqual(broken, { ...emptyFilters, read: 'unread', where: 'inbox' });
  assert.equal(restore({ olderThan: { count: 2, unit: 'w' } }).olderThan, null);
});

test('labels take their current names from Gmail, and a deleted one drops out', () => {
  const pile = {
    ...newPile('p1', 'Accounting'),
    filters: { ...newPile('p1', 'x').filters, hasLabels: [later], lacksLabels: [bills] },
    swipes: {
      ...defaultSwipes,
      right: { actions: [removeLabel(later)], allFromSender: false },
      left: { actions: [addLabel(later), addLabel(bills), { id: 'archive' as const }], allFromSender: false },
    },
  };
  const renamed = withCurrentLabels({ ...defaultSettings, piles: [pile] }, [{ id: 'Label_1', name: 'Todo accounting' }]);
  const updated = renamed.piles[0]!;
  assert.deepEqual(updated.filters.hasLabels, [{ id: 'Label_1', name: 'Todo accounting' }]);
  assert.deepEqual(updated.filters.lacksLabels, []);
  const renamedLabel = { id: 'Label_1', name: 'Todo accounting' };
  assert.deepEqual(updated.swipes.right, { actions: [removeLabel(renamedLabel)], allFromSender: false });
  assert.deepEqual(
    updated.swipes.left,
    { actions: [addLabel(renamedLabel), { id: 'archive' }], allFromSender: false },
    'the deleted label leaves the swipe',
  );

  const gone = withCurrentLabels({ ...defaultSettings, piles: [pile] }, []).piles[0]!;
  assert.deepEqual(gone.swipes.right, swipeOf('skip'), 'a swipe left with no action skips');
  assert.deepEqual(gone.swipes.left, swipeOf('archive'));
});

test('a swipe can cover all from the sender, where its action allows', () => {
  const restored = restoreSettings({
    piles: [
      {
        id: 'p',
        name: 'P',
        swipes: { right: { action: 'archive', allFromSender: true }, up: { action: 'read', allFromSender: true } },
      },
    ],
  }).piles[0]!;
  assert.equal(restored.swipes.right.allFromSender, true);
  assert.equal(restored.swipes.up.allFromSender, false, 'reading is about one conversation');
  assert.equal(restored.swipes.left.allFromSender, false);
});
