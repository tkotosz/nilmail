// Google sign-in for the accounts on an allow-list. The Worker holds the client secret and turns the refresh token, kept
// encrypted in a cookie on the user's device, into short-lived access tokens. Mail never passes through here.
// https://developers.google.com/identity/protocols/oauth2/web-server
//
// Sign-in takes two trips to Google. The first asks only for the account's address: a basic permission that shows no
// "unverified app" warning and does not count toward Google's limit of 100 accounts for unverified apps. Only an
// address on the list goes on to the second trip, which asks for Gmail.

export interface AuthEnv {
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  /** 32 random bytes, base64-encoded; encrypts the session cookie. */
  SESSION_KEY?: string;
  /** The Google accounts that may sign in, separated by commas or spaces. */
  ALLOWED_EMAILS?: string;
}

export const gmailScope = 'https://www.googleapis.com/auth/gmail.modify';
/** `openid email` adds an ID token with the account's address to Google's token response. */
const identifyScopes = 'openid email';
const grantScopes = `openid email ${gmailScope}`;

/** The two trips to Google: learn who signs in, then ask for Gmail. */
type Step = 'identify' | 'grant';
const authorizeUrl = 'https://accounts.google.com/o/oauth2/v2/auth';
const tokenUrl = 'https://oauth2.googleapis.com/token';
const revokeUrl = 'https://oauth2.googleapis.com/revoke';

export const sessionCookie = 'nilmail_session';
const stateCookie = 'nilmail_state';
/** Chrome keeps a cookie at most 400 days. */
const sessionMaxAge = 400 * 24 * 60 * 60;

interface Config {
  clientId: string;
  clientSecret: string;
  key: CryptoKey;
  /** Normalized addresses, see `normalizeEmail`. */
  allowed: Set<string>;
}

/** What the session cookie holds, encrypted. */
interface Session {
  email: string;
  refreshToken: string;
}

/**
 * Compares addresses the way Gmail does: case does not matter, and in gmail.com addresses neither do dots, nor the
 * googlemail.com spelling of the domain.
 */
export function normalizeEmail(email: string): string {
  const [local = '', domain = ''] = email.trim().toLowerCase().split('@');
  if (domain === 'gmail.com' || domain === 'googlemail.com') return `${local.replaceAll('.', '')}@gmail.com`;
  return `${local}@${domain}`;
}

export const parseAllowList = (text: string) =>
  new Set(
    text
      .split(/[\s,]+/)
      .filter(item => item.includes('@'))
      .map(normalizeEmail),
  );

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers },
  });

const redirect = (location: string, cookies: string[] = []) => {
  const headers = new Headers({ Location: location, 'Cache-Control': 'no-store' });
  for (const cookie of cookies) headers.append('Set-Cookie', cookie);
  return new Response(null, { status: 302, headers });
};

function cookie(
  name: string,
  value: string,
  { maxAge, path, sameSite }: { maxAge: number; path: string; sameSite: 'Lax' | 'Strict' },
) {
  return `${name}=${value}; Max-Age=${maxAge}; Path=${path}; HttpOnly; Secure; SameSite=${sameSite}`;
}

export function readCookie(request: Request, name: string): string | undefined {
  for (const item of (request.headers.get('Cookie') ?? '').split(';')) {
    const [key, ...rest] = item.trim().split('=');
    if (key === name) return rest.join('=');
  }
  return undefined;
}

const base64Url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
const fromBase64Url = (text: string) =>
  Uint8Array.from(atob(text.replace(/-/g, '+').replace(/_/g, '/')), char => char.charCodeAt(0));

/** The settings, or null when one is missing: without an allow-list nobody can sign in. */
async function config(env: AuthEnv): Promise<Config | null> {
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET || !env.SESSION_KEY || !env.ALLOWED_EMAILS) return null;
  const allowed = parseAllowList(env.ALLOWED_EMAILS);
  const raw = Uint8Array.from(atob(env.SESSION_KEY), char => char.charCodeAt(0));
  if (raw.length !== 32 || allowed.size === 0) return null;
  const key = await crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
  return { clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET, key, allowed };
}

