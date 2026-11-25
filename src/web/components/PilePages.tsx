import { useState } from 'react';
import { ChevronRight, Plus, Tag, Trash2, X } from 'lucide-react';
import { actionLabels, actionVerb, coversSender, mainAction } from '../../core/actions.ts';
import { categoryNames, moreFiltersSummary, pileSummary } from '../../core/pile.ts';
import { swipeNameLimit } from '../../core/settings.ts';
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
import { CheckRow, FieldRow, Group, NavRow, RowIcon, SelectRow, SwitchRow } from './SettingsRows.tsx';

/** Finds the label of that name (ignoring case, as Gmail does), creating it in Gmail when there is none. */
export type LabelMaker = (name: string) => Promise<GmailLabel>;

/** The pages inside Settings below the list of piles. */
export type PilePage =
  | { name: 'pile' }
  | { name: 'labels'; which: 'hasLabels' | 'lacksLabels' }
  | { name: 'more' }
  | { name: 'swipe'; direction: Direction }
  | { name: 'addAction'; direction: Direction }
  | { name: 'pickLabel'; direction: Direction; action: 'addLabel' | 'removeLabel' };

export const gestureOrder: Direction[] = ['left', 'right', 'up', 'down'];

/** The header's title on a page of a pile, such as "→ Right swipe" or "Add label". */
export function pageTitle(pile: Pile, page: PilePage): string {
  switch (page.name) {
    case 'pile':
      return pile.name || 'Pile';
    case 'labels':
      return page.which === 'hasLabels' ? 'Has labels' : "Doesn't have labels";
    case 'more':
      return 'More filters';
    case 'swipe':
      return `${directionArrows[page.direction]} ${directionNames[page.direction]} swipe`;
    case 'addAction':
      return 'Add an action';
    case 'pickLabel':
      return actionLabels[page.action].verb;
  }
}

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
  const actions = text ? text.charAt(0).toUpperCase() + text.slice(1) : 'Nothing yet';
  return chosen.name.trim() ? `${chosen.name.trim()} · ${actions}` : actions;
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
  onDelete,
}: {
  pile: Pile;
  setFilters(filters: Partial<PileFilters>): void;
  onChange(pile: Pile): void;
  onOpen(page: PilePage): void;
  onDelete?(): void;
}) {
  const { filters } = pile;
  const more = moreFiltersSummary(filters) || 'Category, age, sender, attachment';
  return (
    <>
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

/** Adds `action` to a swipe: Read, Reply and Skip replace its list, and anything added to them replaces them. */
function withAction(current: Swipe, action: Action): Swipe {
  if (current.actions.some(item => sameAction(item, action))) return current;
  const alone = standaloneActionIds.includes(action.id);
  const actions = alone ? [action] : [...current.actions.filter(item => !standaloneActionIds.includes(item.id)), action];
  const next = { ...current, actions };
  return { ...next, allFromSender: next.allFromSender && coversSender(next) };
}

/** A swipe's actions, each removable, and "Add an action", which opens a page of its own. */
function SwipePage({
  pile,
  direction,
  onChange,
  onOpen,
}: {
  pile: Pile;
  direction: Direction;
  onChange(swipe: Swipe): void;
  onOpen(page: PilePage): void;
}) {
  const current = pile.swipes[direction];
  const remove = (index: number) => {
    const next = { ...current, actions: current.actions.filter((_, at) => at !== index) };
    onChange({ ...next, allFromSender: next.allFromSender && coversSender(next) });
  };
  return (
    <>
      <Group>
        <FieldRow label="Name">
          <input
            type="text"
            value={current.name}
            maxLength={swipeNameLimit}
            placeholder={`Optional, such as ${actionVerb({ ...current, name: '' })}`}
            onChange={event => onChange({ ...current, name: event.target.value })}
          />
        </FieldRow>
      </Group>
      <p className="group-note">
        The name shows on the swipe's button and while you swipe; without one, the button names the actions.
      </p>
      <Group title="Does">
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
              onClick={() => remove(index)}
            >
              <X size={20} />
            </button>
          </div>
        ))}
        <button type="button" className="row add-row" onClick={() => onOpen({ name: 'addAction', direction })}>
          <RowIcon>
            <Plus size={20} />
          </RowIcon>
          <span className="row-title">Add an action</span>
        </button>
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

/** One action to pick: its icon and name; dimmed when the swipe already has it, with an arrow when a label comes next. */
function ActionChoice({
  action,
  note,
  done,
  next,
  onClick,
}: {
  action: ActionId;
  note?: string;
  done?: boolean;
  next?: boolean;
  onClick(): void;
}) {
  return (
    <button type="button" className="row" disabled={done} onClick={onClick}>
      <ActionIcon action={action} />
      <span className="row-text">
        <span className="row-title">{actionLabels[action].verb}</span>
        {(done || note) && <span className="row-value">{done ? 'Already in this swipe' : note}</span>}
      </span>
      {next && <ChevronRight size={20} aria-hidden="true" className="row-trailing" />}
    </button>
  );
}

/** Every action a swipe can add, in the app's rows; Add label and Remove label go on to choose the label. */
function AddActionPage({
  pile,
  direction,
  onChange,
  onOpen,
  onBack,
}: {
  pile: Pile;
  direction: Direction;
  onChange(swipe: Swipe): void;
  onOpen(page: PilePage): void;
  /** Back to the swipe's page. */
  onBack(): void;
}) {
  const current = pile.swipes[direction];
  const back = onBack;
  const add = (id: ActionId) => {
    onChange(withAction(current, { id }));
    back();
  };
  const has = (id: ActionId) => current.actions.some(action => action.id === id);
  return (
    <>
      <Group>
        {(['markRead', 'archive', 'delete'] as const).map(id => (
          <ActionChoice key={id} action={id} done={has(id)} onClick={() => add(id)} />
        ))}
        <ActionChoice action="addLabel" next onClick={() => onOpen({ name: 'pickLabel', direction, action: 'addLabel' })} />
        <ActionChoice action="removeLabel" next onClick={() => onOpen({ name: 'pickLabel', direction, action: 'removeLabel' })} />
        <ActionChoice action="removeAllLabels" done={has('removeAllLabels')} onClick={() => add('removeAllLabels')} />
      </Group>
      <Group title="On their own">
        {(['read', 'reply', 'skip'] as const).map(id => (
          <ActionChoice key={id} action={id} done={has(id)} note="Replaces the other actions" onClick={() => add(id)} />
        ))}
      </Group>
    </>
  );
}

/** The labels for an Add label or Remove label action; Add label can also name a new one, created in Gmail at once. */
function LabelPickPage({
  pile,
  direction,
  action,
  known,
  makeLabel,
  onChange,
  onBack,
}: {
  pile: Pile;
  direction: Direction;
  action: 'addLabel' | 'removeLabel';
  known: GmailLabel[];
  makeLabel: LabelMaker;
  onChange(swipe: Swipe): void;
  /** Back `levels` pages: one to Add an action, two to the swipe's page. */
  onBack(levels: number): void;
}) {
  const current = pile.swipes[direction];
  const pick = (label: GmailLabel) => {
    onChange(withAction(current, { id: action, label }));
    onBack(2);
  };
  // A pile's own labels come first in Remove label, as removing one is how mail leaves the pile.
  const labels =
    action === 'removeLabel'
      ? [...pile.filters.hasLabels, ...known.filter(label => !pile.filters.hasLabels.some(own => own.id === label.id))]
      : known;
  return (
    <>
      <Group>
        {labels.map(label => {
          const done = current.actions.some(item => sameAction(item, { id: action, label }));
          return (
            <button key={label.id} type="button" className="row" disabled={done} onClick={() => pick(label)}>
              <RowIcon>
                <Tag size={18} />
              </RowIcon>
              <span className="row-text">
                <span className="row-title">{label.name}</span>
                {done && <span className="row-value">Already in this swipe</span>}
              </span>
            </button>
          );
        })}
        {action === 'addLabel' && <NewLabelRow makeLabel={makeLabel} onAdd={pick} />}
        {!labels.length && action === 'removeLabel' && (
          <div className="row">
            <span className="row-value">You have no labels yet.</span>
          </div>
        )}
      </Group>
      <p className="group-note">Pick one. To add several labels, add another Add label.</p>
    </>
  );
}

function MoreFiltersPage({ pile, setFilters }: { pile: Pile; setFilters(filters: Partial<PileFilters>): void }) {
  const { filters } = pile;
  const age = filters.olderThan;
  return (
    <>
      <Group>
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
  /** Opens a page of this pile, one level deeper; `pile` is the pile's own page. */
  onOpen(page: PilePage): void;
  /** Back `levels` pages, as the phone's Back does: from the pile's own page, one level is the list of piles. */
  onBack(levels?: number): void;
  /** Absent for the last pile: there is always at least one. */
  onDelete?(): void;
}) {
  const setFilters = (filters: Partial<PileFilters>) => onChange({ ...pile, filters: { ...pile.filters, ...filters } });
  const backOne = () => onBack(1);
  const setSwipe = (direction: Direction) => (changed: Swipe) =>
    onChange({ ...pile, swipes: { ...pile.swipes, [direction]: changed } });
  switch (page.name) {
    case 'pile':
      return <PileMain pile={pile} setFilters={setFilters} onChange={onChange} onOpen={onOpen} onDelete={onDelete} />;
    case 'labels':
      return (
        <>
          <Group>
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
      return <MoreFiltersPage pile={pile} setFilters={setFilters} />;
    case 'swipe':
      return <SwipePage pile={pile} direction={page.direction} onChange={setSwipe(page.direction)} onOpen={onOpen} />;
    case 'addAction':
      return (
        <AddActionPage
          pile={pile}
          direction={page.direction}
          onChange={setSwipe(page.direction)}
          onOpen={onOpen}
          onBack={backOne}
        />
      );
    case 'pickLabel':
      return (
        <LabelPickPage
          pile={pile}
          direction={page.direction}
          action={page.action}
          known={known}
          makeLabel={makeLabel}
          onChange={setSwipe(page.direction)}
          onBack={onBack}
        />
      );
  }
}
