import { isUserLabel } from './pile.ts';
import type { ActionId, GmailStep, MailCard, Settings, Swipe } from './types.ts';

/** Each action's name in Settings and the read view, and what the toast says after it. */
export const actionLabels: Record<ActionId, { verb: string; done: string }> = {
  archive: { verb: 'Archive', done: 'Archived' },
  delete: { verb: 'Delete', done: 'Moved to Bin' },
  markRead: { verb: 'Mark read', done: 'Marked read' },
  read: { verb: 'Read', done: 'Opened' },
  reply: { verb: 'Reply', done: 'Opened in Gmail' },
  skip: { verb: 'Skip', done: 'Skipped' },
  addLabels: { verb: 'Add labels', done: 'Labeled' },
  removeLabel: { verb: 'Remove label', done: 'Label removed' },
  removeAllLabels: { verb: 'Remove all labels', done: 'Labels removed' },
  unsubscribe: { verb: 'Unsubscribe', done: 'Unsubscribed and archived' },
};

const labelNames = (swipe: Swipe) => swipe.labels.map(label => label.name).join(', ');

/** What a swipe's button and swipe label show: label actions name their labels, such as "Invoices" or "− Invoices". */
export function actionVerb(swipe: Swipe): string {
  if (swipe.action === 'addLabels' && swipe.labels.length) return labelNames(swipe);
  if (swipe.action === 'removeLabel' && swipe.labels.length) return `− ${labelNames(swipe)}`;
  if (swipe.action === 'removeAllLabels') return 'Clear labels';
  return actionLabels[swipe.action].verb;
}

/** What the toast says after the swipe. */
export function actionDone(swipe: Swipe): string {
  if (swipe.action === 'addLabels' && swipe.labels.length) {
    return swipe.archive ? `Moved to ${labelNames(swipe)}` : `Labeled ${labelNames(swipe)}`;
  }
  if (swipe.action === 'removeLabel' && swipe.labels.length) return `Removed ${labelNames(swipe)}`;
  return actionLabels[swipe.action].done;
}

/** Read and Reply are about one conversation; the others can cover all from a sender at once. */
export const coversSender = (action: ActionId) => action !== 'read' && action !== 'reply';

export const isUnread = (card: MailCard) => card.labelIds.includes('UNREAD');

/**
 * One modify step that adds labels the card lacks and removes labels it has; asking Gmail to add a label a thread has,
 * or remove one it lacks, would make undo take away or add back a label that was never changed.
 */
function modifying(card: MailCard, add: string[], remove: string[]): GmailStep[] {
  const adding = add.filter(label => !card.labelIds.includes(label));
  const removing = remove.filter(label => card.labelIds.includes(label));
  return adding.length || removing.length ? [{ op: 'modify', add: adding, remove: removing }] : [];
}

/**
 * What a swipe changes in Gmail. Read changes only the UNREAD label, when the read view opens; Reply and Skip change
 * nothing. Unsubscribe archives: the request to the sender is not a Gmail change. Add labels adds its labels and, when
 * set to, archives, but keeps the thread unread, like a pile to go through later. Remove all labels removes only labels
 * the user made, never Gmail's own, such as INBOX, UNREAD or STARRED.
 */
export function stepsFor(swipe: Swipe, card: MailCard, settings: Settings): GmailStep[] {
  switch (swipe.action) {
    case 'addLabels':
      if (!swipe.labels.length) return [];
      return modifying(
        card,
        swipe.labels.map(label => label.id),
        swipe.archive ? ['INBOX'] : [],
      );
    case 'removeLabel':
      return modifying(
        card,
        [],
        swipe.labels.map(label => label.id),
      );
    case 'removeAllLabels':
      return modifying(card, [], card.labelIds.filter(isUserLabel));
    case 'archive':
    case 'unsubscribe':
      return modifying(card, [], settings.archiveMarksRead ? ['INBOX', 'UNREAD'] : ['INBOX']);
    case 'delete':
      return [{ op: 'trash' }];
    case 'markRead':
    case 'read':
      return modifying(card, [], ['UNREAD']);
    case 'reply':
    case 'skip':
      return [];
  }
}

/**
 * The steps that undo `steps` on a card that had the labels of `before`. Leaving the Bin puts back the inbox and unread
 * labels the card had, because untrashing alone may not.
 */
export function undoSteps(steps: GmailStep[], before: MailCard): GmailStep[] {
  return steps.toReversed().flatMap((step): GmailStep[] => {
    if (step.op === 'modify') return [{ op: 'modify', add: step.remove, remove: step.add }];
    if (step.op === 'untrash') return [{ op: 'trash' }];
    const restore = before.labelIds.filter(label => label === 'INBOX' || label === 'UNREAD');
    return [{ op: 'untrash' }, ...(restore.length ? [{ op: 'modify' as const, add: restore, remove: [] }] : [])];
  });
}

/**
 * The card's labels after label changes, so a later action and its undo start from the right labels. Bin steps are left
 * out: a card that went to the Bin leaves the deck, and its undo restores the card as it was.
 */
export function applySteps(card: MailCard, steps: GmailStep[]): MailCard {
  let labels = card.labelIds;
  for (const step of steps) {
    if (step.op !== 'modify') continue;
    labels = [...labels.filter(label => !step.remove.includes(label)), ...step.add.filter(label => !labels.includes(label))];
  }
  return { ...card, labelIds: labels };
}
