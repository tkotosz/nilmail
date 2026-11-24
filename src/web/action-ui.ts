import { Archive, BellOff, BookOpen, MailOpen, Reply, SkipForward, Tag, Trash2, type LucideIcon } from 'lucide-react';
import type { ActionId, Direction } from '../core/types.ts';

/** How an action looks: its icon, and the tone that colors its buttons and swipe label. */
export const actionUi: Record<ActionId, { Icon: LucideIcon; tone: string }> = {
  archive: { Icon: Archive, tone: 'green' },
  delete: { Icon: Trash2, tone: 'red' },
  markRead: { Icon: MailOpen, tone: 'teal' },
  read: { Icon: BookOpen, tone: 'blue' },
  reply: { Icon: Reply, tone: 'violet' },
  skip: { Icon: SkipForward, tone: 'gray' },
  label: { Icon: Tag, tone: 'plum' },
  unsubscribe: { Icon: BellOff, tone: 'orange' },
};

export const directionNames: Record<Direction, string> = { left: 'Left', right: 'Right', up: 'Up', down: 'Down' };
export const directionArrows: Record<Direction, string> = { left: '←', right: '→', up: '↑', down: '↓' };

export const keyDirections: Record<string, Direction> = {
  ArrowLeft: 'left',
  ArrowRight: 'right',
  ArrowUp: 'up',
  ArrowDown: 'down',
};
