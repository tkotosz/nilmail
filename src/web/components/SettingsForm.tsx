import { useEffect, useState } from 'react';
import { LogOut } from 'lucide-react';
import { newPile } from '../../core/pile.ts';
import { restoreSettings } from '../../core/settings.ts';
import { directions, type GmailLabel, type Pile, type Settings } from '../../core/types.ts';
import { directionNames } from '../action-ui.ts';
import { problemText, type WebGmail } from '../gmail-http.ts';
import { DiscardDialog, Modal } from './Modal.tsx';
import { isStaged } from './LabelPicker.tsx';
import { PileEditor } from './PileEditor.tsx';
import { PileList } from './PileList.tsx';

/** Every label a pile names, in its filters and its swipes. */
const pileLabels = (pile: Pile): GmailLabel[] => [
  ...pile.filters.hasLabels,
  ...pile.filters.lacksLabels,
  ...directions.flatMap(direction => pile.swipes[direction].labels),
];

/** Why the piles cannot be saved yet, and which pile to show; null when they can. */
function problemWith(piles: Pile[]): { pileId: string; text: string } | null {
  for (const pile of piles) {
    if (!pile.name.trim()) return { pileId: pile.id, text: 'Give the pile a name.' };
    for (const direction of directions) {
      const { action, labels } = pile.swipes[direction];
      if ((action === 'addLabels' || action === 'removeLabel') && !labels.length) {
        return { pileId: pile.id, text: `Choose a label for the ${directionNames[direction].toLowerCase()} swipe.` };
      }
    }
  }
  return null;
}

/**
 * The piles with every label named in the form created in Gmail, so each has a real id. A name Gmail already has
 * (ignoring case, as Gmail does) uses that label instead.
 */
async function withCreatedLabels(
  piles: Pile[],
  known: GmailLabel[],
  createLabel: (name: string) => Promise<GmailLabel>,
): Promise<Pile[]> {
  const created = new Map<string, GmailLabel>();
  for (const label of piles.flatMap(pileLabels).filter(isStaged)) {
    if (created.has(label.id)) continue;
    const existing = known.find(item => item.name.toLowerCase() === label.name.toLowerCase());
    created.set(label.id, existing ?? (await createLabel(label.name)));
  }
  const real = (labels: GmailLabel[]) => labels.map(label => created.get(label.id) ?? label);
  return piles.map(pile => ({
    ...pile,
    filters: { ...pile.filters, hasLabels: real(pile.filters.hasLabels), lacksLabels: real(pile.filters.lacksLabels) },
    swipes: Object.fromEntries(
      directions.map(direction => [direction, { ...pile.swipes[direction], labels: real(pile.swipes[direction].labels) }]),
    ) as Pile['swipes'],
  }));
}

export function SettingsForm({
  settings,
  email,
  gmail,
  onSave,
  onClose,
  onSignOut,
}: {
  settings: Settings;
  email: string;
  gmail: WebGmail;
  onSave(settings: Settings): void;
  /** Closes without saving. */
  onClose(): void;
  onSignOut(): void;
}) {
  const [draft, setDraft] = useState(settings);
  /** The pile being edited, or null for the list of piles and the other settings. */
  const [editing, setEditing] = useState<string | null>(null);
  /** The user's labels, or null while they load. */
  const [labels, setLabels] = useState<GmailLabel[] | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  /** Asking whether to drop unsaved changes, after a close. */
  const [confirming, setConfirming] = useState(false);
  const changed = JSON.stringify(draft) !== JSON.stringify(settings);
  const requestClose = () => (changed ? setConfirming(true) : onClose());

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
  const setPiles = (update: (piles: Pile[]) => Pile[]) => setDraft(current => ({ ...current, piles: update(current.piles) }));
  const editedPile = draft.piles.find(pile => pile.id === editing);

  function movePile(id: string, by: -1 | 1) {
    setPiles(piles => {
      const from = piles.findIndex(pile => pile.id === id);
      const to = from + by;
      if (from < 0 || to < 0 || to >= piles.length) return piles;
      const moved = [...piles];
      [moved[from], moved[to]] = [moved[to]!, moved[from]!];
      return moved;
    });
  }

  function addPile() {
    const pile = newPile(crypto.randomUUID(), 'New pile');
    setPiles(piles => [...piles, pile]);
    setEditing(pile.id);
  }

  async function save() {
    const invalid = problemWith(draft.piles);
    if (invalid) {
      setEditing(invalid.pileId);
      return setProblem(invalid.text);
    }
    setSaving(true);
    setProblem(null);
    try {
      const piles = await withCreatedLabels(draft.piles, [...(labels ?? [])], name => gmail.createLabel(name));
      onSave(restoreSettings({ ...draft, piles }));
    } catch (error) {
      setProblem(`The label could not be saved. ${problemText(error)}`);
      setSaving(false);
    }
  }

  return (
    <Modal
      name="Settings"
      fullScreen
      onClose={requestClose}
      action={
        <button type="submit" form="settings-form" className="button text" disabled={saving}>
          {saving ? 'Saving…' : 'Save'}
        </button>
      }
    >
      <form
        id="settings-form"
        className="settings-form"
        onSubmit={event => {
          event.preventDefault();
          void save();
        }}
      >
        {editedPile ? (
          <PileEditor
            pile={editedPile}
            known={labels ?? []}
            onChange={changed => {
              setPiles(piles => piles.map(pile => (pile.id === changed.id ? changed : pile)));
              setProblem(null);
            }}
            onBack={() => setEditing(null)}
            onDelete={
              draft.piles.length > 1
                ? () => {
                    setPiles(piles => piles.filter(pile => pile.id !== editedPile.id));
                    setEditing(null);
                  }
                : undefined
            }
          />
        ) : (
          <>
            <PileList piles={draft.piles} onEdit={setEditing} onMove={movePile} onAdd={addPile} />

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
                <input
                  type="checkbox"
                  checked={draft.loadImages}
                  onChange={event => change('loadImages', event.target.checked)}
                />
                <span>Load images in emails automatically</span>
              </label>
              <p className="hint">Loading images lets senders see when you open their email.</p>
            </fieldset>
          </>
        )}

        {problem && (
          <p className="form-problem" role="alert">
            {problem}
          </p>
        )}

        {!editedPile && (
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
        )}
      </form>
      {confirming && <DiscardDialog onKeep={() => setConfirming(false)} onDiscard={onClose} />}
    </Modal>
  );
}
