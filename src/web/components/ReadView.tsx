import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ChevronDown, FileText } from 'lucide-react';
import { actionLabels } from '../../core/actions.ts';
import { recipientsText, threadView } from '../../core/message.ts';
import type { ActionId, MailCard, MessageView, ThreadView } from '../../core/types.ts';
import { actionUi } from '../action-ui.ts';
import { fileSize, fullDateTime, shortDate } from '../format.ts';
import type { WebGmail } from '../gmail-http.ts';
import { problemText } from '../gmail-http.ts';
import { Avatar } from './MailCardView.tsx';
import { MessageBody } from './MessageBody.tsx';
import { closeRequestHandlers } from './Modal.tsx';
import { appVersion } from '../version.ts';

/** The actions in the read view's top bar, as icons, the way Gmail shows them. */
const topActions: ActionId[] = ['archive', 'delete', 'skip'];

function IconAction({ action, label, onClick }: { action: ActionId; label: string; onClick(): void }) {
  const { Icon } = actionUi[action];
  return (
    <button type="button" className="icon-button" aria-label={label} title={label} onClick={onClick}>
      <Icon size={22} />
    </button>
  );
}

function Message({
  message,
  me,
  open,
  onOpen,
  loadImages,
}: {
  message: MessageView;
  /** The signed-in address, which the recipients show as "me". */
  me: string;
  open: boolean;
  onOpen(): void;
  loadImages: boolean;
}) {
  const [details, setDetails] = useState(false);
  if (!open) {
    return (
      <button type="button" className="message collapsed" onClick={onOpen}>
        <Avatar name={message.from.name} address={message.from.address} />
        <span className="message-collapsed-text">
          <strong>{message.from.name}</strong>
          <span>{message.snippet}</span>
        </span>
        <time>{shortDate(message.date)}</time>
      </button>
    );
  }
  const recipients = recipientsText(message.to, message.cc, me);
  return (
    <section className="message">
      <header className="message-header">
        <Avatar name={message.from.name} address={message.from.address} />
        <div className="message-who">
          <div className="message-from">
            <strong>{message.from.name}</strong>{' '}
            <time dateTime={new Date(message.date).toISOString()}>{shortDate(message.date)}</time>
          </div>
          <button type="button" className="message-to" aria-expanded={details} onClick={() => setDetails(shown => !shown)}>
            {recipients ? `to ${recipients}` : 'Details'}
            <ChevronDown size={16} aria-hidden="true" />
          </button>
        </div>
      </header>
      {details && (
        <dl className="message-details">
          <dt>From</dt>
          <dd>
            {message.from.name === message.from.address ? message.from.address : `${message.from.name} <${message.from.address}>`}
          </dd>
          {message.to && (
            <>
              <dt>To</dt>
              <dd>{message.to}</dd>
            </>
          )}
          {message.cc && (
            <>
              <dt>Cc</dt>
              <dd>{message.cc}</dd>
            </>
          )}
          <dt>Date</dt>
          <dd>{fullDateTime(message.date)}</dd>
        </dl>
      )}
      <MessageBody html={message.html} text={message.text} loadImages={loadImages} />
      {message.attachments.length > 0 && (
        <ul className="attachments" aria-label="Attachments">
          {message.attachments.map((attachment, index) => (
            <li key={index}>
              <FileText size={20} aria-hidden="true" />
              <span className="attachment-text">
                <span className="attachment-name">{attachment.filename}</span>
                <span className="attachment-size">{fileSize(attachment.size)}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** TEMPORARY: link shapes to try on Android; the one that opens Chrome itself, not its in-app tab, goes into the app. */
function BrowserLinkTest() {
  const page = 'example.com/';
  const fallback = encodeURIComponent(`https://${page}`);
  const links: [string, string][] = [
    ['1 · plain link (today)', `https://${page}`],
    ['2 · intent', `intent://${page}#Intent;scheme=https;end`],
    [
      '3 · intent, view + browsable',
      `intent://${page}#Intent;scheme=https;action=android.intent.action.VIEW;category=android.intent.category.BROWSABLE;S.browser_fallback_url=${fallback};end`,
    ],
    [
      '4 · intent, view + browsable + new task',
      `intent://${page}#Intent;scheme=https;action=android.intent.action.VIEW;category=android.intent.category.BROWSABLE;launchFlags=0x10000000;end`,
    ],
    ['5 · intent, Chrome named', `intent://${page}#Intent;scheme=https;package=com.android.chrome;end`],
  ];
  const installed = matchMedia('(display-mode: standalone)').matches;
  return (
    <details className="link-test" open>
      <summary>Browser link test (preview only) · {installed ? 'running as installed app' : 'running in a browser tab'}</summary>
      {links.map(([label, href]) => (
        <a key={label} href={href} target={href.startsWith('intent:') ? undefined : '_blank'} rel="noopener">
          {label}
        </a>
      ))}
    </details>
  );
}

/**
 * The whole conversation, full screen, laid out as Gmail does: the actions as icons in the top bar, the subject as the
 * page's title, and each message with its sender in brief.
 */
export function ReadView({
  card,
  gmail,
  email,
  loadImages,
  onAction,
  onClose,
}: {
  card: MailCard;
  gmail: WebGmail;
  /** The signed-in address. */
  email: string;
  loadImages: boolean;
  onAction(action: ActionId): void;
  onClose(): void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const title = useRef<HTMLHeadingElement>(null);
  const [thread, setThread] = useState<ThreadView | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [opened, setOpened] = useState<Set<string>>(new Set());

  useEffect(() => {
    dialog.current?.showModal();
    // Opening a dialog focuses its first button, Back, which Chrome may ring as keyboard focus even after a swipe. The
    // subject takes the focus instead: nothing shows, and a screen reader starts there.
    title.current?.focus({ preventScroll: true });
  }, []);

  useEffect(() => {
    let current = true;
    gmail.getThread(card.threadId, 'full').then(
      raw => current && setThread(threadView(raw)),
      error => current && setProblem(problemText(error)),
    );
    return () => {
      current = false;
    };
  }, [gmail, card.threadId]);

  const newest = thread?.messages[0]?.id;
  return (
    <dialog ref={dialog} className="read-view" aria-labelledby="read-subject" {...closeRequestHandlers(onClose)}>
      <header className="read-top">
        <button type="button" className="icon-button" onClick={onClose} aria-label="Back to the deck" title="Back">
          <ArrowLeft size={22} />
        </button>
        <span className="read-top-space" />
        {card.unsubscribe && (
          <IconAction action="unsubscribe" label="Unsubscribe and archive" onClick={() => onAction('unsubscribe')} />
        )}
        {topActions.map(action => (
          <IconAction key={action} action={action} label={actionLabels[action].verb} onClick={() => onAction(action)} />
        ))}
      </header>
      <div className="read-body">
        <h2 id="read-subject" className="read-subject" ref={title} tabIndex={-1}>
          {thread?.subject ?? card.subject}
        </h2>
        {problem && <p className="read-problem">{problem}</p>}
        {!thread && !problem && <div className="spinner" role="status" aria-label="Loading the conversation" />}
        {thread && (
          <div className="read-messages">
            {thread.messages.map(message => (
              <Message
                key={message.id}
                message={message}
                me={email}
                open={message.id === newest || opened.has(message.id)}
                onOpen={() => setOpened(current => new Set(current).add(message.id))}
                loadImages={loadImages}
              />
            ))}
            {thread.messages.length > 1 && opened.size < thread.messages.length - 1 && (
              <button
                type="button"
                className="text-button expand-all"
                onClick={() => setOpened(new Set(thread.messages.map(message => message.id)))}
              >
                <ChevronDown size={16} aria-hidden="true" /> Show all {thread.messages.length} messages
              </button>
            )}
          </div>
        )}
        {/* TEMPORARY: preview builds only, to find which link shape opens Chrome instead of its in-app tab. */}
        {!appVersion.startsWith('v') && <BrowserLinkTest />}
      </div>
    </dialog>
  );
}
