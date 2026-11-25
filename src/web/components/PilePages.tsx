import { useState } from 'react';
import { Plus, Tag, Trash2, X } from 'lucide-react';
import { actionLabels, coversSender, mainAction } from '../../core/actions.ts';
import { categoryNames, moreFiltersSummary, pileSummary } from '../../core/pile.ts';
import {
  standaloneActionIds,
  type Action,
  type ActionId,
  type Direction,
  type GmailLabel,
  type Pile,
  type PileFilters,
  type Swipe,
} from '../../core/types.ts';
import { actionUi, directionArrows, directionNames } from '../action-ui.ts';
import { BackLink, CheckRow, FieldRow, Group, NavRow, RowIcon, SelectRow, SwitchRow } from './SettingsRows.tsx';

/** Finds the label of that name (ignoring case, as Gmail does), creating it in Gmail when there is none. */
export type LabelMaker = (name: string) => Promise<GmailLabel>;

/** The pages inside Settings below the list of piles. */
export type PilePage =
  | { name: 'pile' }
  | { name: 'labels'; which: 'hasLabels' | 'lacksLabels' }
  | { name: 'more' }
  | { name: 'swipe'; direction: Direction };

export const gestureOrder: Direction[] = ['left', 'right', 'up', 'down'];

const names = (labels: GmailLabel[]) => labels.map(label => label.name).join(', ') || 'None';

/** What a swipe does, in words, such as "Delete" or "Add labels: Later, and archive". */
export function swipeText(chosen: Swipe): string {
  const parts = chosen.actions.map(action => {
    if (action.id === 'addLabel' && action.label) return `add ${action.label.name}`;
    if (action.id === 'removeLabel' && action.label) return `remove ${action.label.name}`;
    return actionLabels[action.id].verb.toLowerCase();
  });
  if (chosen.allFromSender && coversSender(chosen)) parts.push('all from the sender');
  const text = parts.join(', ');
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : 'Nothing yet';
}

function ActionIcon({ action }: { action: ActionId }) {
  const { Icon, tone } = actionUi[action];
  return (
    <RowIcon tone={tone}>
      <Icon size={20} />
    </RowIcon>
  );
}

/** Labels the pile or swipe has chosen that Gmail's list lacks, such as one named but not created yet, come first. */
const withChosen = (known: GmailLabel[], chosen: GmailLabel[]) => [
  ...chosen.filter(label => !known.some(item => item.id === label.id)),
  ...known,
];

/** A row to name a new label, created in Gmail at once; an existing label of that name is used instead. */
function NewLabelRow({ makeLabel, onAdd }: { makeLabel: LabelMaker; onAdd(label: GmailLabel): void }) {
  const [name, setName] = useState('');
  const [adding, setAdding] = useState(false);
  const add = () => {
    const trimmed = name.trim();
    if (!trimmed || adding) return;
    setAdding(true);
    makeLabel(trimmed).then(
      label => {
        onAdd(label);
        setName('');
        setAdding(false);
      },
      () => setAdding(false),
    );
  };
  return (
    <div className="row new-label-row">
      <input
        type="text"
        aria-label="New label"
        placeholder="New label, such as Later"
        value={name}
        onChange={event => setName(event.target.value)}
        onKeyDown={event => {
          if (event.key !== 'Enter') return;
          event.preventDefault();
          add();
        }}
      />
      <button type="button" className="button text" onClick={add} disabled={!name.trim() || adding}>
        <Plus size={18} aria-hidden="true" /> {adding ? 'Adding…' : 'Add'}
      </button>
    </div>
  );
}

