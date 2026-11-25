import assert from 'node:assert/strict';
import test from 'node:test';
import { actionDone, actionVerb, applySteps, coversSender, mainAction, stepsFor, undoSteps } from '../src/core/actions.ts';
import { swipeOf } from '../src/core/pile.ts';
import type { GmailLabel, MailCard, Swipe } from '../src/core/types.ts';

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
const later: GmailLabel = { id: 'Label_1', name: 'Later' };
const bills: GmailLabel = { id: 'Label_2', name: 'Bills' };
const withLabels = (...actions: Swipe['actions']): Swipe => ({ actions, allFromSender: false, name: '' });

test("a swipe's actions merge into one change, which undo reverses exactly", () => {
  const unread = card(['INBOX', 'UNREAD', 'CATEGORY_UPDATES']);
  const both = swipeOf('markRead', 'archive');
  const steps = stepsFor(both, unread);
  assert.deepEqual(steps, [{ op: 'modify', add: [], remove: ['INBOX', 'UNREAD'] }]);
  assert.deepEqual(undoSteps(steps, unread), [{ op: 'modify', add: ['INBOX', 'UNREAD'], remove: [] }]);
  assert.deepEqual(
    stepsFor(swipeOf('archive'), unread),
    [{ op: 'modify', add: [], remove: ['INBOX'] }],
    'Archive alone keeps it unread',
  );
});

test('an action only removes labels the thread has, so undo never adds one it lacked', () => {
  const read = card(['INBOX']);
  assert.deepEqual(stepsFor(swipeOf('markRead', 'archive'), read), [{ op: 'modify', add: [], remove: ['INBOX'] }]);
  assert.deepEqual(stepsFor(swipeOf('markRead'), read), [], 'marking a read thread read changes nothing');
});

test('reply and skip change nothing in Gmail; read removes UNREAD; unsubscribe marks read and archives', () => {
  const unread = card(['INBOX', 'UNREAD']);
  assert.deepEqual(stepsFor(swipeOf('reply'), unread), []);
  assert.deepEqual(stepsFor(swipeOf('skip'), unread), []);
  assert.deepEqual(stepsFor(swipeOf('read'), unread), [{ op: 'modify', add: [], remove: ['UNREAD'] }]);
  assert.deepEqual(stepsFor(swipeOf('unsubscribe'), unread), [{ op: 'modify', add: [], remove: ['INBOX', 'UNREAD'] }]);
});

test('several Add label actions, with Mark read and Archive, file the thread in one change', () => {
  const unread = card(['INBOX', 'UNREAD']);
  const filing = withLabels(
    { id: 'markRead' },
    { id: 'addLabel', label: later },
    { id: 'addLabel', label: bills },
    { id: 'archive' },
  );
  const steps = stepsFor(filing, unread);
  assert.deepEqual(steps, [{ op: 'modify', add: ['Label_1', 'Label_2'], remove: ['INBOX', 'UNREAD'] }]);
  assert.deepEqual(undoSteps(steps, unread), [{ op: 'modify', add: ['INBOX', 'UNREAD'], remove: ['Label_1', 'Label_2'] }]);
  assert.deepEqual(
    stepsFor(withLabels({ id: 'addLabel', label: later }), card(['INBOX', 'Label_1'])),
    [],
    'a label the thread already has is not added, so undo keeps it',
  );
});

test('a swipe can move mail from one label to another: remove one, add the other', () => {
  const filed = card(['Label_1']);
  const move = withLabels({ id: 'removeLabel', label: later }, { id: 'addLabel', label: bills });
  assert.deepEqual(stepsFor(move, filed), [{ op: 'modify', add: ['Label_2'], remove: ['Label_1'] }]);
});

test('remove all labels takes off only the labels the user made, and a label added with it stays', () => {
  const filed = card(['INBOX', 'UNREAD', 'STARRED', 'CATEGORY_UPDATES', 'Label_1', 'Label_7']);
  assert.deepEqual(stepsFor(swipeOf('removeAllLabels'), filed), [{ op: 'modify', add: [], remove: ['Label_1', 'Label_7'] }]);
  assert.deepEqual(stepsFor(swipeOf('removeAllLabels'), card(['INBOX', 'STARRED'])), []);
  assert.deepEqual(stepsFor(withLabels({ id: 'removeAllLabels' }, { id: 'addLabel', label: later }), filed), [
    { op: 'modify', add: [], remove: ['Label_7'] },
  ]);
});

