import { useEffect, useRef, type ReactNode } from 'react';

/**
 * The events that turn a close request into `onRequest`: the phone's Back and Escape. Chrome sends them to an open modal
 * dialog before the history, as `cancel`, which can be stopped only after the user has touched the page since the last
 * one; otherwise it closes the dialog itself. Both cases end up in `onRequest`, the dialog reopened, so a second Back
 * right after the first still steps back one level instead of closing everything.
 */
export function closeRequestHandlers(onRequest: () => void) {
  return {
    onCancel: (event: { cancelable: boolean; preventDefault(): void }) => {
      // A cancel Chrome will not let us stop is followed by the dialog closing: the close handler takes it then.
      if (!event.cancelable) return;
      event.preventDefault();
      onRequest();
    },
    onClose: (event: { currentTarget: HTMLDialogElement }) => {
      const dialog = event.currentTarget;
      // React removes the dialog itself when it closes; a dialog still in the page was closed by the browser.
      if (!dialog.isConnected) return;
      dialog.showModal();
      onRequest();
    },
  };
}
import { ArrowLeft, X } from 'lucide-react';

/**
 * A dialog with a header: close at the start, or back on a page below its first, the title, and an optional action at the
 * end. With `fullScreen` it fills a phone's screen and becomes a centered dialog on wider ones, as Material's full-screen
 * dialogs do.
 */
export function Modal({
  name,
  onClose,
  children,
  className,
  action,
  fullScreen = false,
  title,
  onBack,
}: {
  name: string;
  /** The header's title when it differs from the dialog's name, such as a page inside Settings. */
  title?: string;
  /** Given on a page below the first: the header's leading button goes back instead of closing. */
  onBack?(): void;
  /** Escape, the close button and a tap outside all ask to close; the caller decides. */
  onClose(): void;
  children: ReactNode;
  className?: string;
  action?: ReactNode;
  fullScreen?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    ref.current?.showModal();
    // The title takes the focus rather than Close, so no focus ring shows on opening.
    heading.current?.focus({ preventScroll: true });
    return () => opener?.focus({ preventScroll: true });
  }, []);
  return (
    <dialog
      ref={ref}
      className={[fullScreen ? 'full-screen' : '', className ?? ''].join(' ').trim() || undefined}
      aria-labelledby="dialog-title"
      {...closeRequestHandlers(onBack ?? onClose)}
      onClick={event => {
        if (event.target === ref.current) onClose();
      }}
    >
      <header className="modal-header">
        {onBack ? (
          <button type="button" className="icon-button" onClick={onBack} aria-label="Back" title="Back">
            <ArrowLeft size={22} />
          </button>
        ) : (
          <button type="button" className="icon-button" onClick={onClose} aria-label="Close" title="Close">
            <X size={22} />
          </button>
        )}
        <h2 id="dialog-title" ref={heading} tabIndex={-1}>
          {title ?? name}
        </h2>
        {action}
      </header>
      <div className="modal-content">{children}</div>
    </dialog>
  );
}

/** Material's basic dialog asking to confirm something that cannot be undone, such as deleting a pile. */
export function ConfirmDialog({
  title,
  text,
  confirm,
  cancel = 'Cancel',
  onCancel,
  onConfirm,
}: {
  title: string;
  text: string;
  /** The confirming button's label, such as "Delete". */
  confirm: string;
  cancel?: string;
  onCancel(): void;
  onConfirm(): void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    ref.current?.showModal();
  }, []);
  return (
    <dialog ref={ref} className="basic-dialog" aria-labelledby="confirm-title" {...closeRequestHandlers(onCancel)}>
      <h2 id="confirm-title">{title}</h2>
      <p>{text}</p>
      <div className="dialog-actions">
        <button type="button" className="button text" onClick={onCancel}>
          {cancel}
        </button>
        <button type="button" className="button text" onClick={onConfirm}>
          {confirm}
        </button>
      </div>
    </dialog>
  );
}