/** Checkboxes for every label, and a row to name a new one. */
function LabelChecklist({
  known,
  chosen,
  makeLabel,
  onChange,
}: {
  known: GmailLabel[];
  chosen: GmailLabel[];
  /** Given when new labels may be named here. */
  makeLabel?: LabelMaker;
  onChange(labels: GmailLabel[]): void;
}) {
  const all = withChosen(known, chosen);
  return (
    <>
      {all.map(label => (
        <CheckRow
          key={label.id}
          icon={
            <RowIcon>
              <Tag size={18} />
            </RowIcon>
          }
          title={label.name}
          checked={chosen.some(item => item.id === label.id)}
          onChange={checked => onChange(checked ? [...chosen, label] : chosen.filter(item => item.id !== label.id))}
        />
      ))}
      {makeLabel && (
        <NewLabelRow
          makeLabel={makeLabel}
          onAdd={label => onChange(chosen.some(item => item.id === label.id) ? chosen : [...chosen, label])}
        />
      )}
      {!all.length && !makeLabel && (
        <div className="row">
          <span className="row-value">You have no labels yet.</span>
        </div>
      )}
    </>
  );
}

/** A pile: its name, which conversations it holds, and its swipes. Rows open the pages below it. */
function PileMain({
  pile,
  setFilters,
  onChange,
  onOpen,
  onBack,
  onDelete,
}: {
  pile: Pile;
  setFilters(filters: Partial<PileFilters>): void;
  onChange(pile: Pile): void;
  onOpen(page: PilePage): void;
  onBack(): void;
  onDelete?(): void;
}) {
  const { filters } = pile;
  const more = moreFiltersSummary(filters) || 'Category, age, sender, attachment';
  return (
    <>
      <BackLink title="All piles" onClick={onBack} />
      <Group>
        <FieldRow label="Name">
          <input type="text" value={pile.name} onChange={event => onChange({ ...pile, name: event.target.value })} />
        </FieldRow>
      </Group>
      <Group title="Conversations">
        <SelectRow
          title="Read or unread"
          value={filters.read}
          options={[
            ['unread', 'Unread'],
            ['read', 'Read'],
            ['any', 'Either'],
          ]}
          onChange={read => setFilters({ read })}
        />
        <SelectRow
          title="Where"
          value={filters.where}
          options={[
            ['inbox', 'Inbox'],
            ['archived', 'Archived'],
            ['anywhere', 'Anywhere'],
          ]}
          onChange={where => setFilters({ where })}
        />
        <NavRow
          title="Has labels"
          value={names(filters.hasLabels)}
          onClick={() => onOpen({ name: 'labels', which: 'hasLabels' })}
        />
        <NavRow
          title="Doesn't have labels"
          value={names(filters.lacksLabels)}
          onClick={() => onOpen({ name: 'labels', which: 'lacksLabels' })}
        />
        <NavRow title="More filters" value={more} onClick={() => onOpen({ name: 'more' })} />
        <FieldRow label="Gmail search">
          <input
            type="text"
            value={filters.search}
            onChange={event => setFilters({ search: event.target.value })}
            placeholder="Optional, such as subject:invoice"
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
          />
        </FieldRow>
      </Group>
      <p className="group-note">{pileSummary(filters)}</p>
      <Group title="Swipes">
        {gestureOrder.map(direction => (
          <NavRow
            key={direction}
            icon={<ActionIcon action={mainAction(pile.swipes[direction])} />}
            title={`${directionArrows[direction]} ${directionNames[direction]} swipe`}
            label={`${directionNames[direction]} swipe: ${swipeText(pile.swipes[direction])}`}
            value={swipeText(pile.swipes[direction])}
            onClick={() => onOpen({ name: 'swipe', direction })}
          />
        ))}
      </Group>
      {onDelete && (
        <Group className="danger-group">
          <button type="button" className="row danger-row" onClick={onDelete}>
            <Trash2 size={20} aria-hidden="true" /> Delete this pile
          </button>
        </Group>
      )}
    </>
  );
}

/** Whether two actions are the same: the same kind, and for label actions the same label. */
const sameAction = (a: Action, b: Action) => a.id === b.id && a.label?.id === b.label?.id;

/** The simple actions the "Add an action" menu offers, with the ones that only work alone marked so. */
const simpleActions: ActionId[] = ['markRead', 'archive', 'delete', 'removeAllLabels', 'read', 'reply', 'skip'];

/**
 * A swipe's actions, each removable, and "Add an action": one menu of every action, with Add label and Remove label for
 * each label. Read, Reply and Skip replace the list; anything added to them replaces them.
 */
