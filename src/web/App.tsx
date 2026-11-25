import { useCallback, useEffect, useMemo, useState } from 'react';
import { RefreshCw } from 'lucide-react';
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
  'not-allowed': 'This nilmail is private. Ask its owner to add your Google account.',
};

function takeSignInProblem(): string | null {
  const url = new URL(location.href);
  const reason = url.searchParams.get('signin');
  if (!reason) return null;
  url.searchParams.delete('signin');
  history.replaceState(null, '', url);
  return signInProblems[reason] ?? signInProblems.failed!;
}

/** Google's standard four-color G, unmodified, as its sign-in branding guidelines require. */
function GoogleLogo() {
  return (
    <svg width="20" height="20" viewBox="0 0 48 48" aria-hidden="true">
      <path
        fill="#EA4335"
        d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
      />
      <path
        fill="#4285F4"
        d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
      />
      <path
        fill="#FBBC05"
        d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
      />
      <path
        fill="#34A853"
        d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
      />
    </svg>
  );
}

function Welcome({ problem, notice, onRetry }: { problem: SessionProblem; notice: string | null; onRetry(): void }) {
  return (
    <main className="welcome">
      <img src="/icon.svg" alt="" width={88} height={88} />
      <h1>nilmail</h1>
      <p className="tagline">Sort your Gmail inbox one swipe at a time.</p>
      {notice && <p className="welcome-notice">{notice}</p>}
      {problem === 'signed-out' && (
        <>
          <a className="google-button" href="/api/auth/start">
            <GoogleLogo /> Sign in with Google
          </a>
          <p className="welcome-small">Private app: only invited Google accounts can sign in.</p>
        </>
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
      <p className="welcome-small">
        Your mail goes straight from Gmail to this device. nilmail keeps nothing on a server.{' '}
        <a href="/privacy">Privacy policy</a>
      </p>
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
