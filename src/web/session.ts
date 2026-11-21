// The browser's side of signing in: it asks the Worker for a short-lived Gmail access token and keeps it in memory only.

export type SessionProblem = 'signed-out' | 'not-configured' | 'offline' | 'unavailable';

export class SessionError extends Error {
  readonly code: SessionProblem;
  constructor(code: SessionProblem) {
    super(`Session ${code}`);
    this.code = code;
  }
}

/** Renew this long before the token expires, so a slow request does not run out of time. */
const renewMargin = 120_000;

export class Session {
  private token: string | null = null;
  private expiresAt = 0;
  private pending: Promise<string> | null = null;

  /** A valid access token; `renew` asks for a new one even when the current one has not expired. */
  accessToken(renew = false): Promise<string> {
    if (!renew && this.token && Date.now() < this.expiresAt - renewMargin) return Promise.resolve(this.token);
    this.pending ??= this.fetchToken().finally(() => (this.pending = null));
    return this.pending;
  }

  private async fetchToken(): Promise<string> {
    let response: Response;
    try {
      response = await fetch('/api/auth/token', { method: 'POST', credentials: 'same-origin' });
    } catch {
      throw new SessionError('offline');
    }
    if (response.status === 401) this.forget();
    if (response.status === 401) throw new SessionError('signed-out');
    if (response.status === 503) throw new SessionError('not-configured');
    if (!response.ok) throw new SessionError('unavailable');
    const { accessToken, expiresIn } = (await response.json()) as { accessToken: string; expiresIn: number };
    this.token = accessToken;
    this.expiresAt = Date.now() + expiresIn * 1000;
    return accessToken;
  }

  forget(): void {
    this.token = null;
    this.expiresAt = 0;
  }

  async signOut(): Promise<void> {
    this.forget();
    await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' }).catch(() => null);
  }
}