function SwipePage({
  pile,
  direction,
  known,
  makeLabel,
  onChange,
  onBack,
}: {
  pile: Pile;
  direction: Direction;
  known: GmailLabel[];
  makeLabel: LabelMaker;
  onChange(swipe: Swipe): void;
  onBack(): void;
}) {
  const current = pile.swipes[direction];
  const [naming, setNaming] = useState(false);
  const has = (action: Action) => current.actions.some(item => sameAction(item, action));
  const set = (actions: Action[]) => {
    const next = { ...current, actions };
    onChange({ ...next, allFromSender: next.allFromSender && coversSender(next) });
  };
  const add = (action: Action) => {
    if (has(action)) return;
    const alone = standaloneActionIds.includes(action.id);
    set(alone ? [action] : [...current.actions.filter(item => !standaloneActionIds.includes(item.id)), action]);
  };
  // A pile's own labels come first in Remove label, as removing one is how mail leaves the pile.
  const removable = withChosen(
    [...pile.filters.hasLabels, ...known.filter(label => !pile.filters.hasLabels.some(own => own.id === label.id))],
    [],
  );
  const choose = (value: string) => {
    if (value === 'new-label') return setNaming(true);
    const [kind, id] = value.split(':') as [string, string | undefined];
    if (kind === 'add') {
      const label = known.find(item => item.id === id);
      if (label) add({ id: 'addLabel', label });
    } else if (kind === 'remove') {
      const label = removable.find(item => item.id === id);
      if (label) add({ id: 'removeLabel', label });
    } else {
      add({ id: kind as ActionId });
    }
  };
  return (
    <>
      <BackLink title={pile.name || 'Pile'} onClick={onBack} />
      <Group title={`${directionArrows[direction]} ${directionNames[direction]} swipe does`}>
        {current.actions.map((action, index) => (
          <div key={`${action.id}:${action.label?.id ?? ''}`} className="row">
            <ActionIcon action={action.id} />
            <span className="row-text">
              <span className="row-title">{actionLabels[action.id].verb}</span>
              {action.label && <span className="row-value">{action.label.name}</span>}
            </span>
            <button
              type="button"
              className="icon-button small"
              aria-label={`Remove ${actionLabels[action.id].verb}${action.label ? ` ${action.label.name}` : ''}`}
              onClick={() => set(current.actions.filter((_, at) => at !== index))}
            >
              <X size={20} />
            </button>
          </div>
        ))}
        <label className="row add-row">
          <RowIcon>
            <Plus size={20} />
          </RowIcon>
          <span className="row-title">Add an action</span>
          <select className="row-select" aria-label="Add an action" value="" onChange={event => choose(event.target.value)}>
            <option value="" disabled>
              Add an action
            </option>
            {simpleActions
              .filter(id => !has({ id }))
              .map(id => (
                <option key={id} value={id}>
                  {actionLabels[id].verb}
                  {standaloneActionIds.includes(id) ? ' (on its own)' : ''}
                </option>
              ))}
            <optgroup label="Add label">
              {known
                .filter(label => !has({ id: 'addLabel', label }))
                .map(label => (
                  <option key={label.id} value={`add:${label.id}`}>
                    Add {label.name}
                  </option>
                ))}
              <option value="new-label">New label…</option>
            </optgroup>
            {removable.length > 0 && (
              <optgroup label="Remove label">
                {removable
                  .filter(label => !has({ id: 'removeLabel', label }))
                  .map(label => (
                    <option key={label.id} value={`remove:${label.id}`}>
                      Remove {label.name}
                    </option>
                  ))}
              </optgroup>
            )}
          </select>
        </label>
        {naming && (
          <NewLabelRow
            makeLabel={makeLabel}
            onAdd={label => {
              add({ id: 'addLabel', label });
              setNaming(false);
            }}
          />
        )}
      </Group>
      <p className="group-note">
        All of them happen with one swipe, and one undo reverses them. Read, Reply and Skip work only on their own.
      </p>
      {current.actions.length > 0 && coversSender(current) && (
        <Group>
          <SwitchRow
            title="All from this sender"
            value="Also sorts the sender's other conversations in this pile, up to 100, with one undo."
            checked={current.allFromSender}
            onChange={allFromSender => onChange({ ...current, allFromSender })}
          />
        </Group>
      )}
    </>
  );
}

