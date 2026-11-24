import type { ActionId, GmailStep, MailCard, Settings } from './types.ts';

export const actionLabels: Record<ActionId, { verb: string; done: string }> = {
  archive: { verb: 'Archive', done: 'Archived' },
  delete: { verb: 'Delete', done: 'Moved to Bin' },
  markRead: { verb: 'Mark read', done: 'Marked read' },
  read: { verb: 'Read', done: 'Opened' },
  reply: { verb: 'Reply', done: 'Opened in Gmail' },
  skip: { verb: 'Skip', done: 'Skipped' },
  unsubscribe: { verb: 'Unsubscribe', done: 'Unsubscribed and archived' },
};

/** Read and Reply are about one conversation; the others can cover all from a sender at once. */
export const coversSender = (action: ActionId) => action !== 'read' && action !== 'reply';

export const isUnread = (card: MailCard) => card.labelIds.includes('UNREAD');

/** Removes the labels the card has; asking Gmail to remove a label a thread lacks would make undo add it. */
function removing(card: MailCard, labels: string[]): GmailStep[] {
  const remove = labels.filter(label => card.labelIds.includes(label));
  return remove.length ? [{ op: 'modify', add: [], remove }] : [];
}

/**
 * What an action changes in Gmail. Read changes only the UNREAD label, when the read view opens; Reply and Skip change
 * nothing. Unsubscribe archives: the request to the sender is not a Gmail change.
 */
export function stepsFor(action: ActionId, card: MailCard, settings: Settings): GmailStep[] {
  switch (action) {
    case 'archive':
    case 'unsubscribe':
      return removing(card, settings.archiveMarksRead ? ['INBOX', 'UNREAD'] : ['INBOX']);
    case 'delete':
      return [{ op: 'trash' }];
    case 'markRead':
    case 'read':
      return removing(card, ['UNREAD']);
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