test('delete with other actions changes the labels first, then moves to the Bin; undo puts everything back', () => {
  const unread = card(['INBOX', 'UNREAD', 'IMPORTANT']);
  assert.deepEqual(stepsFor(swipeOf('delete'), unread), [{ op: 'trash' }]);
  assert.deepEqual(undoSteps([{ op: 'trash' }], unread), [
    { op: 'untrash' },
    { op: 'modify', add: ['INBOX', 'UNREAD'], remove: [] },
  ]);
  assert.deepEqual(undoSteps([{ op: 'trash' }], card(['IMPORTANT'])), [{ op: 'untrash' }]);
  const steps = stepsFor(swipeOf('markRead', 'delete'), unread);
  assert.deepEqual(steps, [{ op: 'modify', add: [], remove: ['UNREAD'] }, { op: 'trash' }]);
  assert.deepEqual(undoSteps(steps, unread), [
    { op: 'untrash' },
    { op: 'modify', add: ['INBOX', 'UNREAD'], remove: [] },
    { op: 'modify', add: ['UNREAD'], remove: [] },
  ]);
});

test('buttons name the main action and count the rest; the message after a swipe joins what happened', () => {
  assert.equal(actionVerb(swipeOf('markRead', 'archive')), 'Archive +1');
  assert.equal(actionVerb(withLabels({ id: 'addLabel', label: later }, { id: 'removeLabel', label: bills })), 'Later +1');
  assert.equal(actionVerb(swipeOf('markRead')), 'Mark read');
  assert.equal(actionVerb(swipeOf('removeAllLabels')), 'Clear labels');
  assert.equal(actionVerb({ ...swipeOf('archive'), allFromSender: true }), 'Archive all');
  assert.equal(actionVerb({ ...swipeOf('markRead', 'archive'), allFromSender: true }), 'Archive +1 all');
  assert.equal(actionVerb({ ...swipeOf('read'), allFromSender: true }), 'Read', 'reading covers one conversation');
  assert.equal(actionDone(swipeOf('markRead', 'archive')), 'Marked read and archived');
  assert.equal(
    actionDone(withLabels({ id: 'markRead' }, { id: 'addLabel', label: later }, { id: 'archive' })),
    'Marked read, labeled Later and archived',
  );
  assert.equal(actionDone(withLabels({ id: 'removeLabel', label: later })), 'Removed Later');
});

test('a named swipe shows its name on the button, whatever its actions', () => {
  assert.equal(actionVerb({ ...swipeOf('markRead', 'archive'), name: ' Done ' }), 'Done');
  assert.equal(actionVerb({ ...swipeOf('archive'), allFromSender: true, name: 'Clear sender' }), 'Clear sender');
  assert.equal(actionVerb({ ...swipeOf('archive'), name: '  ' }), 'Archive', 'a blank name counts as none');
});

test("a swipe's icon and color come from its most telling action", () => {
  assert.equal(mainAction(swipeOf('markRead', 'archive')), 'archive');
  assert.equal(mainAction(swipeOf('markRead', 'delete')), 'delete');
  assert.equal(mainAction(withLabels({ id: 'markRead' }, { id: 'addLabel', label: later })), 'addLabel');
  assert.equal(mainAction(swipeOf('skip')), 'skip');
  assert.ok(coversSender(swipeOf('markRead', 'archive')));
  assert.ok(!coversSender(swipeOf('reply')));
});

test('a card keeps up with its label changes', () => {
  const unread = card(['INBOX', 'UNREAD']);
  assert.deepEqual(applySteps(unread, stepsFor(swipeOf('read'), unread)).labelIds, ['INBOX']);
  assert.deepEqual(applySteps(unread, [{ op: 'modify', add: ['STARRED', 'INBOX'], remove: [] }]).labelIds, [
    'INBOX',
    'UNREAD',
    'STARRED',
  ]);
});
