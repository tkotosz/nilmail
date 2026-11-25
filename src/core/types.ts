/** A swipe direction; each one is mapped to an action in the settings. */
export type Direction = 'left' | 'right' | 'up' | 'down';

export const directions: readonly Direction[] = ['left', 'down', 'up', 'right'];

/** What the user can do with a conversation. */
export type ActionId =
  'markRead' | 'archive' | 'delete' | 'addLabel' | 'removeLabel' | 'removeAllLabels' | 'read' | 'reply' | 'skip' | 'unsubscribe';

/**
 * The actions a swipe can do, in the order Settings offers them. Unsubscribe is left out: only some conversations offer
 * it, so it is a button in the read view.
 */
export const gestureActionIds: readonly ActionId[] = [
  'markRead',
  'archive',
  'delete',
  'addLabel',
  'removeLabel',
  'removeAllLabels',
  'read',
  'reply',
  'skip',
];

/** Actions that only work on their own: Read opens the conversation, Reply opens Gmail, Skip does nothing. */
export const standaloneActionIds: readonly ActionId[] = ['read', 'reply', 'skip'];

/** A Gmail label the user made, such as "Later". */
export interface GmailLabel {
  id: string;
  name: string;
}

/**
 * How the sender lets the reader unsubscribe, from the List-Unsubscribe header: `oneClick` is a link that unsubscribes
 * when it receives a POST (RFC 8058), `web` a page to open, `mailto` an email to send.
 * https://www.rfc-editor.org/rfc/rfc8058
 */
export type Unsubscribe = { kind: 'oneClick' | 'web' | 'mailto'; url: string };

export interface Person {
  name: string;
  address: string;
}

/** A conversation as the deck shows it: the latest message stands for the whole thread. */
export interface MailCard {
  threadId: string;
  from: Person;
  subject: string;
  /** The latest message's time, in milliseconds since the epoch. */
  date: number;
  snippet: string;
  messageCount: number;
  hasAttachment: boolean;
  /** The labels of all messages in the thread together, such as INBOX and UNREAD. */
  labelIds: string[];
  /** The newest way to unsubscribe that a message in the thread offers, if any. */
  unsubscribe: Unsubscribe | null;
}

/** One change to a conversation in Gmail. */
export type GmailStep = { op: 'modify'; add: string[]; remove: string[] } | { op: 'trash' } | { op: 'untrash' };

/** One thing a swipe does. Add label and Remove label name their label. */
export interface Action {
  id: ActionId;
  label?: GmailLabel;
}

/** What one swipe does: one or more actions, applied together and undone together. */
export interface Swipe {
  /** Either one action from `standaloneActionIds`, or any number of the others. */
  actions: Action[];
  /** The actions also cover the sender's other conversations in the pile, with one undo. */
  allFromSender: boolean;
  /** The user's name for the swipe, shown on its button and while dragging; '' to name it after its actions. */
  name: string;
}

/** Which conversations a pile holds; every filter set must match. */
export interface PileFilters {
  read: 'unread' | 'read' | 'any';
  where: 'inbox' | 'archived' | 'anywhere';
  /** The conversation has every one of these labels. */
  hasLabels: GmailLabel[];
  /** The conversation has none of these labels. */
  lacksLabels: GmailLabel[];
  /** One of Gmail's inbox categories, or '' for any. */
  category: '' | 'primary' | 'promotions' | 'social' | 'updates' | 'forums';
  /** Only conversations older than this, such as 30 days; null for any age. */
  olderThan: { count: number; unit: 'd' | 'm' | 'y' } | null;
  /** A sender's address, name or domain, such as `shop.example`; '' for anyone. */
  from: string;
  hasAttachment: boolean;
  /** Only conversations without any label the user made. */
  noLabels: boolean;
  /** Any Gmail search, added as written, such as `subject:invoice`. */
  search: string;
}

/** A saved set of filters with its own swipes; the header picker lists them. */
export interface Pile {
  id: string;
  name: string;
  filters: PileFilters;
  swipes: Record<Direction, Swipe>;
}

export interface Settings {
  /** In the picker's order; the app opens on the first. There is always at least one. */
  piles: Pile[];
  /** Remote images in the read view load without asking. */
  loadImages: boolean;
}

/** A thread search: Gmail's search text, and labels every thread must have (matched by id, whatever their names). */
export interface GmailSearch {
  q: string;
  labelIds: string[];
}

/** One message of a conversation, ready for the read view. */
export interface MessageView {
  id: string;
  from: Person;
  to: string;
  cc: string;
  subject: string;
  date: number;
  snippet: string;
  /** The HTML body when the message has one. */
  html: string | null;
  /** The plain-text body, used when there is no HTML body. */
  text: string | null;
  attachments: { filename: string; size: number }[];
}

export interface ThreadView {
  threadId: string;
  subject: string;
  messages: MessageView[];
}
