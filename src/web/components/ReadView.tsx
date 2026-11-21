import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ChevronDown, Paperclip } from 'lucide-react';
import { actionLabels } from '../../core/actions.ts';
import { threadView } from '../../core/message.ts';
import type { ActionId, MailCard, MessageView, ThreadView } from '../../core/types.ts';
import { actionUi } from '../action-ui.ts';
import { fileSize, fullDateTime, shortDate } from '../format.ts';
import type { WebGmail } from '../gmail-http.ts';
import { problemText } from '../gmail-http.ts';
import { Avatar } from './MailCardView.tsx';
import { MessageBody } from './MessageBody.tsx';

/** The actions the read view offers: reading again or marking read makes no sense here. */
const readViewActions: ActionId[] = ['archive', 'delete', 'reply', 'skip'];

function Message({
  message,
  open,
  onOpen,
  loadImages,
}: {
  message: MessageView;
  open: boolean;
  onOpen(): void;
  loadImages: boolean;
}) {
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
  return (
    <section className="message">
      <header className="message-header">
        <Avatar name={message.from.name} address={message.from.address} />
        <div className="message-people">
          <strong>{message.from.name}</strong>
          <span>{message.from.address}</span>
          {message.to && <span>To: {message.to}</span>}
          {message.cc && <span>Cc: {message.cc}</span>}
        </div>
        <time>{fullDateTime(message.date)}</time>
      </header>
      <MessageBody html={message.html} text={message.text} loadImages={loadImages} />
      {message.attachments.length > 0 && (
        <ul className="attachments" aria-label="Attachments">
          {message.attachments.map((attachment, index) => (
            <li key={index}>
              <Paperclip size={14} aria-hidden="true" /> {attachment.filename} <span>{fileSize(attachment.size)}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** The whole conversation, full screen, with the actions along the bottom. */
export function ReadView({
  card,
  gmail,
  loadImages,
  onAction,
  onClose,
}: {
  card: MailCard;
  gmail: WebGmail;
  loadImages: boolean;
  onAction(action: ActionId): void;
  onClose(): void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [thread, setThread] = useState<ThreadView | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [opened, setOpened] = useState<Set<string>>(new Set());

  useEffect(() => {
    dialog.current?.showModal();
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
    <dialog ref={dialog} className="read-view" aria-labelledby="read-subject" onCancel={onClose}>
      <header className="read-header">
        <button type="button" className="icon-button" onClick={onClose} aria-label="Back to the deck">
          <ArrowLeft size={22} />
        </button>
        <h2 id="read-subject">{thread?.subject ?? card.subject}</h2>
      </header>
      <div className="read-body">
        {problem && <p className="read-problem">{problem}</p>}
        {!thread && !problem && <div className="spinner" role="status" aria-label="Loading the conversation" />}
        {thread?.messages.map(message => (
          <Message
            key={message.id}
            message={message}
            open={message.id === newest || opened.has(message.id)}
            onOpen={() => setOpened(current => new Set(current).add(message.id))}
            loadImages={loadImages}
          />
        ))}
        {thread && thread.messages.length > 1 && opened.size < thread.messages.length - 1 && (
          <button
            type="button"
            className="text-button expand-all"
            onClick={() => setOpened(new Set(thread.messages.map(message => message.id)))}
          >
            <ChevronDown size={16} aria-hidden="true" /> Show all {thread.messages.length} messages
          </button>
        )}
      </div>
      <footer className="read-actions">
        {readViewActions.map(action => {
          const { Icon, tone } = actionUi[action];
          return (
            <button key={action} type="button" className={`action-button tone-${tone}`} onClick={() => onAction(action)}>
              <Icon size={20} aria-hidden="true" />
              <span>{actionLabels[action].verb}</span>
            </button>
          );
        })}
      </footer>
    </dialog>
  );
}
