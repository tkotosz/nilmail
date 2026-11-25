import { useEffect, useEffectEvent, useRef, useState } from 'react';
import { ExternalLink, LogOut } from 'lucide-react';
import { newPile } from '../../core/pile.ts';
import { restoreSettings } from '../../core/settings.ts';
import { directions, type GmailLabel, type Pile, type Settings } from '../../core/types.ts';
import { directionNames } from '../action-ui.ts';
import { problemText, type WebGmail } from '../gmail-http.ts';
import { ConfirmDialog, Modal } from './Modal.tsx';
import { PileEditor, type LabelMaker, type PilePage } from './PilePages.tsx';
import { PileList } from './PileList.tsx';
import { Group, SwitchRow } from './SettingsRows.tsx';

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

/** How long typing pauses before a change is saved, so a pile's search does not reload the deck on every key. */
const saveDelay = 600;

/**
 * Settings save as they change. A change that cannot work yet, such as an Add labels swipe without a label, waits with a
 * notice until it is complete; closing then asks whether to drop it.
 */
export function SettingsForm({
  settings,
  email,
  gmail,
  onChange,
  onClose,
  onSignOut,
}: {
  settings: Settings;
  email: string;
  gmail: WebGmail;
  /** Applies and stores changed settings. */
  onChange(settings: Settings): void;
  onClose(): void;
  onSignOut(): void;
}) {
  const [draft, setDraft] = useState(settings);
  const [place, setPlace] = useState<Place>(null);
  /** The user's labels, or null while they load. */
  const [labels, setLabels] = useState<GmailLabel[] | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  /** A confirmation on screen: deleting a pile, or leaving with a change that cannot be saved. */
  const [confirming, setConfirming] = useState<{ kind: 'delete'; pile: Pile } | { kind: 'leave' } | null>(null);
  /** The settings as last handed on, to save only real changes. */
  const saved = useRef(JSON.stringify(settings));
  const invalid = problemWith(draft.piles);

  useEffect(() => {
    let current = true;
    gmail.userLabels().then(
      found => current && setLabels(found),
      () => {
        if (!current) return;
        setLabels([]);
        setProblem('Your Gmail labels could not be loaded.');
      },
    );
    return () => {
      current = false;
    };
  }, [gmail]);

  /** Hands on `next` when it can work and differs from what was saved. */
  function save(next: Settings) {
    if (problemWith(next.piles)) return;
    const json = JSON.stringify(next);
    if (json === saved.current) return;
    saved.current = json;
    onChange(restoreSettings(next));
  }
  const saveDraft = useEffectEvent(() => save(draft));
  useEffect(() => {
    const timer = setTimeout(saveDraft, saveDelay);
    return () => clearTimeout(timer);
  }, [draft]);

  function close() {
    if (invalid) return setConfirming({ kind: 'leave' });
    save(draft);
    onClose();
  }

  /** Every page starts at its top. */
  const go = (next: Place) => {
    setPlace(next);
    document.querySelector('dialog[open] .modal-content')?.scrollTo(0, 0);
  };
  const change = <Key extends keyof Settings>(key: Key, value: Settings[Key]) =>
    setDraft(current => ({ ...current, [key]: value }));
  const setPiles = (update: (piles: Pile[]) => Pile[]) => setDraft(current => ({ ...current, piles: update(current.piles) }));
  const pile = place && draft.piles.find(item => item.id === place.pileId);

  const makeLabel: LabelMaker = async name => {
    const known = labels ?? [];
    const existing = known.find(label => label.name.toLowerCase() === name.toLowerCase());
    if (existing) return existing;
    try {
      const created = await gmail.createLabel(name);
      setLabels(current => [...(current ?? []), created]);
      setProblem(null);
      return created;
    } catch (error) {
      setProblem(`The label could not be created. ${problemText(error)}`);
      throw error;
    }
  };

  function movePile(id: string, index: number) {
    setPiles(piles => {
      const moving = piles.find(item => item.id === id);
      if (!moving) return piles;
      const rest = piles.filter(item => item.id !== id);
      return [...rest.slice(0, index), moving, ...rest.slice(index)];
    });
  }

  function addPile() {
    const added = newPile(crypto.randomUUID(), 'New pile');
    setPiles(piles => [...piles, added]);
    go({ pileId: added.id, page: { name: 'pile' } });
  }

  function deletePile(id: string) {
    const next = { ...draft, piles: draft.piles.filter(item => item.id !== id) };
    setDraft(next);
    save(next);
    setConfirming(null);
    go(null);
  }

  return (
    <Modal name="Settings" fullScreen className="settings-dialog" onClose={close}>
      <div className="settings-form">
        {(invalid || problem) && (
          <p className="form-problem" role="alert">
            {invalid ? `${invalid.text} Until then, this change is not saved.` : problem}
          </p>
        )}
        {pile && place ? (
          <PileEditor
            pile={pile}
            page={place.page}
            known={labels ?? []}
            makeLabel={makeLabel}
            onChange={edited => setPiles(piles => piles.map(item => (item.id === edited.id ? edited : item)))}
            onOpen={page => go({ pileId: pile.id, page })}
            onBack={() => go(null)}
            onDelete={draft.piles.length > 1 ? () => setConfirming({ kind: 'delete', pile }) : undefined}
          />
        ) : (
          <>
            <PileList
              piles={draft.piles}
              onEdit={id => go({ pileId: id, page: { name: 'pile' } })}
              onMove={movePile}
              onAdd={addPile}
            />
            <Group title="Mail">
              <SwitchRow
                title="Archive also marks as read"
                checked={draft.archiveMarksRead}
                onChange={checked => change('archiveMarksRead', checked)}
              />
              <SwitchRow
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
      </div>
      {confirming?.kind === 'delete' && (
        <ConfirmDialog
          title={`Delete ${confirming.pile.name || 'this pile'}?`}
          text="The pile and its swipes go away. Your mail and labels stay as they are."
          confirm="Delete"
          onCancel={() => setConfirming(null)}
          onConfirm={() => deletePile(confirming.pile.id)}
        />
      )}
      {confirming?.kind === 'leave' && invalid && (
        <ConfirmDialog
          title="Leave without this change?"
          text={invalid.text}
          confirm="Leave"
          cancel="Fix it"
          onCancel={() => {
            setConfirming(null);
            go(invalid.place);
          }}
          onConfirm={onClose}
        />
      )}
    </Modal>
  );
}
