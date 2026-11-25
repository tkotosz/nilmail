import assert from 'node:assert/strict';
import test from 'node:test';
import {
  countFromLabel,
  emptyFilters,
  hasMoreFilters,
  pileCount,
  pileSearch,
  pileSummary,
  searchLabelName,
  senderSearch,
} from '../src/core/pile.ts';
import type { PileFilters } from '../src/core/types.ts';

const filters = (changes: Partial<PileFilters>): PileFilters => ({ ...emptyFilters, ...changes });
const todo = { id: 'Label_1', name: 'todo accounting' };
const later = { id: 'Label_2', name: 'Later' };

test('a pile becomes a Gmail search; labels it must have go by id', () => {
  assert.deepEqual(pileSearch(filters({ read: 'unread', where: 'inbox' })), { q: 'is:unread in:inbox', labelIds: [] });
  assert.deepEqual(pileSearch(filters({ read: 'read', where: 'archived' })), { q: 'is:read -in:inbox', labelIds: [] });
  assert.deepEqual(pileSearch(filters({ hasLabels: [todo, later] })), { q: '', labelIds: ['Label_1', 'Label_2'] });
  assert.deepEqual(pileSearch(filters({ lacksLabels: [todo], search: ' from:shop.example ' })), {
    q: '-label:"todo-accounting" (from:shop.example)',
    labelIds: [],
  });
});

test('the dedicated filters become Gmail operators, and make the count an estimate', () => {
  const more = filters({
    read: 'read',
    category: 'promotions',
    olderThan: { count: 30, unit: 'd' },
    from: ' shop.example ',
    hasAttachment: true,
    noLabels: true,
  });
  assert.deepEqual(pileSearch(more), {
    q: 'is:read category:promotions older_than:30d from:"shop.example" has:attachment has:nouserlabels',
    labelIds: [],
  });
  assert.ok(hasMoreFilters(more));
  assert.ok(!hasMoreFilters(filters({ read: 'unread', hasLabels: [todo] })));
  for (const extra of [
    { category: 'social' as const },
    { olderThan: { count: 1, unit: 'y' as const } },
    { from: 'ann' },
    { hasAttachment: true },
    { noLabels: true },
  ]) {
    assert.equal(pileCount(filters({ where: 'inbox', ...extra })), null);
  }
  assert.equal(
    pileSummary(more),
    'Anywhere · read · no labels · Promotions · older than 30 days · from shop.example · with attachment',
  );
  assert.equal(pileSummary(filters({ olderThan: { count: 1, unit: 'y' } })), 'Anywhere · read or unread · older than 1 year');
});

test('label names in a search use hyphens for spaces, and keep the slash of a nested label', () => {
  assert.equal(searchLabelName('todo  accounting'), 'todo-accounting');
  assert.equal(searchLabelName('Work/Invoices 2026'), 'Work/Invoices-2026');
});

test('the sender search adds the address to the pile search', () => {
  assert.deepEqual(senderSearch({ q: 'is:unread', labelIds: ['Label_1'] }, 'ann@example.com'), {
    q: 'is:unread from:"ann@example.com"',
    labelIds: ['Label_1'],
  });
  assert.deepEqual(senderSearch({ q: '', labelIds: [] }, 'odd"@example.com'), { q: 'from:"odd@example.com"', labelIds: [] });
});

test('a pile counts exactly from a label only when its filters allow; otherwise Gmail estimates', () => {
  assert.deepEqual(pileCount(filters({ read: 'unread', where: 'inbox' })), { labelId: 'INBOX', read: 'unread' });
  assert.deepEqual(pileCount(filters({ read: 'read', where: 'inbox' })), { labelId: 'INBOX', read: 'read' });
  assert.deepEqual(pileCount(filters({ hasLabels: [todo] })), { labelId: 'Label_1', read: 'any' });
  assert.deepEqual(pileCount(filters({ read: 'unread', hasLabels: [todo] })), { labelId: 'Label_1', read: 'unread' });
  assert.equal(pileCount(filters({ where: 'inbox', hasLabels: [todo] })), null);
  assert.equal(pileCount(filters({ hasLabels: [todo, later] })), null);
  assert.equal(pileCount(filters({ hasLabels: [todo], search: 'from:x' })), null);
  assert.equal(pileCount(filters({ read: 'unread', where: 'inbox', lacksLabels: [later] })), null);
  assert.deepEqual(pileCount(filters({ where: 'inbox' })), { labelId: 'INBOX', read: 'any' });

  assert.equal(countFromLabel({ total: 10, unread: 3 }, 'unread'), 3);
  assert.equal(countFromLabel({ total: 10, unread: 3 }, 'read'), 7);
  assert.equal(countFromLabel({ total: 10, unread: 3 }, 'any'), 10);
});

test('the summary says what a pile holds', () => {
  assert.equal(pileSummary(filters({ read: 'unread', where: 'inbox' })), 'Inbox · unread');
  assert.equal(
    pileSummary(filters({ hasLabels: [todo], lacksLabels: [later], search: 'from:shop' })),
    'Anywhere · read or unread · has todo accounting · not Later · “from:shop”',
  );
});
