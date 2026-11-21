import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { gmailScope, readCookie, seal, serveAuth, sessionCookie, unseal } from '../src/worker/auth.ts';

const origin = 'https://nilmail.example';
const env = {
  GOOGLE_CLIENT_ID: 'client-id',
  GOOGLE_CLIENT_SECRET: 'client-secret',
  SESSION_KEY: Buffer.alloc(32, 7).toString('base64'),
};
const key = await crypto.subtle.importKey('raw', Buffer.alloc(32, 7), 'AES-GCM', false, ['encrypt', 'decrypt']);

const post = (path: string, headers: Record<string, string> = {}) =>
  new Request(`${origin}${path}`, { method: 'POST', headers: { Origin: origin, ...headers } });

/** Stands in for Google's token and revoke endpoints, recording what the Worker sent. */
function mockGoogle(t: TestContext, answer: (body: URLSearchParams) => { status?: number; json: unknown }) {
  const calls: { url: string; body: URLSearchParams }[] = [];
  t.mock.method(globalThis, 'fetch', async (url: string, init: RequestInit) => {
    const body = new URLSearchParams(String(init.body));
    calls.push({ url, body });
    const { status = 200, json } = answer(body);
    return new Response(JSON.stringify(json), { status });
  });
  return calls;
}

const setCookies = (response: Response) => response.headers.getSetCookie();

test('the session cookie is encrypted and cannot be forged', async () => {
  const sealed = await seal(key, 'refresh-1');
  assert.doesNotMatch(sealed, /refresh-1/);
  assert.equal(await unseal(key, sealed), 'refresh-1');
  assert.equal(await unseal(key, sealed.slice(0, -2) + 'AA'), null);
  assert.equal(await unseal(key, 'garbage'), null);
});

test('sign-in starts at Google with offline access to Gmail and a state cookie', async () => {
  const response = await serveAuth(new Request(`${origin}/api/auth/start`), env);
  assert.equal(response.status, 302);
  const target = new URL(response.headers.get('Location')!);
  assert.equal(target.origin + target.pathname, 'https://accounts.google.com/o/oauth2/v2/auth');
  assert.equal(target.searchParams.get('client_id'), 'client-id');
  assert.equal(target.searchParams.get('redirect_uri'), `${origin}/api/auth/callback`);
  assert.equal(target.searchParams.get('scope'), gmailScope);
  assert.equal(target.searchParams.get('access_type'), 'offline');
  const state = target.searchParams.get('state')!;
  assert.ok(state.length > 20);
  assert.match(
    setCookies(response)[0]!,
    new RegExp(`^nilmail_state=${state}; Max-Age=600; Path=/api/auth; HttpOnly; Secure; SameSite=Lax$`),
  );
});

test('the callback trades the code for a refresh token and keeps it encrypted in a cookie', async t => {
  const calls = mockGoogle(t, () => ({
    json: { access_token: 'a', refresh_token: 'refresh-1', scope: gmailScope, expires_in: 3599 },
  }));
  const request = new Request(`${origin}/api/auth/callback?state=s1&code=c1`, { headers: { Cookie: 'nilmail_state=s1' } });
  const response = await serveAuth(request, env);
  assert.equal(response.status, 302);
  assert.equal(response.headers.get('Location'), '/');
  assert.equal(calls[0]!.url, 'https://oauth2.googleapis.com/token');
  assert.equal(calls[0]!.body.get('code'), 'c1');
  assert.equal(calls[0]!.body.get('client_secret'), 'client-secret');
  assert.equal(calls[0]!.body.get('redirect_uri'), `${origin}/api/auth/callback`);
  const session = setCookies(response).find(item => item.startsWith(`${sessionCookie}=`))!;
  assert.match(session, /; Max-Age=34560000; Path=\/api; HttpOnly; Secure; SameSite=Strict$/);
  const value = readCookie(new Request(origin, { headers: { Cookie: session.split(';')[0]! } }), sessionCookie)!;
  assert.equal(await unseal(key, value), 'refresh-1');
});

