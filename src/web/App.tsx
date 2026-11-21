import { useCallback, useEffect, useMemo, useState } from 'react';
import { LogIn, RefreshCw } from 'lucide-react';
import { httpGmail, type WebGmail } from './gmail-http.ts';
import { Session, SessionError, type SessionProblem } from './session.ts';
import { Sorter } from './Sorter.tsx';

type Auth = { status: 'checking' } | { status: 'signed-in'; email: string } | { status: 'problem'; problem: SessionProblem };

/** Why the last sign-in did not finish, as the Worker's callback reports it in `?signin=`. */
const signInProblems: Record<string, string> = {
  cancelled: 'Sign-in was cancelled.',
  expired: 'The sign-in took too long. Try again.',
  failed: 'Google did not complete the sign-in. Try again.',
  permission: 'nilmail needs the Gmail permission to sort your mail. Tick it on the Google screen.',
};

function takeSignInProblem(): string | null {
  const url = new URL(location.href);
  const reason = url.searchParams.get('signin');
  if (!reason) return null;
  url.searchParams.delete('signin');
  history.replaceState(null, '', url);
  return signInProblems[reason] ?? signInProblems.failed!;
}

function Welcome({ problem, notice, onRetry }: { problem: SessionProblem; notice: string | null; onRetry(): void }) {
  return (
    <main className="welcome">
      <img src="/icon.svg" alt="" width={88} height={88} />
      <h1>nilmail</h1>
      <p className="tagline">Sort your Gmail inbox one swipe at a time.</p>
      {notice && <p className="welcome-notice">{notice}</p>}
      {problem === 'signed-out' && (
        <a className="button primary" href="/api/auth/start">
          <LogIn size={18} aria-hidden="true" /> Sign in with Google
        </a>
      )}
      {problem === 'not-configured' && (
        <p className="welcome-notice">Sign-in is not set up on this server yet. See docs/setup.md.</p>
      )}
      {(problem === 'offline' || problem === 'unavailable') && (
        <>
          <p className="welcome-notice">
            {problem === 'offline' ? 'You are offline.' : 'Google could not be reached.'} Your mail is waiting.
          </p>
          <button type="button" className="button primary" onClick={onRetry}>
            <RefreshCw size={18} aria-hidden="true" /> Try again
          </button>
        </>
      )}
      <p className="welcome-small">Your mail goes straight from Gmail to this device. nilmail keeps nothing on a server.</p>
    </main>
  );
}

export function App() {
  const session = useMemo(() => new Session(), []);
  const gmail: WebGmail = useMemo(() => httpGmail(session), [session]);
  const [auth, setAuth] = useState<Auth>({ status: 'checking' });
  const [notice, setNotice] = useState<string | null>(takeSignInProblem);

  /** Asking Gmail for the address both checks the sign-in and gives the address Gmail links need. */
  const verify = useCallback(
    () =>
      gmail.emailAddress().then(
        email => setAuth({ status: 'signed-in', email }),
        error => setAuth({ status: 'problem', problem: error instanceof SessionError ? error.code : 'unavailable' }),
      ),
    [gmail],
  );

  const retry = useCallback(() => {
    setAuth({ status: 'checking' });
    void verify();
  }, [verify]);

  useEffect(() => {
    void verify();
  }, [verify]);

  useEffect(() => {
    if (auth.status !== 'problem' || auth.problem !== 'offline') return;
    window.addEventListener('online', retry);
    return () => window.removeEventListener('online', retry);
  }, [auth, retry]);

  const onSessionLost = useCallback(() => {
    session.forget();
    setNotice('Your Google sign-in ended. Sign in again to continue.');
    setAuth({ status: 'problem', problem: 'signed-out' });
  }, [session]);

  if (auth.status === 'checking') {
    return (
      <main className="welcome">
        <div className="spinner" role="status" aria-label="Signing in" />
      </main>
    );
  }
  if (auth.status === 'problem') return <Welcome problem={auth.problem} notice={notice} onRetry={retry} />;
  return (
    <Sorter
      gmail={gmail}
      email={auth.email}
      onSessionLost={onSessionLost}
      onSignOut={async () => {
        await session.signOut();
        setNotice('Signed out.');
        setAuth({ status: 'problem', problem: 'signed-out' });
      }}
    />
  );
}
