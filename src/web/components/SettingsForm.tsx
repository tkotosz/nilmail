import { useEffect, useState } from 'react';
import { ExternalLink, LogOut } from 'lucide-react';
import { newPile } from '../../core/pile.ts';
import { restoreSettings } from '../../core/settings.ts';
import { directions, type GmailLabel, type Pile, type Settings } from '../../core/types.ts';
import { directionNames } from '../action-ui.ts';
import { problemText, type WebGmail } from '../gmail-http.ts';
import { DiscardDialog, Modal } from './Modal.tsx';
import { isStaged, PileEditor, type PilePage } from './PilePages.tsx';
import { PileList } from './PileList.tsx';
import { CheckRow, Group } from './SettingsRows.tsx';

/** Every label a pile names, in its filters and its swipes. */
const pileLabels = (pile: Pile): GmailLabel[] => [
  ...pile.filters.hasLabels,
  ...pile.filters.lacksLabels,
  ...directions.flatMap(direction => pile.swipes[direction].labels),
];

/** Where Settings shows: the list of piles (null), or a page of one pile. */
type Place = { pileId: string; page: PilePage } | null;

/** Why the piles cannot be saved yet, and the page to fix it on; null when they can. */
function problemWith(piles: Pile[]): { place: NonNullable<Place>; text: string } | null {
  for (const pile of piles) {
    if (!pile.name.trim()) return { place: { pileId: pile.id, page: { name: 'pile' } }, text: 'Give the pile a name.' };
    for (const direction of directions) {
      const { action, labels } = pile.swipes[direction];
      if ((action === 'addLabels' || action === 'removeLabel') && !labels.length) {
        return {
          place: { pileId: pile.id, page: { name: 'swipe', direction } },
          text: `Choose a label for the ${directionNames[direction].toLowerCase()} swipe.`,
        };
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
  const [place, setPlace] = useState<Place>(null);
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

  /** Every page starts at its top. */
  const go = (next: Place) => {
    setPlace(next);
    document.querySelector('dialog[open] .modal-content')?.scrollTo(0, 0);
  };
  const change = <Key extends keyof Settings>(key: Key, value: Settings[Key]) =>
    setDraft(current => ({ ...current, [key]: value }));
  const setPiles = (update: (piles: Pile[]) => Pile[]) => setDraft(current => ({ ...current, piles: update(current.piles) }));
  const pile = place && draft.piles.find(item => item.id === place.pileId);

  function movePile(id: string, by: -1 | 1) {
    setPiles(piles => {
      const from = piles.findIndex(item => item.id === id);
      const to = from + by;
      if (from < 0 || to < 0 || to >= piles.length) return piles;
      const moved = [...piles];
      [moved[from], moved[to]] = [moved[to]!, moved[from]!];
      return moved;
    });
  }

  function addPile() {
    const added = newPile(crypto.randomUUID(), 'New pile');
    setPiles(piles => [...piles, added]);
    go({ pileId: added.id, page: { name: 'pile' } });
  }

  async function save() {
    const invalid = problemWith(draft.piles);
    if (invalid) {
      go(invalid.place);
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
      className="settings-dialog"
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
        {problem && (
          <p className="form-problem" role="alert">
            {problem}
          </p>
        )}
        {pile && place ? (
          <PileEditor
            pile={pile}
            page={place.page}
            known={labels ?? []}
            onChange={edited => {
              setPiles(piles => piles.map(item => (item.id === edited.id ? edited : item)));
              setProblem(null);
            }}
            onOpen={page => go({ pileId: pile.id, page })}
            onBack={() => go(null)}
            onDelete={
              draft.piles.length > 1
                ? () => {
                    setPiles(piles => piles.filter(item => item.id !== pile.id));
                    go(null);
                  }
                : undefined
            }
          />
        ) : (
          <>
            <PileList
              piles={draft.piles}
              onEdit={id => go({ pileId: id, page: { name: 'pile' } })}
              onMove={movePile}
              onAdd={addPile}
            />
            <p className="group-note">The picker in the header lists the piles in this order, and nilmail opens on the first.</p>
            <Group title="Mail">
              <CheckRow
                title="Archive also marks as read"
                checked={draft.archiveMarksRead}
                onChange={checked => change('archiveMarksRead', checked)}
              />
              <CheckRow
                title="Load images in emails automatically"
                value="Loading images lets senders see when you open their email."
                checked={draft.loadImages}
                onChange={checked => change('loadImages', checked)}
              />
            </Group>
            <Group title="Account">
              <div className="row">
                <span className="row-text">
                  <span className="row-title">Signed in</span>
                  <span className="row-value">{email}</span>
                </span>
              </div>
              <button type="button" className="row" onClick={onSignOut}>
                <LogOut size={20} aria-hidden="true" className="row-lead" />
                <span className="row-title">Sign out</span>
              </button>
              <a className="row" href="/privacy" target="_blank" rel="noopener">
                <ExternalLink size={20} aria-hidden="true" className="row-lead" />
                <span className="row-title">Privacy policy</span>
              </a>
            </Group>
          </>
        )}
      </form>
      {confirming && <DiscardDialog onKeep={() => setConfirming(false)} onDiscard={onClose} />}
    </Modal>
  );
}
