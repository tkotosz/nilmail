import { useState } from 'react';
import { Plus, Tag, Trash2 } from 'lucide-react';
import { actionLabels } from '../../core/actions.ts';
import { categoryNames, moreFiltersSummary, pileSummary, swipe } from '../../core/pile.ts';
import {
  gestureActionIds,
  type ActionId,
  type Direction,
  type GmailLabel,
  type Pile,
  type PileFilters,
  type Swipe,
} from '../../core/types.ts';
import { actionUi, directionArrows, directionNames } from '../action-ui.ts';
import { BackLink, CheckRow, FieldRow, Group, NavRow, RadioRow, RowIcon, SelectRow, SwitchRow } from './SettingsRows.tsx';

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
  if (chosen.action === 'addLabels') return `Add ${names(chosen.labels)}${chosen.archive ? ', and archive' : ''}`;
  if (chosen.action === 'removeLabel') return `Remove ${names(chosen.labels)}`;
  return actionLabels[chosen.action].verb;
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
            icon={<ActionIcon action={pile.swipes[direction].action} />}
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

/** A swipe switched to `action`: label actions start with a sensible label, which the user can change. */
function switchedSwipe(action: ActionId, pile: Pile, known: GmailLabel[], previous: Swipe): Swipe {
  if (action === 'addLabels') return swipe(action, previous.action === 'addLabels' ? previous.labels : [], true);
  if (action === 'removeLabel') {
    const first = pile.filters.hasLabels[0] ?? known[0];
    return swipe(action, first ? [first] : []);
  }
  return swipe(action);
}

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
  // A pile's own labels come first in Remove label, as removing one is how mail leaves the pile.
  const removable = withChosen(
    [...pile.filters.hasLabels, ...known.filter(label => !pile.filters.hasLabels.some(own => own.id === label.id))],
    current.action === 'removeLabel' ? current.labels : [],
  );
  return (
    <>
      <BackLink title={pile.name || 'Pile'} onClick={onBack} />
      <Group title={`${directionArrows[direction]} ${directionNames[direction]} swipe`}>
        {gestureActionIds.map(action => (
          <RadioRow
            key={action}
            name={`swipe-${direction}`}
            icon={<ActionIcon action={action} />}
            title={actionLabels[action].verb}
            checked={current.action === action}
            onChange={() => onChange(switchedSwipe(action, pile, known, current))}
          />
        ))}
      </Group>
      {current.action === 'addLabels' && (
        <>
          <Group title="Labels to add">
            <LabelChecklist
              known={known}
              chosen={current.labels}
              makeLabel={makeLabel}
              onChange={labels => onChange({ ...current, labels })}
            />
          </Group>
          <Group>
            <SwitchRow
              title="Also archive"
              value="Files the conversation out of the inbox; read or unread stays as it was."
              checked={current.archive}
              onChange={archive => onChange({ ...current, archive })}
            />
          </Group>
        </>
      )}
      {current.action === 'removeLabel' && (
        <Group title="Label to remove">
          {removable.length ? (
            removable.map(label => (
              <RadioRow
                key={label.id}
                name={`remove-${direction}`}
                icon={
                  <RowIcon>
                    <Tag size={18} />
                  </RowIcon>
                }
                title={label.name}
                checked={current.labels[0]?.id === label.id}
                onChange={() => onChange({ ...current, labels: [label] })}
              />
            ))
          ) : (
            <div className="row">
              <span className="row-value">You have no labels yet.</span>
            </div>
          )}
        </Group>
      )}
      {current.action === 'removeAllLabels' && (
        <p className="group-note">Removes every label you made. Inbox, Starred and the categories stay.</p>
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
