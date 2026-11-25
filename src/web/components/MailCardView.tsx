import { Paperclip } from 'lucide-react';
import { isUnread } from '../../core/actions.ts';
import type { MailCard } from '../../core/types.ts';
import { senderHue, shortDate } from '../format.ts';

export function Avatar({ name, address }: { name: string; address: string }) {
  const initial = (name.match(/\p{L}|\p{N}/u)?.[0] ?? '?').toUpperCase();
  return (
    <span className="avatar" aria-hidden="true" style={{ background: `hsl(${senderHue(address)} 55% 46%)` }}>
      {initial}
    </span>
  );
}

export function MailCardView({ card }: { card: MailCard }) {
  return (
    <article className="mail-card" aria-label={`${card.from.name}: ${card.subject}`}>
      <header className="mail-card-sender">
        <Avatar name={card.from.name} address={card.from.address} />
        <div className="sender-text">
          <strong>{card.from.name}</strong>
          {card.from.address !== card.from.name && <span>{card.from.address}</span>}
        </div>
        <time dateTime={new Date(card.date).toISOString()}>{shortDate(card.date)}</time>
      </header>
      <h2 className="mail-card-subject">{card.subject}</h2>
      <p className="mail-card-snippet">{card.snippet || 'No preview text.'}</p>
      <footer className="mail-card-footer">
        <div className="mail-card-facts">
          {!isUnread(card) && <span className="fact">Read</span>}
          {card.messageCount > 1 && <span className="fact">{card.messageCount} messages</span>}
          {card.hasAttachment && (
            <span className="fact">
              <Paperclip size={14} aria-hidden="true" /> Attachment
            </span>
          )}
        </div>
      </footer>
    </article>
  );
}
