import { useState } from 'react';
import { ArrowLeft, Trash2 } from 'lucide-react';
import { actionLabels } from '../../core/actions.ts';
import { categoryNames, hasMoreFilters, pileSummary, swipe } from '../../core/pile.ts';
import {
  gestureActionIds,
  type ActionId,
  type Direction,
  type GmailLabel,
  type Pile,
  type PileFilters,
  type Swipe,
} from '../../core/types.ts';
import { directionArrows, directionNames } from '../action-ui.ts';
import { LabelPicker } from './LabelPicker.tsx';

const gestureOrder: Direction[] = ['left', 'right', 'up', 'down'];

/** A swipe switched to `action`: label actions start with a sensible label, which the user can change. */
function switchedSwipe(action: ActionId, pile: Pile, known: GmailLabel[], previous: Swipe): Swipe {
  if (action === 'addLabels') return swipe(action, previous.action === 'addLabels' ? previous.labels : [], true);
  if (action === 'removeLabel') {
    const first = pile.filters.hasLabels[0] ?? known[0];
    return swipe(action, first ? [first] : []);
  }
  return swipe(action);
}

function SwipeEditor({
  direction,
  pile,
  known,
  onChange,
}: {
  direction: Direction;
  pile: Pile;
  known: GmailLabel[];
  onChange(swipe: Swipe): void;
}) {
  const current = pile.swipes[direction];
  const name = directionNames[direction];
  // A pile's own labels come first in Remove label, as removing one is how mail leaves the pile.
  const removable = [
    ...pile.filters.hasLabels,
    ...known.filter(label => !pile.filters.hasLabels.some(own => own.id === label.id)),
  ];
  return (
    <div className="gesture-cell">
      <label className="gesture-choice">
        <span>
          <span aria-hidden="true">{directionArrows[direction]}</span> {name}
        </span>
        <select
          value={current.action}
          onChange={event => onChange(switchedSwipe(event.target.value as ActionId, pile, known, current))}
        >
          {gestureActionIds.map(action => (
            <option key={action} value={action}>
              {actionLabels[action].verb}
            </option>
          ))}
        </select>
      </label>
      {current.action === 'addLabels' && (
        <>
          <LabelPicker
            name={`${name} swipe labels`}
            chosen={current.labels}
            known={known}
            allowNew
            onChange={labels => onChange({ ...current, labels })}
          />
          <label className="toggle small">
            <input
              type="checkbox"
              checked={current.archive}
              onChange={event => onChange({ ...current, archive: event.target.checked })}
            />
            <span>Also archive</span>
          </label>
        </>
      )}
      {current.action === 'removeLabel' &&
        (removable.length ? (
          <select
            aria-label={`${name} swipe label to remove`}
            value={current.labels[0]?.id ?? ''}
            onChange={event => {
              const label = removable.find(item => item.id === event.target.value);
              if (label) onChange({ ...current, labels: [label] });
            }}
          >
            {!current.labels.length && <option value="">Choose a label…</option>}
            {removable.map(label => (
              <option key={label.id} value={label.id}>
                {label.name}
              </option>
            ))}
          </select>
        ) : (
          <p className="hint">You have no labels yet.</p>
        ))}
    </div>
  );
}

