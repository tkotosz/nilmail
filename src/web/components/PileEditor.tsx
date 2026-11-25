import { ArrowLeft, Trash2 } from 'lucide-react';
import { actionLabels } from '../../core/actions.ts';
import { pileSummary, swipe } from '../../core/pile.ts';
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
        <label className="query-field">
          <span>Gmail search</span>
          <input
            type="text"
            value={pile.filters.search}
            onChange={event => setFilters({ search: event.target.value })}
            placeholder="Optional, such as from:shop.example"
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
          />
        </label>
        <p className="hint">
          Every filter must match. Any Gmail search works, such as <code>category:promotions older_than:30d</code>.
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
