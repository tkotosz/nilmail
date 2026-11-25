import { useEffect, useState } from 'react';
import { LogOut } from 'lucide-react';
import { actionLabels } from '../../core/actions.ts';
import { deckActionIds, defaultQuery, restoreSettings } from '../../core/settings.ts';
import { deckKinds, type DeckKind, type Direction, type GmailLabel, type Settings, type Swipes } from '../../core/types.ts';
import { directionArrows, directionNames } from '../action-ui.ts';
import { problemText, type WebGmail } from '../gmail-http.ts';

const gestureOrder: Direction[] = ['left', 'right', 'up', 'down'];

/** The label picker's choice that makes a new label. */
const newLabel = 'new';

const deckNames: Record<DeckKind, string> = { unread: 'Unread', read: 'Read' };

/** Something per deck and direction, such as the label picker's choice. */
type PerSwipe<Value> = Record<DeckKind, Partial<Record<Direction, Value>>>;

/**
 * The label for each label swipe of one deck: the chosen one, with its current name, or one named in the form. A name
 * that matches an existing label (ignoring case, as Gmail does) uses it; any other is created in Gmail. Names are checked
 * before.
 */
async function resolveLabels(
  draft: Swipes,
  choices: Partial<Record<Direction, string>>,
  names: Partial<Record<Direction, string>>,
  known: GmailLabel[],
  createLabel: (name: string) => Promise<GmailLabel>,
): Promise<Swipes['labels']> {
  const labels: Swipes['labels'] = {};
  for (const direction of gestureOrder) {
    if (draft.gestures[direction] !== 'label') continue;
    const choice = choices[direction];
    if (choice && choice !== newLabel) {
      labels[direction] = known.find(label => label.id === choice) ?? draft.labels[direction];
      continue;
    }
    const name = names[direction]?.trim() ?? '';
    let label = known.find(item => item.name.toLowerCase() === name.toLowerCase());
    if (!label) {
      label = await createLabel(name);
      known.push(label);
    }
    labels[direction] = label;
  }
  return labels;
}

