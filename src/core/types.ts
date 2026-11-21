/** A swipe direction; each one is mapped to an action in the settings. */
export type Direction = 'left' | 'right' | 'up' | 'down';

export const directions: readonly Direction[] = ['left', 'down', 'up', 'right'];

/** What the user can do with a conversation. */
export type ActionId = 'archive' | 'delete' | 'markRead' | 'read' | 'reply' | 'skip';

export const actionIds: readonly ActionId[] = ['archive', 'delete', 'markRead', 'read', 'reply', 'skip'];

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
}

/** One change to a conversation in Gmail. */
export type GmailStep = { op: 'modify'; add: string[]; remove: string[] } | { op: 'trash' } | { op: 'untrash' };

export interface Settings {
  gestures: Record<Direction, ActionId>;
  /** Archive also removes UNREAD, so archived mail does not stay unread in All Mail. */
  archiveMarksRead: boolean;
  /** Remote images in the read view load without asking. */
  loadImages: boolean;
  /** The Gmail search that fills the deck. */
  query: string;
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
