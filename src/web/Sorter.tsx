import { useCallback, useEffect, useEffectEvent, useReducer, useRef, useState } from 'react';
import { Inbox, RefreshCw, Settings as SettingsIcon, Undo2 } from 'lucide-react';
import { actionLabels, applySteps, stepsFor, undoSteps } from '../core/actions.ts';
import { emptyDeck, loadCards, needsCards, reduceDeck, type Decision } from '../core/deck.ts';
import { applyToGmail } from '../core/gmail.ts';
import { actionsWithoutGesture } from '../core/settings.ts';
import { directions, type ActionId, type Direction, type MailCard, type Settings } from '../core/types.ts';
import { actionUi, directionArrows, keyDirections } from './action-ui.ts';
import { InstallButton } from './components/InstallButton.tsx';
import { MailCardView, NoDrag } from './components/MailCardView.tsx';
import { Modal } from './components/Modal.tsx';
import { ReadView } from './components/ReadView.tsx';
import { SettingsForm } from './components/SettingsForm.tsx';
import { SwipeCard, type SwipeAction, type SwipeCardHandle } from './components/SwipeCard.tsx';
import { useSwipeKeys } from './components/useSwipeKeys.ts';
import { gmailLink, problemText, type WebGmail } from './gmail-http.ts';
import { SessionError } from './session.ts';
import { loadSettings, saveSettings } from './storage.ts';

interface Toast {
  id: number;
  text: string;
  tone: 'info' | 'error';
  /** Set when the toast offers to undo this decision. */
  decision?: number;
}

