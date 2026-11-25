import { useEffect, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';

/**
 * A dialog with a header: close at the start, the title, and an optional action at the end, such as Save. With
 * `fullScreen` it fills a phone's screen and becomes a centered dialog on wider ones, as Material's full-screen dialogs do.
 */
export function Modal({
  name,
  onClose,
  children,
  className,
  action,
  fullScreen = false,
}: {
  name: string;
  /** Escape, the close button and a tap outside all ask to close; the caller decides. */
  onClose(): void;
  children: ReactNode;
  className?: string;
  action?: ReactNode;
  fullScreen?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    ref.current?.showModal();
    return () => opener?.focus({ preventScroll: true });
  }, []);
  return (
    <dialog
      ref={ref}
      className={[fullScreen ? 'full-screen' : '', className ?? ''].join(' ').trim() || undefined}
      aria-labelledby="dialog-title"
      onCancel={event => {
        event.preventDefault();
        onClose();
      }}
      onClick={event => {
        if (event.target === ref.current) onClose();
      }}
    >
      <header className="modal-header">
        <button type="button" className="icon-button" onClick={onClose} aria-label="Close">
          <X size={22} />
        </button>
        <h2 id="dialog-title">{name}</h2>
        {action}
      </header>
      <div className="modal-content">{children}</div>
    </dialog>
  );
}

/** Material's basic dialog asking before unsaved changes are lost. */
export function DiscardDialog({ onKeep, onDiscard }: { onKeep(): void; onDiscard(): void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    ref.current?.showModal();
  }, []);
  return (
    <dialog
      ref={ref}
      className="basic-dialog"
      aria-labelledby="discard-title"
      onCancel={event => {
        event.preventDefault();
        onKeep();
      }}
    >
      <h2 id="discard-title">Discard changes?</h2>
      <p>Your changes to the settings have not been saved.</p>
      <div className="dialog-actions">
        <button type="button" className="button text" onClick={onKeep}>
          Keep editing
        </button>
        <button type="button" className="button text" onClick={onDiscard}>
          Discard
        </button>
      </div>
    </dialog>
  );
}