function MoreFiltersPage({
  pile,
  setFilters,
  onBack,
}: {
  pile: Pile;
  setFilters(filters: Partial<PileFilters>): void;
  onBack(): void;
}) {
  const { filters } = pile;
  const age = filters.olderThan;
  return (
    <>
      <BackLink title={pile.name || 'Pile'} onClick={onBack} />
      <Group title="More filters">
        <SelectRow
          title="Category"
          value={filters.category}
          options={[['', 'Any'], ...Object.entries(categoryNames)] as [PileFilters['category'], string][]}
          onChange={category => setFilters({ category })}
        />
        <FieldRow label="Older than">
          <span className="age-field">
            <input
              type="number"
              inputMode="numeric"
              min={1}
              aria-label="Older than, amount"
              placeholder="Any age"
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
          </span>
        </FieldRow>
        <FieldRow label="From">
          <input
            type="text"
            value={filters.from}
            onChange={event => setFilters({ from: event.target.value })}
            placeholder="Address, name or domain"
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
          />
        </FieldRow>
        <SwitchRow
          title="Has an attachment"
          checked={filters.hasAttachment}
          onChange={hasAttachment => setFilters({ hasAttachment })}
        />
        <SwitchRow title="Has none of my labels" checked={filters.noLabels} onChange={noLabels => setFilters({ noLabels })} />
      </Group>
      <p className="group-note">
        These make the count Gmail's estimate. Gmail checks labels per message, so a conversation where only one message has a
        label may still count as having none.
      </p>
    </>
  );
}

/** One pile in Settings, on the page `page`. */
export function PileEditor({
  pile,
  page,
  known,
  makeLabel,
  onChange,
  onOpen,
  onBack,
  onDelete,
}: {
  pile: Pile;
  page: PilePage;
  /** The user's labels in Gmail. */
  known: GmailLabel[];
  makeLabel: LabelMaker;
  onChange(pile: Pile): void;
  /** Opens a page of this pile; `pile` is the pile's own page. */
  onOpen(page: PilePage): void;
  /** Back to the list of piles. */
  onBack(): void;
  /** Absent for the last pile: there is always at least one. */
  onDelete?(): void;
}) {
  const setFilters = (filters: Partial<PileFilters>) => onChange({ ...pile, filters: { ...pile.filters, ...filters } });
  const toPile = () => onOpen({ name: 'pile' });
  switch (page.name) {
    case 'pile':
      return (
        <PileMain pile={pile} setFilters={setFilters} onChange={onChange} onOpen={onOpen} onBack={onBack} onDelete={onDelete} />
      );
    case 'labels':
      return (
        <>
          <BackLink title={pile.name || 'Pile'} onClick={toPile} />
          <Group title={page.which === 'hasLabels' ? 'Has labels' : "Doesn't have labels"}>
            <LabelChecklist
              known={known}
              chosen={pile.filters[page.which]}
              makeLabel={page.which === 'hasLabels' ? makeLabel : undefined}
              onChange={labels => setFilters({ [page.which]: labels })}
            />
          </Group>
          <p className="group-note">
            {page.which === 'hasLabels'
              ? 'The pile holds conversations with every label checked.'
              : 'The pile leaves out conversations with any label checked.'}
          </p>
        </>
      );
    case 'more':
      return <MoreFiltersPage pile={pile} setFilters={setFilters} onBack={toPile} />;
    case 'swipe':
      return (
        <SwipePage
          pile={pile}
          direction={page.direction}
          known={known}
          makeLabel={makeLabel}
          onChange={changed => onChange({ ...pile, swipes: { ...pile.swipes, [page.direction]: changed } })}
          onBack={toPile}
        />
      );
  }
}
