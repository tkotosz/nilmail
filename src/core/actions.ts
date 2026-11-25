import { isUserLabel } from './pile.ts';
import type { Action, ActionId, GmailStep, MailCard, Swipe } from './types.ts';

/** Each action's name in Settings and the read view, and what the message after it says. */
export const actionLabels: Record<ActionId, { verb: string; done: string }> = {
  markRead: { verb: 'Mark read', done: 'Marked read' },
  archive: { verb: 'Archive', done: 'Archived' },
  delete: { verb: 'Delete', done: 'Moved to Bin' },
  addLabel: { verb: 'Add label', done: 'Labeled' },
  removeLabel: { verb: 'Remove label', done: 'Label removed' },
  removeAllLabels: { verb: 'Remove all labels', done: 'Labels removed' },
  read: { verb: 'Read', done: 'Opened' },
  reply: { verb: 'Reply', done: 'Opened in Gmail' },
  skip: { verb: 'Skip', done: 'Skipped' },
  unsubscribe: { verb: 'Unsubscribe', done: 'Unsubscribed and archived' },
};

/** An action's short name on a button: label actions name their label, such as "Later" or "− Later". */
function shortName(action: Action): string {
  if (action.id === 'addLabel' && action.label) return action.label.name;
  if (action.id === 'removeLabel' && action.label) return `− ${action.label.name}`;
  if (action.id === 'removeAllLabels') return 'Clear labels';
  return actionLabels[action.id].verb;
}

/**
 * What a swipe's button and swipe label show, short enough for a phone: its main action, and how many more it does, such
 * as "Archive +1" for Mark read and Archive; " all" when it covers the sender. Settings lists every action.
 */
export function actionVerb(swipe: Swipe): string {
  // A name the user gave the swipe says it best.
  if (swipe.name.trim()) return swipe.name.trim();
  const main = mainAction(swipe);
  const shown = swipe.actions.find(action => action.id === main) ?? swipe.actions[0];
  const more = swipe.actions.length - 1;
  const name = `${shown ? shortName(shown) : 'Nothing'}${more > 0 ? ` +${more}` : ''}`;
  return swipe.allFromSender && coversSender(swipe) ? `${name} all` : name;
}

/** What one action did, for the message after it, such as "labeled Later". */
function doneText(action: Action): string {
  if (action.id === 'addLabel' && action.label) return `Labeled ${action.label.name}`;
  if (action.id === 'removeLabel' && action.label) return `Removed ${action.label.name}`;
  return actionLabels[action.id].done;
}

/** What the message after the swipe says, such as "Marked read and archived". */
export function actionDone(swipe: Swipe): string {
  const parts = swipe.actions.map(doneText).map((text, index) => (index ? text.charAt(0).toLowerCase() + text.slice(1) : text));
  return parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}` : (parts[0] ?? '');
}

/** The action that best shows what a swipe does, for its icon and color: Delete, then Archive, then the label actions. */
export function mainAction(swipe: Swipe): ActionId {
  const order: ActionId[] = ['delete', 'archive', 'addLabel', 'removeLabel', 'removeAllLabels', 'markRead', 'unsubscribe'];
  const ids = swipe.actions.map(action => action.id);
  return order.find(id => ids.includes(id)) ?? ids[0] ?? 'skip';
}

/** Read and Reply are about one conversation; the other actions can cover all from a sender at once. */
export const coversSender = (swipe: Swipe) => !swipe.actions.some(action => action.id === 'read' || action.id === 'reply');

export const isUnread = (card: MailCard) => card.labelIds.includes('UNREAD');

/**
 * What a swipe changes in Gmail. Its label changes merge into one step, which adds only labels the thread lacks and removes
 * only labels it has, so undo restores it exactly; a label both added and removed (Remove all labels and Add label) is
 * added. Delete moves it to the Bin after that. Read takes off UNREAD when the read view opens; Reply and Skip change
 * nothing. Unsubscribe marks read and archives: the request to the sender is not a Gmail change. Remove all labels takes
 * off only labels the user made, never Gmail's own, such as INBOX, UNREAD or STARRED.
 */
export function stepsFor(swipe: Swipe, card: MailCard): GmailStep[] {
  const add = new Set<string>();
  const remove = new Set<string>();
  let trash = false;
  for (const action of swipe.actions) {
    switch (action.id) {
      case 'markRead':
      case 'read':
        remove.add('UNREAD');
        break;
      case 'archive':
        remove.add('INBOX');
        break;
      case 'unsubscribe':
        remove.add('INBOX');
        remove.add('UNREAD');
        break;
      case 'delete':
        trash = true;
        break;
      case 'addLabel':
        if (action.label) add.add(action.label.id);
        break;
      case 'removeLabel':
        if (action.label) remove.add(action.label.id);
        break;
      case 'removeAllLabels':
        for (const id of card.labelIds.filter(isUserLabel)) remove.add(id);
        break;
      case 'reply':
      case 'skip':
        break;
    }
  }
  for (const id of add) remove.delete(id);
  const adding = [...add].filter(label => !card.labelIds.includes(label));
  // Gmail's own labels first, in one fixed order, so a change reads the same whatever order the actions were added in.
  const systemFirst = ['INBOX', 'UNREAD'];
  const removing = [
    ...systemFirst.filter(label => remove.has(label)),
    ...[...remove].filter(label => !systemFirst.includes(label)),
  ].filter(label => card.labelIds.includes(label));
  const steps: GmailStep[] = adding.length || removing.length ? [{ op: 'modify', add: adding, remove: removing }] : [];
  return trash ? [...steps, { op: 'trash' }] : steps;
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