export function SettingsForm({
  settings,
  deckKind,
  email,
  gmail,
  onSave,
  onSignOut,
}: {
  settings: Settings;
  /** The deck showing; its swipes are shown first. */
  deckKind: DeckKind;
  email: string;
  gmail: WebGmail;
  onSave(settings: Settings): void;
  onSignOut(): void;
}) {
  const [draft, setDraft] = useState(settings);
  /** Whose swipes the form shows. */
  const [kind, setKind] = useState(deckKind);
  /** The user's labels, or null while they load. */
  const [labels, setLabels] = useState<GmailLabel[] | null>(null);
  /** Per label swipe: a label id, or `newLabel`. */
  const [labelChoices, setLabelChoices] = useState<PerSwipe<string>>(() => ({
    unread: Object.fromEntries(gestureOrder.map(direction => [direction, settings.swipes.unread.labels[direction]?.id])),
    read: Object.fromEntries(gestureOrder.map(direction => [direction, settings.swipes.read.labels[direction]?.id])),
  }));
  const [newNames, setNewNames] = useState<PerSwipe<string>>({ unread: {}, read: {} });
  const [problem, setProblem] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let current = true;
    gmail.userLabels().then(
      found => current && setLabels(found),
      () => {
        if (!current) return;
        setLabels([]);
        setProblem('Your Gmail labels could not be loaded. You can still name a new one.');
      },
    );
    return () => {
      current = false;
    };
  }, [gmail]);

  const change = <Key extends keyof Settings>(key: Key, value: Settings[Key]) =>
    setDraft(current => ({ ...current, [key]: value }));

  const swipes = draft.swipes[kind];
  const choices = labelChoices[kind];
  const names = newNames[kind];
  const setChoice = (direction: Direction, value: string) =>
    setLabelChoices(current => ({ ...current, [kind]: { ...current[kind], [direction]: value } }));
  const setName = (direction: Direction, value: string) =>
    setNewNames(current => ({ ...current, [kind]: { ...current[kind], [direction]: value } }));

  /** The labels a picker offers: the user's, and a saved one Gmail no longer lists, so the choice still shows. */
  const labelOptions = (direction: Direction) => {
    const saved = settings.swipes[kind].labels[direction];
    const known = labels ?? [];
    return saved && !known.some(label => label.id === saved.id) ? [saved, ...known] : known;
  };

  async function save() {
    for (const deck of deckKinds) {
      const unnamed = gestureOrder.find(
        direction =>
          draft.swipes[deck].gestures[direction] === 'label' &&
          (labelChoices[deck][direction] ?? newLabel) === newLabel &&
          !newNames[deck][direction]?.trim(),
      );
      if (!unnamed) continue;
      setKind(deck);
      return setProblem(`Name the label for the ${directionNames[unnamed].toLowerCase()} swipe of the ${deck} deck.`);
    }
    setSaving(true);
    setProblem(null);
    try {
      const known = [...(labels ?? [])];
      const createLabel = (name: string) => gmail.createLabel(name);
      const swipes = { ...draft.swipes };
      // One deck after the other, so a new label both decks name is created once.
      for (const deck of deckKinds) {
        const chosen = await resolveLabels(draft.swipes[deck], labelChoices[deck], newNames[deck], known, createLabel);
        swipes[deck] = { ...draft.swipes[deck], labels: chosen };
      }
      onSave(restoreSettings({ ...draft, swipes }));
    } catch (error) {
      setProblem(`The label could not be saved. ${problemText(error)}`);
      setSaving(false);
    }
  }

  return (
    <form
      className="settings-form"
      onSubmit={event => {
        event.preventDefault();
        void save();
      }}
    >
      <fieldset>
        <legend>Swipes</legend>
        <div className="deck-switch" role="radiogroup" aria-label="Swipes for">
          {deckKinds.map(deck => (
            <button
              key={deck}
              type="button"
              role="radio"
              aria-checked={kind === deck}
              onClick={() => {
                setKind(deck);
                setProblem(null);
              }}
            >
              {deckNames[deck]}
            </button>
          ))}
        </div>
        <div className="gesture-grid">
          {gestureOrder.map(direction => (
            <div key={direction} className="gesture-cell">
              <label className="gesture-choice">
                <span>
                  <span aria-hidden="true">{directionArrows[direction]}</span> {directionNames[direction]}
                </span>
                <select
                  value={swipes.gestures[direction]}
                  onChange={event => {
                    const action = event.target.value as Swipes['gestures'][Direction];
                    change('swipes', {
                      ...draft.swipes,
                      [kind]: { ...swipes, gestures: { ...swipes.gestures, [direction]: action } },
                    });
                    if (action === 'label' && !choices[direction]) setChoice(direction, labels?.[0]?.id ?? newLabel);
                  }}
                >
                  {deckActionIds(kind).map(action => (
                    <option key={action} value={action}>
                      {actionLabels[action].verb}
                    </option>
                  ))}
                </select>
              </label>
              {swipes.gestures[direction] === 'label' && (
                <>
                  <select
                    aria-label={`${directionNames[direction]} swipe label`}
                    value={choices[direction] ?? newLabel}
                    onChange={event => setChoice(direction, event.target.value)}
                  >
                    {labelOptions(direction).map(label => (
                      <option key={label.id} value={label.id}>
                        {label.name}
                      </option>
                    ))}
                    <option value={newLabel}>New label…</option>
                  </select>
                  {(choices[direction] ?? newLabel) === newLabel && (
                    <input
                      type="text"
                      aria-label={`New label for the ${directionNames[direction].toLowerCase()} swipe`}
                      placeholder="Label name, such as Later"
                      value={names[direction] ?? ''}
                      onChange={event => {
                        setName(direction, event.target.value);
                        setProblem(null);
                      }}
                    />
                  )}
                </>
              )}
            </div>
          ))}
        </div>
        <p className="hint">
          The Unread and Read decks each have their own swipes. Reply and Skip are also in the read view. A label swipe files the
          conversation under the label and takes it out of the inbox without marking it read.
        </p>
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

      {problem && (
        <p className="form-problem" role="alert">
          {problem}
        </p>
      )}
      <div className="modal-actions">
        <button type="submit" className="button primary" disabled={saving}>
          {saving ? 'Saving…' : 'Save'}
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