/** Encrypts text with AES-GCM; the result holds the nonce and the ciphertext. */
export async function seal(key: CryptoKey, text: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const sealed = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(text)));
  return `${base64Url(iv)}.${base64Url(sealed)}`;
}

export async function unseal(key: CryptoKey, value: string): Promise<string | null> {
  const [iv, sealed] = value.split('.');
  if (!iv || !sealed) return null;
  try {
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromBase64Url(iv) }, key, fromBase64Url(sealed));
    return new TextDecoder().decode(plain);
  } catch {
    return null;
  }
}

/** The session in the request's cookie; a cookie it cannot decrypt or read, such as an older format, gives null. */
async function readSession(request: Request, config: Config): Promise<Session | null> {
  const sealed = readCookie(request, sessionCookie);
  const text = sealed ? await unseal(config.key, sealed) : null;
  if (!text) return null;
  try {
    const session = JSON.parse(text) as Partial<Session>;
    return typeof session.email === 'string' && typeof session.refreshToken === 'string'
      ? { email: session.email, refreshToken: session.refreshToken }
      : null;
  } catch {
    return null;
  }
}

/**
 * The address in an ID token. Its signature needs no check here: the token comes straight from Google's token endpoint
 * over HTTPS, in a request authenticated with the client secret.
 * https://developers.google.com/identity/openid-connect/openid-connect#obtainuserinfo
 */
export function verifiedEmail(idToken: string | undefined): string | null {
  const payload = idToken?.split('.')[1];
  if (!payload) return null;
  try {
    const claims = JSON.parse(new TextDecoder().decode(fromBase64Url(payload))) as { email?: unknown; email_verified?: unknown };
    return typeof claims.email === 'string' && claims.email_verified === true ? claims.email : null;
  } catch {
    return null;
  }
}

async function revoke(token: string): Promise<void> {
  await fetch(revokeUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ token }),
  }).catch(() => null);
}

const redirectUri = (url: URL) => `${url.origin}/api/auth/callback`;

/**
 * Sends the browser to Google for one step. The state names the step, and the state cookie must match it on the way
 * back, so only this Worker can start a step.
 */
function toGoogle(url: URL, config: Config, step: Step, email?: string, cookies: string[] = []): Response {
  const state = `${step}.${base64Url(crypto.getRandomValues(new Uint8Array(24)))}`;
  const fields: Record<string, string> =
    step === 'identify'
      ? { scope: identifyScopes, prompt: 'select_account' }
      : // Google sends a refresh token only with offline access and a fresh consent.
        { scope: grantScopes, access_type: 'offline', prompt: 'consent', ...(email ? { login_hint: email } : {}) };
  const target = new URL(authorizeUrl);
  target.search = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: redirectUri(url),
    response_type: 'code',
    state,
    ...fields,
  }).toString();
  return redirect(target.toString(), [
    ...cookies,
    cookie(stateCookie, state, { maxAge: 600, path: '/api/auth', sameSite: 'Lax' }),
  ]);
}

async function tokenRequest(fields: Record<string, string>) {
  const response = await fetch(tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(fields),
  });
  const body = (await response.json().catch(() => ({}))) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    scope?: string;
    id_token?: string;
    error?: string;
  };
  return { ok: response.ok, body };
}

