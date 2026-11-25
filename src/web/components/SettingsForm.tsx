import { useEffect, useEffectEvent, useRef, useState } from 'react';
import { ExternalLink, LogOut } from 'lucide-react';
import { newPile } from '../../core/pile.ts';
import { restoreSettings } from '../../core/settings.ts';
import { directions, type GmailLabel, type Pile, type Settings } from '../../core/types.ts';
import { directionNames } from '../action-ui.ts';
import { problemText, type WebGmail } from '../gmail-http.ts';
import { ConfirmDialog, Modal } from './Modal.tsx';
import { PileEditor, pageTitle, type LabelMaker, type PilePage } from './PilePages.tsx';
import { PileList } from './PileList.tsx';
import { Group, SwitchRow } from './SettingsRows.tsx';

/** Where Settings shows: the list of piles (null), or a page of one pile. */
type Place = { pileId: string; page: PilePage } | null;

/** Why the piles cannot be saved yet, and the page to fix it on; null when they can. */
function problemWith(piles: Pile[]): { place: NonNullable<Place>; text: string } | null {
  for (const pile of piles) {
    if (!pile.name.trim()) return { place: { pileId: pile.id, page: { name: 'pile' } }, text: 'Give the pile a name.' };
    for (const direction of directions) {
      if (!pile.swipes[direction].actions.length) {
        return {
          place: { pileId: pile.id, page: { name: 'swipe', direction } },
          text: `Choose what the ${directionNames[direction].toLowerCase()} swipe does.`,
        };
      }
    }
  }
  return null;
}

/**
 * A history entry of Settings: the page it shows and how many entries Settings has pushed, the first when it opened. The
 * phone's Back then steps up through the pages and, from the list of piles, closes Settings.
 */
export interface SettingsEntry {
  nilmail: 'settings';
  place: Place;
  depth: number;
}

export const isSettingsEntry = (state: unknown): state is SettingsEntry =>
  (state as SettingsEntry | null)?.nilmail === 'settings';

/** The entry Settings opens with: the list of piles. */
export const settingsOpened: SettingsEntry = { nilmail: 'settings', place: null, depth: 1 };

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
  /** Set when the user chose to leave without a change that cannot be saved, so Back closes without asking again. */
  const leaving = useRef(false);
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

  /** Every page starts at its top. */
  const show = (next: Place) => {
    setPlace(next);
    document.querySelector('dialog[open] .modal-content')?.scrollTo(0, 0);
  };
  /** Opens a page one level deeper, with a history entry, so the phone's Back returns from it. */
  const open = (next: Place) => {
    const depth = (isSettingsEntry(history.state) ? history.state.depth : 0) + 1;
    history.pushState({ nilmail: 'settings', place: next, depth } satisfies SettingsEntry, '');
    show(next);
  };
  /** Back `levels` pages, the way the phone's Back does; the history decides what shows (see onHistory). */
  const back = (levels = 1) => history.go(-levels);
  /** Closes Settings by going back past all of its entries. */
  const closeAll = () => history.go(-(isSettingsEntry(history.state) ? history.state.depth : 1));

  function close() {
    if (invalid) return setConfirming({ kind: 'leave' });
    closeAll();
  }

  // The phone's Back, the in-app back links and closing all move through the history; this shows where it lands.
  const onHistory = useEffectEvent((state: unknown) => {
    if (isSettingsEntry(state)) return show(state.place);
    if (leaving.current) return onClose();
    if (invalid) {
      // Back left Settings with a change that cannot be saved yet: stay, and ask first.
      history.pushState(settingsOpened, '');
      show(null);
      return setConfirming({ kind: 'leave' });
    }
    save(draft);
    onClose();
  });
  useEffect(() => {
    const listener = (event: PopStateEvent) => onHistory(event.state);
    window.addEventListener('popstate', listener);
    return () => window.removeEventListener('popstate', listener);
  }, []);
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
    open({ pileId: added.id, page: { name: 'pile' } });
  }

  function deletePile(id: string) {
    const next = { ...draft, piles: draft.piles.filter(item => item.id !== id) };
    setDraft(next);
    save(next);
    setConfirming(null);
    back();
  }

  return (
    <Modal
      name="Settings"
      fullScreen
      className="settings-dialog"
      onClose={close}
      title={pile && place ? pageTitle(pile, place.page) : undefined}
      onBack={place ? () => back() : undefined}
    >
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
            onOpen={page => open({ pileId: pile.id, page })}
            onBack={back}
            onDelete={draft.piles.length > 1 ? () => setConfirming({ kind: 'delete', pile }) : undefined}
          />
        ) : (
          <>
            <PileList
              piles={draft.piles}
              onEdit={id => open({ pileId: id, page: { name: 'pile' } })}
              onMove={movePile}
              onAdd={addPile}
            />
            <Group title="Mail">
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
            // Through the pile's page, so Back from the swipe leads there.
            open({ pileId: invalid.place.pileId, page: { name: 'pile' } });
            if (invalid.place.page.name !== 'pile') open(invalid.place);
          }}
          onConfirm={() => {
            setConfirming(null);
            leaving.current = true;
            closeAll();
          }}
        />
      )}
    </Modal>
  );
}
