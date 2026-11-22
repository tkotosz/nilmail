import { useState } from 'react';
import { LogOut } from 'lucide-react';
import { actionLabels } from '../../core/actions.ts';
import { defaultQuery, restoreSettings } from '../../core/settings.ts';
import { actionIds, type Direction, type Settings } from '../../core/types.ts';
import { directionArrows, directionNames } from '../action-ui.ts';

const gestureOrder: Direction[] = ['left', 'right', 'up', 'down'];

export function SettingsForm({
  settings,
  email,
  onSave,
  onSignOut,
}: {
  settings: Settings;
  email: string;
  onSave(settings: Settings): void;
  onSignOut(): void;
}) {
  const [draft, setDraft] = useState(settings);
  const change = <Key extends keyof Settings>(key: Key, value: Settings[Key]) =>
    setDraft(current => ({ ...current, [key]: value }));
  return (
    <form
      className="settings-form"
      onSubmit={event => {
        event.preventDefault();
        onSave(restoreSettings(draft));
      }}
    >
      <fieldset>
        <legend>Swipes</legend>
        <div className="gesture-grid">
          {gestureOrder.map(direction => (
            <label key={direction} className="gesture-choice">
              <span>
                <span aria-hidden="true">{directionArrows[direction]}</span> {directionNames[direction]}
              </span>
              <select
                value={draft.gestures[direction]}
                onChange={event =>
                  change('gestures', { ...draft.gestures, [direction]: event.target.value as Settings['gestures'][Direction] })
                }
              >
                {actionIds.map(action => (
                  <option key={action} value={action}>
                    {actionLabels[action].verb}
                  </option>
                ))}
              </select>
            </label>
          ))}
        </div>
        <p className="hint">Actions without a swipe show up as small buttons on the card.</p>
      </fieldset>

      <fieldset>
        <legend>Mail</legend>
        <label className="toggle">
          <input
            type="checkbox"
            checked={draft.archiveMarksRead}
            onChange={event => change('archiveMarksRead', event.target.checked)}
          />
          <span>Archive also marks as read</span>
        </label>
        <label className="toggle">
          <input type="checkbox" checked={draft.loadImages} onChange={event => change('loadImages', event.target.checked)} />
          <span>Load images in emails automatically</span>
        </label>
        <p className="hint">Loading images lets senders see when you open their email.</p>
      </fieldset>

      <fieldset>
        <legend>Deck</legend>
        <label className="query-field">
          <span>Gmail search</span>
          <input
            type="text"
            value={draft.query}
            onChange={event => change('query', event.target.value)}
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
          />
        </label>
        <p className="hint">
          Any Gmail search works, such as <code>in:inbox is:unread category:promotions</code>.{' '}
          {draft.query.trim() !== defaultQuery && (
            <button type="button" className="text-button" onClick={() => change('query', defaultQuery)}>
              Back to unread inbox
            </button>
          )}
        </p>
      </fieldset>

      <div className="modal-actions">
        <button type="submit" className="button primary">
          Save
        </button>
      </div>

      <div className="account">
        <span>
          Signed in as <strong>{email}</strong>
        </span>
        <button type="button" className="quiet-button" onClick={onSignOut}>
          <LogOut size={16} aria-hidden="true" /> Sign out
        </button>
        <a href="/privacy" target="_blank" rel="noopener">
          Privacy policy
        </a>
      </div>
    </form>
  );
}