async function callback(request: Request, url: URL, config: Config): Promise<Response> {
  const clearState = cookie(stateCookie, '', { maxAge: 0, path: '/api/auth', sameSite: 'Lax' });
  const fail = (reason: string) => redirect(`/?signin=${reason}`, [clearState]);
  const state = url.searchParams.get('state');
  if (!state || state !== readCookie(request, stateCookie)) return fail('expired');
  if (url.searchParams.get('error')) return fail('cancelled');
  const code = url.searchParams.get('code');
  if (!code) return fail('failed');
  const step: Step = state.startsWith('grant.') ? 'grant' : 'identify';

  const { ok, body } = await tokenRequest({
    code,
    client_id: config.clientId,
    client_secret: config.clientSecret,
    redirect_uri: redirectUri(url),
    grant_type: 'authorization_code',
  });
  if (!ok) return fail('failed');
  const email = verifiedEmail(body.id_token);
  const allowed = email !== null && config.allowed.has(normalizeEmail(email));

  if (step === 'identify') {
    // The basic permission is withdrawn either way: nilmail keeps nothing from this step but the answer.
    if (body.access_token) await revoke(body.access_token);
    if (!allowed) return fail('not-allowed');
    return toGoogle(url, config, 'grant', email, [clearState]);
  }

  if (!body.refresh_token) return fail('failed');
  // A different account can be picked on the second trip; it gets no access then.
  if (!allowed) {
    await revoke(body.refresh_token);
    return fail('not-allowed');
  }
  // The consent screen lets the user untick the Gmail permission.
  if (!body.scope?.split(' ').includes(gmailScope)) return fail('permission');
  const session = await seal(config.key, JSON.stringify({ email, refreshToken: body.refresh_token } satisfies Session));
  return redirect('/', [clearState, cookie(sessionCookie, session, { maxAge: sessionMaxAge, path: '/api', sameSite: 'Strict' })]);
}

const clearSession = cookie(sessionCookie, '', { maxAge: 0, path: '/api', sameSite: 'Strict' });

async function token(request: Request, config: Config): Promise<Response> {
  const session = await readSession(request, config);
  const hasCookie = readCookie(request, sessionCookie) !== undefined;
  if (!session) return json({ error: 'signed-out' }, 401, hasCookie ? { 'Set-Cookie': clearSession } : {});
  // The list is checked on every renewal, so taking an address off it ends that person's access within the hour.
  if (!config.allowed.has(normalizeEmail(session.email))) {
    await revoke(session.refreshToken);
    return json({ error: 'not-allowed' }, 401, { 'Set-Cookie': clearSession });
  }
  const { ok, body } = await tokenRequest({
    refresh_token: session.refreshToken,
    client_id: config.clientId,
    client_secret: config.clientSecret,
    grant_type: 'refresh_token',
  });
  if (ok && body.access_token) return json({ accessToken: body.access_token, expiresIn: body.expires_in ?? 3600 });
  // invalid_grant: the user revoked access, or Google expired the token.
  if (body.error === 'invalid_grant') return json({ error: 'signed-out' }, 401, { 'Set-Cookie': clearSession });
  return json({ error: 'unavailable' }, 502);
}

async function logout(request: Request, config: Config): Promise<Response> {
  const session = await readSession(request, config);
  if (session) await revoke(session.refreshToken);
  return new Response(null, { status: 204, headers: { 'Set-Cookie': clearSession, 'Cache-Control': 'no-store' } });
}

/** Handles `/api/auth/*`. POST routes only answer the app's own pages. */
export async function serveAuth(request: Request, env: AuthEnv): Promise<Response> {
  const url = new URL(request.url);
  const route = `${request.method} ${url.pathname}`;
  const routes = ['GET /api/auth/start', 'GET /api/auth/callback', 'POST /api/auth/token', 'POST /api/auth/logout'];
  if (!routes.includes(route)) return json({ error: 'not-found' }, 404);
  if (request.method === 'POST' && request.headers.get('Origin') !== url.origin) return json({ error: 'forbidden' }, 403);

  const settings = await config(env);
  if (!settings) return json({ error: 'not-configured' }, 503);
  if (route === 'GET /api/auth/start') return toGoogle(url, settings, 'identify');
  if (route === 'GET /api/auth/callback') return callback(request, url, settings);
  if (route === 'POST /api/auth/token') return token(request, settings);
  return logout(request, settings);
}
