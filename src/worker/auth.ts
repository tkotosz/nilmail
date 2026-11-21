// Google sign-in for one account. The Worker holds the client secret and turns the refresh token, kept encrypted in a
// cookie on the user's device, into short-lived access tokens. Mail never passes through here.
// https://developers.google.com/identity/protocols/oauth2/web-server

export interface AuthEnv {
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  /** 32 random bytes, base64-encoded; encrypts the session cookie. */
  SESSION_KEY?: string;
}

export const gmailScope = 'https://www.googleapis.com/auth/gmail.modify';
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
}

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

async function config(env: AuthEnv): Promise<Config | null> {
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET || !env.SESSION_KEY) return null;
  const raw = Uint8Array.from(atob(env.SESSION_KEY), char => char.charCodeAt(0));
  if (raw.length !== 32) return null;
  const key = await crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
  return { clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET, key };
}

/** Encrypts the refresh token with AES-GCM; the cookie holds the nonce and the ciphertext. */
export async function seal(key: CryptoKey, refreshToken: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const sealed = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(refreshToken)),
  );
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

const redirectUri = (url: URL) => `${url.origin}/api/auth/callback`;

function start(url: URL, config: Config): Response {
  const state = base64Url(crypto.getRandomValues(new Uint8Array(24)));
  const target = new URL(authorizeUrl);
  target.search = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: redirectUri(url),
    response_type: 'code',
    scope: gmailScope,
    access_type: 'offline',
    // Google sends a refresh token only with a fresh consent.
    prompt: 'consent',
    state,
  }).toString();
  return redirect(target.toString(), [cookie(stateCookie, state, { maxAge: 600, path: '/api/auth', sameSite: 'Lax' })]);
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

  const { ok, body } = await tokenRequest({
    code,
    client_id: config.clientId,
    client_secret: config.clientSecret,
    redirect_uri: redirectUri(url),
    grant_type: 'authorization_code',
  });
  if (!ok || !body.refresh_token) return fail('failed');
  // The consent screen lets the user untick the Gmail permission.
  if (!body.scope?.split(' ').includes(gmailScope)) return fail('permission');
  const session = await seal(config.key, body.refresh_token);
  return redirect('/', [clearState, cookie(sessionCookie, session, { maxAge: sessionMaxAge, path: '/api', sameSite: 'Strict' })]);
}

const clearSession = cookie(sessionCookie, '', { maxAge: 0, path: '/api', sameSite: 'Strict' });

async function token(request: Request, config: Config): Promise<Response> {
  const sealed = readCookie(request, sessionCookie);
  const refreshToken = sealed ? await unseal(config.key, sealed) : null;
  if (!refreshToken) return json({ error: 'signed-out' }, 401, sealed ? { 'Set-Cookie': clearSession } : {});
  const { ok, body } = await tokenRequest({
    refresh_token: refreshToken,
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
  const sealed = readCookie(request, sessionCookie);
  const refreshToken = sealed ? await unseal(config.key, sealed) : null;
  if (refreshToken) {
    await fetch(revokeUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ token: refreshToken }),
    }).catch(() => null);
  }
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
  if (route === 'GET /api/auth/start') return start(url, settings);
  if (route === 'GET /api/auth/callback') return callback(request, url, settings);
  if (route === 'POST /api/auth/token') return token(request, settings);
  return logout(request, settings);
}
