import assert from 'node:assert/strict';
import test from 'node:test';
import { actionDone, actionVerb, applySteps, stepsFor, undoSteps } from '../src/core/actions.ts';
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
  assert.deepEqual(stepsFor('archive', unread, defaultSettings), [{ op: 'modify', add: [], remove: ['INBOX', 'UNREAD'] }]);
  assert.deepEqual(stepsFor('archive', unread, { ...defaultSettings, archiveMarksRead: false }), [
    { op: 'modify', add: [], remove: ['INBOX'] },
  ]);
});

test('an action only removes labels the thread has, so undo never adds one it lacked', () => {
  const read = card(['INBOX']);
  const steps = stepsFor('archive', read, defaultSettings);
  assert.deepEqual(steps, [{ op: 'modify', add: [], remove: ['INBOX'] }]);
  assert.deepEqual(undoSteps(steps, read), [{ op: 'modify', add: ['INBOX'], remove: [] }]);
  assert.deepEqual(stepsFor('markRead', read, defaultSettings), [], 'marking a read thread read changes nothing');
});

test('reply and skip change nothing in Gmail; read and mark read remove UNREAD', () => {
  const unread = card(['INBOX', 'UNREAD']);
  assert.deepEqual(stepsFor('reply', unread, defaultSettings), []);
  assert.deepEqual(stepsFor('skip', unread, defaultSettings), []);
  assert.deepEqual(stepsFor('read', unread, defaultSettings), [{ op: 'modify', add: [], remove: ['UNREAD'] }]);
  assert.deepEqual(stepsFor('markRead', unread, defaultSettings), [{ op: 'modify', add: [], remove: ['UNREAD'] }]);
});

test('unsubscribe archives the thread like Archive does, so undo brings it back', () => {
  const unread = card(['INBOX', 'UNREAD']);
  assert.deepEqual(stepsFor('unsubscribe', unread, defaultSettings), stepsFor('archive', unread, defaultSettings));
  assert.deepEqual(stepsFor('unsubscribe', unread, { ...defaultSettings, archiveMarksRead: false }), [
    { op: 'modify', add: [], remove: ['INBOX'] },
  ]);
});

test('a label swipe files the thread under the label and out of the inbox, still unread, and undo reverses exactly that', () => {
  const later = { id: 'Label_1', name: 'Later' };
  const unread = card(['INBOX', 'UNREAD']);
  const steps = stepsFor('label', unread, defaultSettings, later);
  assert.deepEqual(steps, [{ op: 'modify', add: ['Label_1'], remove: ['INBOX'] }]);
  assert.deepEqual(undoSteps(steps, unread), [{ op: 'modify', add: ['INBOX'], remove: ['Label_1'] }]);
  assert.deepEqual(
    stepsFor('label', card(['INBOX', 'Label_1']), defaultSettings, later),
    [{ op: 'modify', add: [], remove: ['INBOX'] }],
    'a label the thread already has is not added, so undo keeps it',
  );
  assert.deepEqual(stepsFor('label', card(['Label_1']), defaultSettings, later), []);
  assert.deepEqual(stepsFor('label', unread, defaultSettings), [], 'without a label, nothing happens');
  assert.equal(actionVerb('label', later), 'Later');
  assert.equal(actionDone('label', later), 'Moved to Later');
  assert.equal(actionVerb('archive'), 'Archive');
});

test('undoing a delete takes the thread out of the Bin and puts back its inbox and unread labels', () => {
  const unread = card(['INBOX', 'UNREAD', 'IMPORTANT']);
  const steps = stepsFor('delete', unread, defaultSettings);
  assert.deepEqual(steps, [{ op: 'trash' }]);
  assert.deepEqual(undoSteps(steps, unread), [{ op: 'untrash' }, { op: 'modify', add: ['INBOX', 'UNREAD'], remove: [] }]);
  assert.deepEqual(undoSteps(steps, card(['IMPORTANT'])), [{ op: 'untrash' }]);
});

test('a card keeps up with its label changes', () => {
  const unread = card(['INBOX', 'UNREAD']);
  assert.deepEqual(applySteps(unread, stepsFor('read', unread, defaultSettings)).labelIds, ['INBOX']);
  assert.deepEqual(applySteps(unread, [{ op: 'modify', add: ['STARRED', 'INBOX'], remove: [] }]).labelIds, [
    'INBOX',
    'UNREAD',
    'STARRED',
  ]);
});
