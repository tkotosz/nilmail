import { useCallback, useEffect, useEffectEvent, useMemo, useReducer, useRef, useState } from 'react';
import { Check, Inbox, Layers, RefreshCw, Settings as SettingsIcon, Share } from 'lucide-react';
import { actionDone, actionVerb, applySteps, coversSender, isUnread, stepsFor, undoSteps } from '../core/actions.ts';
import { countFromLabel, pileCount, pileSearch, swipe } from '../core/pile.ts';
import { emptyDeck, findFromSender, loadCards, needsCards, reduceDeck, type Decision } from '../core/deck.ts';
import { applyChanges, applyToGmail } from '../core/gmail.ts';
import { withCurrentLabels } from '../core/settings.ts';
import { directions, type Direction, type MailCard, type Pile, type Settings, type Swipe } from '../core/types.ts';
import { actionUi, directionArrows, keyDirections } from './action-ui.ts';
import { InstallButton } from './components/InstallButton.tsx';
import { MailCardView, NoDrag } from './components/MailCardView.tsx';
import { Modal } from './components/Modal.tsx';
import { ReadView } from './components/ReadView.tsx';
import { SettingsForm } from './components/SettingsForm.tsx';
import { SwipeCard, type SwipeAction, type SwipeCardHandle } from './components/SwipeCard.tsx';
import { useSwipeKeys } from './components/useSwipeKeys.ts';
import { gmailLink, problemText, type LabelCounts, type WebGmail } from './gmail-http.ts';
import { SessionError } from './session.ts';
import { sendUnsubscribe, unsubscribeDone } from './unsubscribe.ts';
import { loadSettings, saveSettings } from './storage.ts';
import { appVersion } from './version.ts';

interface Toast {
  id: number;
  text: string;
  tone: 'info' | 'error';
  /** Set when the toast offers to undo this decision. */
  decision?: number;
}

const toastTime = { info: 5000, error: 8000 };

/** "All from this sender" for the card `threadId`: looking up the sender's other conversations, or holding them. */
type SenderChoice = { threadId: string; others: null } | { threadId: string; others: MailCard[]; more: boolean };

/** How many conversations a pile holds: exact, or Gmail's estimate for its search. */
interface PileCount {
  value: number;
  estimate: boolean;
}

const numbers = new Intl.NumberFormat('en-US');
/** A pile's name with its count, such as "Unread · 12", or "Old promos · ~120" when Gmail only estimates. */
const pileLabel = (pile: Pile, count: PileCount | undefined) =>
  count ? `${pile.name} · ${count.estimate ? '~' : ''}${numbers.format(count.value)}` : pile.name;

const conversations = (count: number) => (count === 1 ? 'one conversation' : `${count} conversations`);