/** Everything about one pile: its name, the filters that choose its conversations, and its swipes. */
export function PileEditor({
  pile,
  known,
  onChange,
  onBack,
  onDelete,
}: {
  pile: Pile;
  /** The user's labels in Gmail. */
  known: GmailLabel[];
  onChange(pile: Pile): void;
  onBack(): void;
  /** Absent for the last pile: there is always at least one. */
  onDelete?(): void;
}) {
  const setFilters = (filters: Partial<PileFilters>) => onChange({ ...pile, filters: { ...pile.filters, ...filters } });
  // Folded away unless one is set, so the editor stays short on a phone.
  const [moreOpen, setMoreOpen] = useState(() => hasMoreFilters(pile.filters));
  const age = pile.filters.olderThan;
  return (
    <div className="pile-editor">
      <button type="button" className="quiet-button back-button" onClick={onBack}>
        <ArrowLeft size={16} aria-hidden="true" /> All piles
      </button>

      <fieldset>
        <legend>Pile</legend>
        <label className="query-field">
          <span>Name</span>
          <input type="text" value={pile.name} onChange={event => onChange({ ...pile, name: event.target.value })} />
        </label>
      </fieldset>

      <fieldset>
        <legend>Conversations</legend>
        <div className="gesture-grid">
          <label className="gesture-choice">
            <span>Read or unread</span>
            <select value={pile.filters.read} onChange={event => setFilters({ read: event.target.value as PileFilters['read'] })}>
              <option value="unread">Unread</option>
              <option value="read">Read</option>
              <option value="any">Either</option>
            </select>
          </label>
          <label className="gesture-choice">
            <span>Where</span>
            <select
              value={pile.filters.where}
              onChange={event => setFilters({ where: event.target.value as PileFilters['where'] })}
            >
              <option value="inbox">Inbox</option>
              <option value="archived">Archived</option>
              <option value="anywhere">Anywhere</option>
            </select>
          </label>
        </div>
        <div className="filter-field">
          <span>Has labels</span>
          <LabelPicker
            name="Has labels"
            chosen={pile.filters.hasLabels}
            known={known}
            allowNew
            onChange={hasLabels => setFilters({ hasLabels })}
          />
        </div>
        <div className="filter-field">
          <span>Doesn't have labels</span>
          <LabelPicker
            name="Doesn't have labels"
            chosen={pile.filters.lacksLabels}
            known={known}
            allowNew={false}
            onChange={lacksLabels => setFilters({ lacksLabels })}
          />
        </div>
        <details className="more-filters" open={moreOpen} onToggle={event => setMoreOpen(event.currentTarget.open)}>
          <summary>More filters</summary>
          <div className="more-filters-body">
            <label className="gesture-choice">
              <span>Category</span>
              <select
                value={pile.filters.category}
                onChange={event => setFilters({ category: event.target.value as PileFilters['category'] })}
              >
                <option value="">Any</option>
                {Object.entries(categoryNames).map(([value, name]) => (
                  <option key={value} value={value}>
                    {name}
                  </option>
                ))}
              </select>
            </label>
            <div className="gesture-choice">
              <span id="older-than">Older than</span>
              <div className="age-field" role="group" aria-labelledby="older-than">
                <input
                  type="number"
                  inputMode="numeric"
                  min={1}
                  aria-label="Older than, amount"
                  placeholder="Any"
                  value={age?.count ?? ''}
                  onChange={event => {
                    const count = Math.floor(Number(event.target.value));
                    setFilters({ olderThan: count >= 1 ? { count, unit: age?.unit ?? 'd' } : null });
                  }}
                />
                <select
                  aria-label="Older than, unit"
                  value={age?.unit ?? 'd'}
                  disabled={!age}
                  onChange={event => age && setFilters({ olderThan: { ...age, unit: event.target.value as 'd' | 'm' | 'y' } })}
                >
                  <option value="d">days</option>
                  <option value="m">months</option>
                  <option value="y">years</option>
                </select>
              </div>
            </div>
            <label className="query-field">
              <span>From</span>
              <input
                type="text"
                value={pile.filters.from}
                onChange={event => setFilters({ from: event.target.value })}
                placeholder="Address, name or domain"
                spellCheck={false}
                autoCapitalize="off"
                autoCorrect="off"
              />
            </label>
            <label className="toggle small">
              <input
                type="checkbox"
                checked={pile.filters.hasAttachment}
                onChange={event => setFilters({ hasAttachment: event.target.checked })}
              />
              <span>Has an attachment</span>
            </label>
            <label className="toggle small">
              <input
                type="checkbox"
                checked={pile.filters.noLabels}
                onChange={event => setFilters({ noLabels: event.target.checked })}
              />
              <span>Has none of my labels</span>
            </label>
            <p className="hint">
              These make the count Gmail's estimate. Gmail checks labels per message, so a conversation where only one message has
              a label may still count as having none.
            </p>
          </div>
        </details>
        <label className="query-field">
          <span>Gmail search</span>
          <input
            type="text"
            value={pile.filters.search}
            onChange={event => setFilters({ search: event.target.value })}
            placeholder="Optional, such as subject:invoice"
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
          />
        </label>
        <p className="hint">
          Every filter must match. Any Gmail search works, such as <code>subject:invoice</code> or <code>larger:5M</code>.
        </p>
        <p className="pile-summary">{pileSummary(pile.filters)}</p>
      </fieldset>

      <fieldset>
        <legend>Swipes</legend>
        <div className="gesture-grid">
          {gestureOrder.map(direction => (
            <SwipeEditor
              key={direction}
              direction={direction}
              pile={pile}
              known={known}
              onChange={changed => onChange({ ...pile, swipes: { ...pile.swipes, [direction]: changed } })}
            />
          ))}
        </div>
        <p className="hint">
          Add labels can also archive, filing the conversation in another pile; it leaves read or unread as it was. Remove all
          labels removes the labels you made, never Inbox or Starred. Reply and Skip are also in the read view.
        </p>
      </fieldset>

      {onDelete && (
        <button type="button" className="quiet-button danger" onClick={onDelete}>
          <Trash2 size={16} aria-hidden="true" /> Delete this pile
        </button>
      )}
    </div>
  );
}