const toastTime = { info: 5000, error: 8000 };

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
  const [unread, setUnread] = useState<number | null>(null);
  const [loadProblem, setLoadProblem] = useState<string | null>(null);
  /** Changes whenever the top card must start fresh, such as after a swipe that opened the read view. */
  const [cardVersion, setCardVersion] = useState(0);
  const card = useRef<SwipeCardHandle>(null);
  const nextId = useRef(1);
  /** Gmail changes run one after the other, so an undo never overtakes the change it undoes. */
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  /** Changes on every reload, so a batch that was loading for the previous search is dropped. */
  const generation = useRef(0);

  const top = deck.cards[0];
  const next = deck.cards[1];

  const showToast = useCallback((toast: Omit<Toast, 'id'>) => setToast({ ...toast, id: nextId.current++ }), []);

  const report = useCallback(
    (error: unknown, prefix = '') => {
      if (error instanceof SessionError && error.code === 'signed-out') return onSessionLost();
      showToast({ text: prefix + problemText(error), tone: 'error' });
    },
    [onSessionLost, showToast],
  );

  const refreshUnread = useCallback(() => {
    gmail.unreadInInbox().then(setUnread, () => undefined);
  }, [gmail]);

  const enqueue = (task: () => Promise<void>) => {
    const run = queue.current.then(task);
    queue.current = run.catch(() => undefined);
    return run;
  };

  useEffect(refreshUnread, [refreshUnread]);

  useEffect(() => {
    if (!needsCards(deck) || loadProblem) return;
    const current = generation.current;
    dispatch({ type: 'loading' });
    loadCards(gmail, settings.query, deck.seen).then(
      ({ cards, more }) => current === generation.current && dispatch({ type: 'loaded', cards, more }),
      error => {
        if (current !== generation.current) return;
        dispatch({ type: 'loadFailed' });
        if (error instanceof SessionError && error.code === 'signed-out') onSessionLost();
        else setLoadProblem(problemText(error));
      },
    );
  }, [deck, gmail, settings.query, loadProblem, onSessionLost]);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), toastTime[toast.tone]);
    return () => clearTimeout(timer);
  }, [toast]);

  function reload() {
    generation.current++;
    dispatch({ type: 'reset' });
    setLoadProblem(null);
    refreshUnread();
  }

  function openReadView(card: MailCard) {
    setReading(card);
    setCardVersion(version => version + 1);
    const steps = stepsFor('read', card, settings);
    if (!steps.length) return;
    dispatch({ type: 'cardChanged', card: applySteps(card, steps) });
    enqueue(() => applyToGmail(gmail, card.threadId, steps)).then(refreshUnread, error => {
      dispatch({ type: 'cardChanged', card });
      report(error);
    });
  }

  function decide(card: MailCard, action: ActionId) {
    if (action === 'read') return openReadView(card);
    if (action === 'reply') window.open(gmailLink(email, card.threadId), '_blank', 'noopener');
    const steps = stepsFor(action, card, settings);
    const id = nextId.current++;
    dispatch({ type: 'decided', id, card, action, undo: undoSteps(steps, card) });
    showToast({ text: actionLabels[action].done, tone: 'info', decision: id });
    if (!steps.length) return;
    enqueue(() => applyToGmail(gmail, card.threadId, steps)).then(refreshUnread, error => {
      dispatch({ type: 'decisionFailed', id });
      report(error);
    });
  }

  function undo(decision: Decision | undefined = deck.history.at(-1)) {
    if (!decision) return;
    dispatch({ type: 'undone', id: decision.id });
    setToast(null);
    if (!decision.undo.length) return;
    enqueue(() => applyToGmail(gmail, decision.card.threadId, decision.undo)).then(refreshUnread, error => {
      dispatch({ type: 'undoFailed', decision });
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

  const swipeActions: SwipeAction[] = directions.map(direction => {
    const action = settings.gestures[direction];
    return { direction, label: actionLabels[action].verb, tone: actionUi[action].tone };
  });
  const extraActions = actionsWithoutGesture(settings);
  const lastDecision = deck.history.at(-1);
  const waiting = deck.loading || (deck.more && !loadProblem);

  return (
    <div className="sorter">
      <header className="top-bar">
        <div className="brand">
          <img src="/icon.svg" alt="" width={30} height={30} />
          <span>nilmail</span>
        </div>
        <span className="unread-count" aria-live="polite">
          {unread === null ? '' : `${unread} unread`}
        </span>
        <div className="top-actions">
          <InstallButton onHelp={() => setDialog('install')} />
          <button
            type="button"
            className="icon-button"
            onClick={() => undo()}
            disabled={!lastDecision}
            aria-label="Undo"
            title="Undo (Ctrl+Z)"
          >
            <Undo2 size={21} />
          </button>
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
              onAction={direction => decide(top, settings.gestures[direction])}
            >
              <MailCardView card={top}>
                {extraActions.length > 0 && (
                  <NoDrag className="card-extras">
                    {extraActions.map(action => {
                      const { Icon, tone } = actionUi[action];
                      return (
                        <button
                          key={action}
                          type="button"
                          className={`chip-button tone-${tone}`}
                          onClick={() => decide(top, action)}
                        >
                          <Icon size={15} aria-hidden="true" /> {actionLabels[action].verb}
                        </button>
                      );
                    })}
                  </NoDrag>
                )}
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
            <Inbox size={44} aria-hidden="true" />
            <h2>Nothing left to sort</h2>
            {unread ? (
              <p>
                {unread === 1 ? 'One skipped conversation is' : `${unread} skipped conversations are`} still unread in the inbox.
              </p>
            ) : (
              <p>Inbox zero. Well done.</p>
            )}
            <button type="button" className="button secondary" onClick={reload}>
              <RefreshCw size={18} aria-hidden="true" /> Check again
            </button>
          </div>
        )}
      </main>

      <nav className="action-bar" aria-label="Actions" hidden={!top}>
        {(['left', 'down', 'up', 'right'] as Direction[]).map(direction => {
          const action = settings.gestures[direction];
          const { Icon, tone } = actionUi[action];
          return (
            <button
              key={direction}
              type="button"
              className={`action-button tone-${tone}`}
              disabled={!top}
              onClick={() => void card.current?.swipe(direction)}
            >
              <Icon size={22} aria-hidden="true" />
              <span>{actionLabels[action].verb}</span>
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
          loadImages={settings.loadImages}
          onClose={() => setReading(null)}
          onAction={action => {
            const current = deck.cards.find(item => item.threadId === reading.threadId) ?? reading;
            setReading(null);
            decide(current, action);
          }}
        />
      )}

      {dialog === 'settings' && (
        <Modal name="Settings" className="settings-dialog" onClose={() => setDialog(null)}>
          <SettingsForm
            settings={settings}
            email={email}
            onSignOut={onSignOut}
            onSave={saved => {
              const queryChanged = saved.query !== settings.query;
              setSettings(saved);
              if (!saveSettings(saved)) showToast({ text: 'The browser did not let nilmail save the settings.', tone: 'error' });
              setDialog(null);
              if (queryChanged) reload();
            }}
          />
        </Modal>
      )}

      {dialog === 'install' && (
        <Modal name="Install nilmail" onClose={() => setDialog(null)}>
          <p>
            <strong>Android, Chrome:</strong> open the ⋮ menu and choose <em>Add to Home screen</em> or <em>Install app</em>.
          </p>
          <p>
            <strong>iPhone, Safari:</strong> tap Share, then <em>Add to Home Screen</em>.
          </p>
          <p>
            <strong>Computer, Chrome or Edge:</strong> click the install icon at the right end of the address bar.
          </p>
        </Modal>
      )}
    </div>
  );
}