export function Sorter({
  gmail,
  email,
  onSignOut,
  onSessionLost,
}: {
  gmail: WebGmail;
  email: string;
  onSignOut(): void;
  onSessionLost(): void;
}) {
  const [deck, dispatch] = useReducer(reduceDeck, emptyDeck);
  const [settings, setSettings] = useState<Settings>(loadSettings);
  const [reading, setReading] = useState<MailCard | null>(null);
  const [dialog, setDialog] = useState<'settings' | 'install' | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);
  const [counts, setCounts] = useState<Record<string, PileCount>>({});
  /** Each visit starts on the first pile: the choice is not saved. */
  const [pileId, setPileId] = useState(() => settings.piles[0]!.id);
  const [sender, setSender] = useState<SenderChoice | null>(null);
  const [loadProblem, setLoadProblem] = useState<string | null>(null);
  /** Changes whenever the top card must start fresh, such as after a swipe that opened the read view. */
  const [cardVersion, setCardVersion] = useState(0);
  const card = useRef<SwipeCardHandle>(null);
  const nextId = useRef(1);
  /** Gmail changes run one after the other, so an undo never overtakes the change it undoes. */
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  /** Changes on every reload, so a batch that was loading for the previous search is dropped. */
  const generation = useRef(0);

  /** A pile deleted in Settings falls back to the first. */
  const pile = settings.piles.find(item => item.id === pileId) ?? settings.piles[0]!;
  const search = useMemo(() => pileSearch(pile.filters), [pile.filters]);
  const searchKey = JSON.stringify(search);
  /** The search the deck holds cards for; when the pile's search changes, the deck starts again. */
  const deckSearch = useRef(searchKey);
  const top = deck.cards[0];
  const next = deck.cards[1];
  /** The choice only holds for the card it was made on. */
  const allFromSender = sender && sender.threadId === top?.threadId ? sender : null;
  const findingSender = allFromSender?.others === null;

  const showToast = useCallback((toast: Omit<Toast, 'id'>) => setToast({ ...toast, id: nextId.current++ }), []);

  const report = useCallback(
    (error: unknown, prefix = '') => {
      if (error instanceof SessionError && error.code === 'signed-out') return onSessionLost();
      showToast({ text: prefix + problemText(error), tone: 'error' });
    },
    [onSessionLost, showToast],
  );

  /** Counts each pile: from its label's numbers when they give it exactly, otherwise Gmail's estimate for its search. */
  const refreshCounts = useCallback(() => {
    const labelNumbers = new Map<string, Promise<LabelCounts>>();
    const numbersOf = (labelId: string) => {
      if (!labelNumbers.has(labelId)) labelNumbers.set(labelId, gmail.labelCounts(labelId));
      return labelNumbers.get(labelId)!;
    };
    for (const item of settings.piles) {
      const exact = pileCount(item.filters);
      const counting: Promise<PileCount> = exact
        ? numbersOf(exact.labelId).then(found => ({ value: countFromLabel(found, exact.read), estimate: false }))
        : gmail.estimateThreads(pileSearch(item.filters)).then(value => ({ value, estimate: true }));
      counting.then(
        count => setCounts(current => ({ ...current, [item.id]: count })),
        () => undefined,
      );
    }
  }, [gmail, settings.piles]);

  const enqueue = <Result,>(task: () => Promise<Result>) => {
    const run = queue.current.then(task);
    queue.current = run.catch(() => undefined);
    return run;
  };

  useEffect(refreshCounts, [refreshCounts]);

  // Saved piles keep label names, which Gmail search needs; take the current ones, as a label may have been renamed.
  useEffect(() => {
    gmail.userLabels().then(
      known => setSettings(current => withCurrentLabels(current, known)),
      () => undefined,
    );
  }, [gmail]);

  const onSearchChanged = useEffectEvent(() => {
    if (deckSearch.current === searchKey) return;
    deckSearch.current = searchKey;
    reload();
  });
  useEffect(() => onSearchChanged(), [searchKey]);

  useEffect(() => {
    if (!needsCards(deck) || loadProblem) return;
    const current = generation.current;
    dispatch({ type: 'loading' });
    loadCards(gmail, search, deck.seen).then(
      ({ cards, more }) => current === generation.current && dispatch({ type: 'loaded', cards, more }),
      error => {
        if (current !== generation.current) return;
        dispatch({ type: 'loadFailed' });
        if (error instanceof SessionError && error.code === 'signed-out') onSessionLost();
        else setLoadProblem(problemText(error));
      },
    );
  }, [deck, gmail, search, loadProblem, onSessionLost]);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), toastTime[toast.tone]);
    return () => clearTimeout(timer);
  }, [toast]);

  function reload() {
    generation.current++;
    dispatch({ type: 'reset' });
    setSender(null);
    setLoadProblem(null);
    refreshCounts();
  }

  function showPile(id: string) {
    const chosen = settings.piles.find(item => item.id === id);
    if (!chosen) return;
    setPileId(id);
    // Start again now, so the old pile's cards never show with the new pile's swipes.
    deckSearch.current = JSON.stringify(pileSearch(chosen.filters));
    reload();
  }

  function openReadView(card: MailCard) {
    setReading(card);
    // The read view's actions are about this conversation alone.
    setSender(null);
    setCardVersion(version => version + 1);
    const steps = stepsFor(swipe('read'), card, settings);
    if (!steps.length) return;
    dispatch({ type: 'cardChanged', card: applySteps(card, steps) });
    enqueue(() => applyToGmail(gmail, card.threadId, steps)).then(refreshCounts, error => {
      dispatch({ type: 'cardChanged', card });
      report(error);
    });
  }

  function toggleAllFromSender(card: MailCard) {
    if (allFromSender) return setSender(null);
    setSender({ threadId: card.threadId, others: null });
    findFromSender(gmail, search, card).then(
      ({ others, more }) =>
        setSender(current => (current?.threadId === card.threadId && !current.others ? { ...current, others, more } : current)),
      error => {
        setSender(current => (current?.threadId === card.threadId ? null : current));
        report(error);
      },
    );
  }

  function decide(card: MailCard, chosen: Swipe) {
    // Marking a read conversation read would change nothing: the card just moves on.
    const done = chosen.action === 'markRead' && !isUnread(card) ? swipe('skip') : chosen;
    const { action } = done;
    if (action === 'read') return openReadView(card);
    if (action === 'reply') window.open(gmailLink(email, card.threadId), '_blank', 'noopener');
    if (action === 'unsubscribe' && card.unsubscribe) {
      sendUnsubscribe(card.unsubscribe).catch(() =>
        showToast({ text: 'The unsubscribe request did not reach the sender. Check your connection.', tone: 'error' }),
      );
    }
    const others = allFromSender?.threadId === card.threadId && coversSender(action) ? (allFromSender.others ?? []) : [];
    const planned = [card, ...others].map(item => ({ card: item, steps: stepsFor(done, item, settings) }));
    const id = nextId.current++;
    dispatch({
      type: 'decided',
      decision: { id, action, changes: planned.map(({ card, steps }) => ({ card, undo: undoSteps(steps, card) })) },
    });
    setSender(null);
    const text = action === 'unsubscribe' && card.unsubscribe ? unsubscribeDone[card.unsubscribe.kind] : actionDone(done);
    showToast({ text: others.length ? `${text}: ${conversations(planned.length)}` : text, tone: 'info', decision: id });
    if (!planned.some(change => change.steps.length)) return;
    const changes = planned.map(({ card, steps }) => ({ threadId: card.threadId, steps }));
    enqueue(() => applyChanges(gmail, changes)).then(({ failed, error }) => {
      refreshCounts();
      if (!failed.length) return;
      dispatch({ type: 'decisionFailed', id, threadIds: failed });
      report(error, failed.length < changes.length ? `${conversations(failed.length)} could not be changed. ` : '');
    });
  }

  function undo(decision: Decision | undefined = deck.history.at(-1)) {
    if (!decision) return;
    dispatch({ type: 'undone', id: decision.id });
    setToast(null);
    const changes = decision.changes.map(({ card, undo }) => ({ threadId: card.threadId, steps: undo }));
    if (!changes.some(change => change.steps.length)) return;
    enqueue(() => applyChanges(gmail, changes)).then(({ failed, error }) => {
      refreshCounts();
      if (!failed.length) return;
      const stuck = decision.changes.filter(change => failed.includes(change.card.threadId));
      dispatch({ type: 'undoFailed', decision: { ...decision, changes: stuck } });
      report(error, 'Could not undo. ');
    });
  }

  /** Ctrl+Z or Cmd+Z undoes the last decision, unless a dialog or a form field has the keyboard. */
  const onUndoKey = useEffectEvent((event: KeyboardEvent) => {
    if (event.key.toLowerCase() !== 'z' || !(event.ctrlKey || event.metaKey) || document.querySelector('dialog[open]')) return;
    const target = event.target as HTMLElement;
    if (target.tagName === 'INPUT' || target.tagName === 'SELECT') return;
    event.preventDefault();
    undo();
  });
  useEffect(() => {
    window.addEventListener('keydown', onUndoKey);
    return () => window.removeEventListener('keydown', onUndoKey);
  }, []);

  useSwipeKeys(card, Boolean(top) && !reading && !dialog, keyDirections);

  /** How many conversations an action covers when it covers all from the sender, such as "15" or "100+". */
  const senderCount = allFromSender?.others?.length && `${allFromSender.others.length + 1}${allFromSender.more ? '+' : ''}`;
  const verb = (chosen: Swipe) =>
    senderCount && coversSender(chosen.action) ? `${actionVerb(chosen)} ${senderCount}` : actionVerb(chosen);
  // While the sender's conversations are being found, the card stays put: a swipe would not know what it covers.
  const swipeActions: SwipeAction[] = findingSender
    ? []
    : directions.map(direction => {
        const chosen = pile.swipes[direction];
        return { direction, label: verb(chosen), tone: actionUi[chosen.action].tone };
      });
  const count = counts[pile.id];
  const lastDecision = deck.history.at(-1);
  const waiting = deck.loading || (deck.more && !loadProblem);

  return (
    <div className="sorter">
      <header className="top-bar">
        <div className="brand">
          <img src="/icon.svg" alt="" width={30} height={30} />
          <span className="brand-name">
            nilmail
            <small className="app-version" title={appVersion}>
              {appVersion}
            </small>
          </span>
        </div>
        <div className="top-actions">
          <button type="button" className="icon-button" onClick={reload} aria-label="Refresh" title="Refresh">
            <RefreshCw size={21} />
          </button>
          <InstallButton onAppleHelp={() => setDialog('install')} />
          <button
            type="button"
            className="icon-button"
            onClick={() => setDialog('settings')}
            aria-label="Settings"
            title="Settings"
          >
            <SettingsIcon size={21} />
          </button>
        </div>
      </header>
      <nav className="pile-tabs" aria-label="Piles">
        {settings.piles.map(item => {
          const itemCount = counts[item.id];
          const shown = item.id === pile.id;
          return (
            <button
              key={item.id}
              type="button"
              className="pile-tab"
              aria-pressed={shown}
              aria-label={pileLabel(item, itemCount)}
              title={itemCount?.estimate ? `About ${numbers.format(itemCount.value)} (Gmail's estimate)` : undefined}
              ref={element => {
                if (shown) element?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
              }}
              onClick={() => showPile(item.id)}
            >
              {item.name}
              {itemCount && (
                <span className="pile-tab-count">
                  {itemCount.estimate ? '~' : ''}
                  {numbers.format(itemCount.value)}
                </span>
              )}
            </button>
          );
        })}
      </nav>

      <main className="deck-area">
        {top ? (
          <div className="deck">
            {next && (
              <div className="deck-next" aria-hidden="true">
                <MailCardView card={next} />
              </div>
            )}
            <SwipeCard
              key={`${top.threadId}:${cardVersion}`}
              ref={card}
              actions={swipeActions}
              onAction={direction => decide(top, pile.swipes[direction])}
            >
              <MailCardView card={top}>
                <NoDrag className="card-extras">
                  <button
                    type="button"
                    className="chip-button sender-toggle"
                    aria-pressed={Boolean(allFromSender)}
                    onClick={() => toggleAllFromSender(top)}
                  >
                    {allFromSender ? <Check size={18} aria-hidden="true" /> : <Layers size={18} aria-hidden="true" />}{' '}
                    {findingSender
                      ? 'Finding all from sender…'
                      : allFromSender
                        ? senderCount
                          ? `All ${senderCount} from sender`
                          : 'No others from sender'
                        : 'All from sender'}
                  </button>
                  {top.unsubscribe && (
                    <button
                      type="button"
                      className={`chip-button tone-${actionUi.unsubscribe.tone}`}
                      disabled={findingSender}
                      onClick={() => decide(top, swipe('unsubscribe'))}
                    >
                      <actionUi.unsubscribe.Icon size={15} aria-hidden="true" /> {verb(swipe('unsubscribe'))}
                    </button>
                  )}
                </NoDrag>
              </MailCardView>
            </SwipeCard>
          </div>
        ) : waiting ? (
          <div className="deck-message" role="status">
            <div className="spinner" />
            <p>Loading your inbox…</p>
          </div>
        ) : loadProblem ? (
          <div className="deck-message">
            <p>{loadProblem}</p>
            <button type="button" className="button primary" onClick={reload}>
              <RefreshCw size={18} aria-hidden="true" /> Try again
            </button>
          </div>
        ) : (
          <div className="deck-message inbox-zero">
            <span className="empty-icon" aria-hidden="true">
              <Inbox size={36} />
            </span>
            <h2>Nothing left to sort</h2>
            {count && !count.estimate && count.value > 0 ? (
              <p>
                {count.value === 1
                  ? 'One skipped conversation still belongs'
                  : `${numbers.format(count.value)} skipped conversations still belong`}{' '}
                in {pile.name}.
              </p>
            ) : pile.id === 'unread' ? (
              <p>Inbox zero. Well done.</p>
            ) : (
              <p>Nothing left in {pile.name}.</p>
            )}
            <button type="button" className="button secondary" onClick={reload}>
              <RefreshCw size={18} aria-hidden="true" /> Check again
            </button>
          </div>
        )}
      </main>

      <nav className="action-bar" aria-label="Actions" hidden={!top}>
        {(['left', 'down', 'up', 'right'] as Direction[]).map(direction => {
          const chosen = pile.swipes[direction];
          const { Icon, tone } = actionUi[chosen.action];
          return (
            <button
              key={direction}
              type="button"
              className={`action-button tone-${tone}`}
              disabled={!top || findingSender}
              onClick={() => void card.current?.swipe(direction)}
            >
              <Icon size={22} aria-hidden="true" />
              <span>{verb(chosen)}</span>
              <kbd aria-hidden="true">{directionArrows[direction]}</kbd>
            </button>
          );
        })}
      </nav>

      {toast && (
        <div key={toast.id} className={`toast toast-${toast.tone}`} role="status">
          <span>{toast.text}</span>
          {toast.decision !== undefined && toast.decision === lastDecision?.id && (
            <button type="button" className="toast-undo" onClick={() => undo(lastDecision)}>
              Undo
            </button>
          )}
        </div>
      )}

      {reading && (
        <ReadView
          card={reading}
          gmail={gmail}
          email={email}
          loadImages={settings.loadImages}
          onClose={() => setReading(null)}
          onAction={action => {
            const current = deck.cards.find(item => item.threadId === reading.threadId) ?? reading;
            setReading(null);
            decide(current, swipe(action));
          }}
        />
      )}

      {dialog === 'settings' && (
        <SettingsForm
          settings={settings}
          email={email}
          gmail={gmail}
          onSignOut={onSignOut}
          onChange={changed => {
            // A changed search for the pile showing, or a deleted pile, starts the deck again (see onSearchChanged).
            setSettings(changed);
            if (!saveSettings(changed)) showToast({ text: 'The browser did not let nilmail save the settings.', tone: 'error' });
          }}
          onClose={() => setDialog(null)}
        />
      )}

      {dialog === 'install' && (
        <Modal name="Install nilmail" onClose={() => setDialog(null)}>
          <ol className="install-steps">
            <li>
              Tap <strong>Share</strong> <Share size={16} aria-label="(the square with an arrow)" /> in the browser's toolbar.
            </li>
            <li>
              Choose <strong>Add to Home Screen</strong>. You may need to scroll down, or tap <strong>More</strong>, to see it.
            </li>
            <li>
              Tap <strong>Add</strong>. nilmail then opens from your Home Screen like an app.
            </li>
          </ol>
        </Modal>
      )}
    </div>
  );
}