test('the callback refuses a wrong state, a cancelled consent and a missing Gmail permission', async t => {
  mockGoogle(t, () => ({ json: { refresh_token: 'r', scope: 'openid' } }));
  const callback = (query: string, cookie = 'nilmail_state=s1') =>
    serveAuth(new Request(`${origin}/api/auth/callback?${query}`, { headers: { Cookie: cookie } }), env);
  assert.equal((await callback('state=other&code=c')).headers.get('Location'), '/?signin=expired');
  assert.equal((await callback('state=s1&code=c', '')).headers.get('Location'), '/?signin=expired');
  assert.equal((await callback('state=s1&error=access_denied')).headers.get('Location'), '/?signin=cancelled');
  assert.equal((await callback('state=s1&code=c')).headers.get('Location'), '/?signin=permission');
});

test('the token route turns the cookie into a fresh access token', async t => {
  const calls = mockGoogle(t, () => ({ json: { access_token: 'access-2', expires_in: 3599 } }));
  const cookie = `${sessionCookie}=${await seal(key, 'refresh-1')}`;
  const response = await serveAuth(post('/api/auth/token', { Cookie: cookie }), env);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { accessToken: 'access-2', expiresIn: 3599 });
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  assert.equal(calls[0]!.body.get('grant_type'), 'refresh_token');
  assert.equal(calls[0]!.body.get('refresh_token'), 'refresh-1');
});

test('the token route signs out when there is no session or Google revoked it', async t => {
  mockGoogle(t, () => ({ status: 400, json: { error: 'invalid_grant' } }));
  assert.equal((await serveAuth(post('/api/auth/token'), env)).status, 401);
  const forged = await serveAuth(post('/api/auth/token', { Cookie: `${sessionCookie}=abc.def` }), env);
  assert.equal(forged.status, 401);
  assert.match(setCookies(forged)[0]!, /^nilmail_session=; Max-Age=0/);
  const revoked = await serveAuth(post('/api/auth/token', { Cookie: `${sessionCookie}=${await seal(key, 'old')}` }), env);
  assert.equal(revoked.status, 401);
  assert.match(setCookies(revoked)[0]!, /^nilmail_session=; Max-Age=0/);
});

test('a Google outage is not a sign-out', async t => {
  mockGoogle(t, () => ({ status: 500, json: { error: 'backend_error' } }));
  const response = await serveAuth(post('/api/auth/token', { Cookie: `${sessionCookie}=${await seal(key, 'r')}` }), env);
  assert.equal(response.status, 502);
  assert.deepEqual(setCookies(response), []);
});

test('sign-out revokes the token at Google and clears the cookie', async t => {
  const calls = mockGoogle(t, () => ({ json: {} }));
  const response = await serveAuth(post('/api/auth/logout', { Cookie: `${sessionCookie}=${await seal(key, 'refresh-1')}` }), env);
  assert.equal(response.status, 204);
  assert.equal(calls[0]!.url, 'https://oauth2.googleapis.com/revoke');
  assert.equal(calls[0]!.body.get('token'), 'refresh-1');
  assert.match(setCookies(response)[0]!, /^nilmail_session=; Max-Age=0/);
});

test('POST routes answer only the app itself, and missing secrets are reported', async () => {
  const foreign = await serveAuth(post('/api/auth/token', { Origin: 'https://evil.example' }), env);
  assert.equal(foreign.status, 403);
  assert.equal((await serveAuth(new Request(`${origin}/api/auth/token`, { method: 'POST' }), env)).status, 403);
  assert.equal((await serveAuth(new Request(`${origin}/api/auth/token`), env)).status, 404, 'GET is not a route');
  assert.equal((await serveAuth(new Request(`${origin}/api/auth/start`), {})).status, 503);
  assert.equal((await serveAuth(new Request(`${origin}/api/auth/start`), { ...env, SESSION_KEY: 'c2hvcnQ=' })).status, 503);
});
