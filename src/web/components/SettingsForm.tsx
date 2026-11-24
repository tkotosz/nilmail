import { useEffect, useState } from 'react';
import { LogOut } from 'lucide-react';
import { actionLabels } from '../../core/actions.ts';
import { defaultQuery, restoreSettings } from '../../core/settings.ts';
import { gestureActionIds, type Direction, type GmailLabel, type Settings } from '../../core/types.ts';
import { directionArrows, directionNames } from '../action-ui.ts';
import { problemText, type WebGmail } from '../gmail-http.ts';

const gestureOrder: Direction[] = ['left', 'right', 'up', 'down'];

/** The label picker's choice that makes a new label. */
const newLabel = 'new';

/**
 * The label for each label swipe: the chosen one, with its current name, or one named in the form. A name that matches
 * an existing label (ignoring case, as Gmail does) uses it; any other is created in Gmail. Names are checked before.
 */
async function resolveLabels(
  draft: Settings,
  choices: Partial<Record<Direction, string>>,
  names: Partial<Record<Direction, string>>,
  known: GmailLabel[],
  createLabel: (name: string) => Promise<GmailLabel>,
): Promise<Settings['labels']> {
  const labels: Settings['labels'] = {};
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
  email,
  gmail,
  onSave,
  onSignOut,
}: {
  settings: Settings;
  email: string;
  gmail: WebGmail;
  onSave(settings: Settings): void;
  onSignOut(): void;
}) {
  const [draft, setDraft] = useState(settings);
  /** The user's labels, or null while they load. */
  const [labels, setLabels] = useState<GmailLabel[] | null>(null);
  /** Per label swipe: a label id, or `newLabel`. */
  const [labelChoices, setLabelChoices] = useState<Partial<Record<Direction, string>>>(() =>
    Object.fromEntries(gestureOrder.map(direction => [direction, settings.labels[direction]?.id])),
  );
  const [newNames, setNewNames] = useState<Partial<Record<Direction, string>>>({});
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

  /** The labels a picker offers: the user's, and a saved one Gmail no longer lists, so the choice still shows. */
  const labelOptions = (direction: Direction) => {
    const saved = settings.labels[direction];
    const known = labels ?? [];
    return saved && !known.some(label => label.id === saved.id) ? [saved, ...known] : known;
  };

  async function save() {
    const unnamed = gestureOrder.find(
      direction =>
        draft.gestures[direction] === 'label' &&
        (labelChoices[direction] ?? newLabel) === newLabel &&
        !newNames[direction]?.trim(),
    );
    if (unnamed) return setProblem(`Name the label for the ${directionNames[unnamed].toLowerCase()} swipe.`);
    setSaving(true);
    setProblem(null);
    try {
      const known = [...(labels ?? [])];
      const chosen = await resolveLabels(draft, labelChoices, newNames, known, name => gmail.createLabel(name));
      onSave(restoreSettings({ ...draft, labels: chosen }));
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
        <div className="gesture-grid">
          {gestureOrder.map(direction => (
            <div key={direction} className="gesture-cell">
              <label className="gesture-choice">
                <span>
                  <span aria-hidden="true">{directionArrows[direction]}</span> {directionNames[direction]}
                </span>
                <select
                  value={draft.gestures[direction]}
                  onChange={event => {
                    const action = event.target.value as Settings['gestures'][Direction];
                    change('gestures', { ...draft.gestures, [direction]: action });
                    if (action === 'label' && !labelChoices[direction]) {
                      setLabelChoices(current => ({ ...current, [direction]: labels?.[0]?.id ?? newLabel }));
                    }
                  }}
                >
                  {gestureActionIds.map(action => (
                    <option key={action} value={action}>
                      {actionLabels[action].verb}
                    </option>
                  ))}
                </select>
              </label>
              {draft.gestures[direction] === 'label' && (
                <>
                  <select
                    aria-label={`${directionNames[direction]} swipe label`}
                    value={labelChoices[direction] ?? newLabel}
                    onChange={event => setLabelChoices(current => ({ ...current, [direction]: event.target.value }))}
                  >
                    {labelOptions(direction).map(label => (
                      <option key={label.id} value={label.id}>
                        {label.name}
                      </option>
                    ))}
                    <option value={newLabel}>New label…</option>
                  </select>
                  {(labelChoices[direction] ?? newLabel) === newLabel && (
                    <input
                      type="text"
                      aria-label={`New label for the ${directionNames[direction].toLowerCase()} swipe`}
                      placeholder="Label name, such as Later"
                      value={newNames[direction] ?? ''}
                      onChange={event => {
                        setNewNames(current => ({ ...current, [direction]: event.target.value }));
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
          Actions without a swipe show up as small buttons on the card. A label swipe files the conversation under the label and
          takes it out of the inbox, still unread.
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
