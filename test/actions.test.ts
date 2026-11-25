import assert from 'node:assert/strict';
import test from 'node:test';
import { actionDone, actionVerb, applySteps, stepsFor, undoSteps } from '../src/core/actions.ts';
import { swipe } from '../src/core/pile.ts';
import { defaultSettings } from '../src/core/settings.ts';
import type { MailCard } from '../src/core/types.ts';

const card = (labelIds: string[]): MailCard => ({
  threadId: 't1',
  from: { name: 'Ann', address: 'ann@example.com' },
  subject: 'Hello',
  date: 0,
  snippet: '',
  messageCount: 1,
  hasAttachment: false,
  labelIds,
  unsubscribe: null,
});

test('archive takes the thread out of the inbox and marks it read, unless the setting says otherwise', () => {
  const unread = card(['INBOX', 'UNREAD', 'CATEGORY_UPDATES']);
  assert.deepEqual(stepsFor(swipe('archive'), unread, defaultSettings), [{ op: 'modify', add: [], remove: ['INBOX', 'UNREAD'] }]);
  assert.deepEqual(stepsFor(swipe('archive'), unread, { ...defaultSettings, archiveMarksRead: false }), [
    { op: 'modify', add: [], remove: ['INBOX'] },
  ]);
});

test('an action only removes labels the thread has, so undo never adds one it lacked', () => {
  const read = card(['INBOX']);
  const steps = stepsFor(swipe('archive'), read, defaultSettings);
  assert.deepEqual(steps, [{ op: 'modify', add: [], remove: ['INBOX'] }]);
  assert.deepEqual(undoSteps(steps, read), [{ op: 'modify', add: ['INBOX'], remove: [] }]);
  assert.deepEqual(stepsFor(swipe('markRead'), read, defaultSettings), [], 'marking a read thread read changes nothing');
});

test('reply and skip change nothing in Gmail; read and mark read remove UNREAD', () => {
  const unread = card(['INBOX', 'UNREAD']);
  assert.deepEqual(stepsFor(swipe('reply'), unread, defaultSettings), []);
  assert.deepEqual(stepsFor(swipe('skip'), unread, defaultSettings), []);
  assert.deepEqual(stepsFor(swipe('read'), unread, defaultSettings), [{ op: 'modify', add: [], remove: ['UNREAD'] }]);
  assert.deepEqual(stepsFor(swipe('markRead'), unread, defaultSettings), [{ op: 'modify', add: [], remove: ['UNREAD'] }]);
});

test('unsubscribe archives the thread like Archive does, so undo brings it back', () => {
  const unread = card(['INBOX', 'UNREAD']);
  assert.deepEqual(stepsFor(swipe('unsubscribe'), unread, defaultSettings), stepsFor(swipe('archive'), unread, defaultSettings));
  assert.deepEqual(stepsFor(swipe('unsubscribe'), unread, { ...defaultSettings, archiveMarksRead: false }), [
    { op: 'modify', add: [], remove: ['INBOX'] },
  ]);
});

test('add labels files the thread under its labels and, when set to, out of the inbox, still unread; undo reverses exactly that', () => {
  const later = { id: 'Label_1', name: 'Later' };
  const bills = { id: 'Label_2', name: 'Bills' };
  const unread = card(['INBOX', 'UNREAD']);
  const steps = stepsFor(swipe('addLabels', [later, bills]), unread, defaultSettings);
  assert.deepEqual(steps, [{ op: 'modify', add: ['Label_1', 'Label_2'], remove: ['INBOX'] }]);
  assert.deepEqual(undoSteps(steps, unread), [{ op: 'modify', add: ['INBOX'], remove: ['Label_1', 'Label_2'] }]);
  assert.deepEqual(stepsFor(swipe('addLabels', [later], false), unread, defaultSettings), [
    { op: 'modify', add: ['Label_1'], remove: [] },
  ]);
  assert.deepEqual(
    stepsFor(swipe('addLabels', [later, bills]), card(['INBOX', 'Label_1']), defaultSettings),
    [{ op: 'modify', add: ['Label_2'], remove: ['INBOX'] }],
    'a label the thread already has is not added, so undo keeps it',
  );
  assert.deepEqual(stepsFor(swipe('addLabels', [later]), card(['Label_1']), defaultSettings), []);
  assert.deepEqual(stepsFor(swipe('addLabels'), unread, defaultSettings), [], 'without a label, nothing happens');
  assert.equal(actionVerb(swipe('addLabels', [later, bills])), 'Later, Bills');
  assert.equal(actionDone(swipe('addLabels', [later])), 'Moved to Later');
  assert.equal(actionDone(swipe('addLabels', [later], false)), 'Labeled Later');
  assert.equal(actionVerb(swipe('archive')), 'Archive');
});

test('remove label takes off one label, and remove all labels only the ones the user made', () => {
  const later = { id: 'Label_1', name: 'Later' };
  const filed = card(['INBOX', 'UNREAD', 'STARRED', 'CATEGORY_UPDATES', 'Label_1', 'Label_7']);
  const one = stepsFor(swipe('removeLabel', [later]), filed, defaultSettings);
  assert.deepEqual(one, [{ op: 'modify', add: [], remove: ['Label_1'] }]);
  assert.deepEqual(undoSteps(one, filed), [{ op: 'modify', add: ['Label_1'], remove: [] }]);
  assert.deepEqual(stepsFor(swipe('removeLabel', [later]), card(['INBOX']), defaultSettings), [], 'a label it lacks');
  const all = stepsFor(swipe('removeAllLabels'), filed, defaultSettings);
  assert.deepEqual(all, [{ op: 'modify', add: [], remove: ['Label_1', 'Label_7'] }]);
  assert.deepEqual(stepsFor(swipe('removeAllLabels'), card(['INBOX', 'STARRED']), defaultSettings), []);
  assert.equal(actionVerb(swipe('removeLabel', [later])), '− Later');
  assert.equal(actionDone(swipe('removeLabel', [later])), 'Removed Later');
  assert.equal(actionVerb(swipe('removeAllLabels')), 'Clear labels');
});

test('undoing a delete takes the thread out of the Bin and puts back its inbox and unread labels', () => {
  const unread = card(['INBOX', 'UNREAD', 'IMPORTANT']);
  const steps = stepsFor(swipe('delete'), unread, defaultSettings);
  assert.deepEqual(steps, [{ op: 'trash' }]);
  assert.deepEqual(undoSteps(steps, unread), [{ op: 'untrash' }, { op: 'modify', add: ['INBOX', 'UNREAD'], remove: [] }]);
  assert.deepEqual(undoSteps(steps, card(['IMPORTANT'])), [{ op: 'untrash' }]);
});

test('a card keeps up with its label changes', () => {
  const unread = card(['INBOX', 'UNREAD']);
  assert.deepEqual(applySteps(unread, stepsFor(swipe('read'), unread, defaultSettings)).labelIds, ['INBOX']);
  assert.deepEqual(applySteps(unread, [{ op: 'modify', add: ['STARRED', 'INBOX'], remove: [] }]).labelIds, [
    'INBOX',
    'UNREAD',
    'STARRED',
  ]);
});

test('a swipe that covers all from the sender says so', () => {
  assert.equal(actionVerb({ ...swipe('archive'), allFromSender: true }), 'Archive all');
  assert.equal(actionVerb({ ...swipe('read'), allFromSender: true }), 'Read', 'reading covers one conversation');
});
