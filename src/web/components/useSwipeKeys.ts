import { useEffect, type RefObject } from 'react';
import type { Direction } from '../../core/types.ts';
import type { SwipeCardHandle } from './SwipeCard.tsx';

/**
 * Swipes the card with the arrow keys while `active`, unless a dialog is open or a control that uses the arrows, such as
 * a text field, has the focus. A focused button does not use them, so the card's own buttons keep the keys working.
 */
export function useSwipeKeys(card: RefObject<SwipeCardHandle | null>, active: boolean, keys: Record<string, Direction>): void {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const direction = keys[event.key];
      const target = event.target as HTMLElement;
      if (
        !direction ||
        !active ||
        event.repeat ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        document.querySelector('dialog[open]') ||
        !['BODY', 'DIV', 'MAIN', 'BUTTON'].includes(target.tagName)
      )
        return;
      event.preventDefault();
      void card.current?.swipe(direction);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [card, active, keys]);
}
