import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import {
  gmailScope,
  normalizeEmail,
  parseAllowList,
  readCookie,
  seal,
  serveAuth,
  sessionCookie,
  unseal,
  verifiedEmail,
} from '../src/worker/auth.ts';

const origin = 'https://nilmail.example';
const env = {
  GOOGLE_CLIENT_ID: 'client-id',
  GOOGLE_CLIENT_SECRET: 'client-secret',
  SESSION_KEY: Buffer.alloc(32, 7).toString('base64'),
  ALLOWED_EMAILS: 'owner@gmail.com, Friend@Example.org',
};
const key = await crypto.subtle.importKey('raw', Buffer.alloc(32, 7), 'AES-GCM', false, ['encrypt', 'decrypt']);

const post = (path: string, headers: Record<string, string> = {}) =>
  new Request(`${origin}${path}`, { method: 'POST', headers: { Origin: origin, ...headers } });

/** A session cookie as the callback writes it. */
const sessionFor = async (email: string, refreshToken: string) =>
  `${sessionCookie}=${await seal(key, JSON.stringify({ email, refreshToken }))}`;

/** An ID token as Google's token endpoint returns it; only the payload matters here. */
const idToken = (claims: Record<string, unknown>) =>
  ['e30', Buffer.from(JSON.stringify(claims)).toString('base64url'), 'signature'].join('.');

/** Stands in for Google's token and revoke endpoints, recording what the Worker sent. */
function mockGoogle(t: TestContext, answer: (url: string, body: URLSearchParams) => { status?: number; json: unknown }) {
  const calls: { url: string; body: URLSearchParams }[] = [];
  t.mock.method(globalThis, 'fetch', async (url: string, init: RequestInit) => {
    const body = new URLSearchParams(String(init.body));
    calls.push({ url, body });
    const { status = 200, json } = answer(url, body);
    return new Response(JSON.stringify(json), { status });
  });
  return calls;
}

const setCookies = (response: Response) => response.headers.getSetCookie();
/** Google's redirect back to the callback, for a trip started with state `state`. */
const callbackRequest = (state: string, query = `state=${state}&code=c1`) =>
  new Request(`${origin}/api/auth/callback?${query}`, { headers: { Cookie: `nilmail_state=${state}` } });
const googleTarget = (response: Response) => new URL(response.headers.get('Location')!);

test('the session cookie is encrypted and cannot be forged', async () => {
  const sealed = await seal(key, 'refresh-1');
  assert.doesNotMatch(sealed, /refresh-1/);
  assert.equal(await unseal(key, sealed), 'refresh-1');
  assert.equal(await unseal(key, sealed.slice(0, -2) + 'AA'), null);
  assert.equal(await unseal(key, 'garbage'), null);
});

test('addresses on the allow-list match the way Gmail matches them', () => {
  assert.equal(normalizeEmail(' J.Doe@GMAIL.com '), 'jdoe@gmail.com');
  assert.equal(normalizeEmail('j.doe@googlemail.com'), 'jdoe@gmail.com');
  assert.equal(normalizeEmail('j.doe@Example.org'), 'j.doe@example.org', 'dots count outside Gmail');
  assert.deepEqual(
    [...parseAllowList('a@gmail.com,b@example.org\n  c.d@gmail.com , ,')],
    ['a@gmail.com', 'b@example.org', 'cd@gmail.com'],
  );
});

test('the address comes from a verified ID token only', () => {
  assert.equal(verifiedEmail(idToken({ email: 'owner@gmail.com', email_verified: true })), 'owner@gmail.com');
  assert.equal(verifiedEmail(idToken({ email: 'owner@gmail.com', email_verified: false })), null);
  assert.equal(verifiedEmail(idToken({ email_verified: true })), null);
  assert.equal(verifiedEmail('not-a-token'), null);
  assert.equal(verifiedEmail(undefined), null);
});

test('sign-in starts by asking Google only for the account address', async () => {
  const response = await serveAuth(new Request(`${origin}/api/auth/start`), env);
  assert.equal(response.status, 302);
  const target = googleTarget(response);
  assert.equal(target.origin + target.pathname, 'https://accounts.google.com/o/oauth2/v2/auth');
  assert.equal(target.searchParams.get('client_id'), 'client-id');
  assert.equal(target.searchParams.get('redirect_uri'), `${origin}/api/auth/callback`);
  assert.equal(target.searchParams.get('scope'), 'openid email', 'no Gmail access, so no unverified-app warning');
  assert.equal(target.searchParams.get('access_type'), null);
  assert.equal(target.searchParams.get('prompt'), 'select_account');
  const state = target.searchParams.get('state')!;
  assert.match(state, /^identify\.[\w-]{20,}$/);
  assert.match(
    setCookies(response)[0]!,
    new RegExp(`^nilmail_state=${state}; Max-Age=600; Path=/api/auth; HttpOnly; Secure; SameSite=Lax$`),
  );
});

test('a listed address goes on to the Gmail permission, for the same account', async t => {
  const calls = mockGoogle(t, url =>
    url.endsWith('/token')
      ? { json: { access_token: 'basic', id_token: idToken({ email: 'Friend@example.org', email_verified: true }) } }
      : { json: {} },
  );
  const response = await serveAuth(callbackRequest('identify.s1'), env);
  const target = googleTarget(response);
  assert.equal(target.searchParams.get('scope'), `openid email ${gmailScope}`);
  assert.equal(target.searchParams.get('access_type'), 'offline');
  assert.equal(target.searchParams.get('prompt'), 'consent');
  assert.equal(target.searchParams.get('login_hint'), 'Friend@example.org');
  const state = target.searchParams.get('state')!;
  assert.match(state, /^grant\./);
  assert.ok(setCookies(response).some(item => item.startsWith(`nilmail_state=${state};`)));
  assert.ok(!setCookies(response).some(item => item.startsWith(`${sessionCookie}=`)), 'no session before Gmail is granted');
  assert.deepEqual(
    calls.map(call => call.url),
    ['https://oauth2.googleapis.com/token', 'https://oauth2.googleapis.com/revoke'],
  );
  assert.equal(calls[1]!.body.get('token'), 'basic', 'the basic permission is withdrawn');
});

test('an unlisted or unverified address stops after the first step, without reaching Gmail', async t => {
  for (const claims of [
    { email: 'stranger@gmail.com', email_verified: true },
    { email: 'owner@gmail.com', email_verified: false },
  ]) {
    const calls = mockGoogle(t, url =>
      url.endsWith('/token') ? { json: { access_token: 'basic', id_token: idToken(claims) } } : { json: {} },
    );
    const response = await serveAuth(callbackRequest('identify.s1'), env);
    assert.equal(response.headers.get('Location'), '/?signin=not-allowed');
    assert.ok(!setCookies(response).some(item => item.startsWith(`${sessionCookie}=`)));
    assert.equal(calls[1]!.url, 'https://oauth2.googleapis.com/revoke');
    assert.equal(calls[1]!.body.get('token'), 'basic');
    t.mock.restoreAll();
  }
});

test('a listed account that grants Gmail gets its refresh token and address kept encrypted in a cookie', async t => {
  const calls = mockGoogle(t, () => ({
    json: {
      access_token: 'a',
      refresh_token: 'refresh-1',
      scope: `openid ${gmailScope} https://www.googleapis.com/auth/userinfo.email`,
      id_token: idToken({ email: 'friend@example.org', email_verified: true }),
    },
  }));
  const response = await serveAuth(callbackRequest('grant.s1'), env);
  assert.equal(response.status, 302);
  assert.equal(response.headers.get('Location'), '/');
  assert.equal(calls.length, 1);
  assert.equal(calls[0]!.url, 'https://oauth2.googleapis.com/token');
  assert.equal(calls[0]!.body.get('code'), 'c1');
  assert.equal(calls[0]!.body.get('client_secret'), 'client-secret');
  assert.equal(calls[0]!.body.get('redirect_uri'), `${origin}/api/auth/callback`);
  const session = setCookies(response).find(item => item.startsWith(`${sessionCookie}=`))!;
  assert.match(session, /; Max-Age=34560000; Path=\/api; HttpOnly; Secure; SameSite=Strict$/);
  const value = readCookie(new Request(origin, { headers: { Cookie: session.split(';')[0]! } }), sessionCookie)!;
  assert.deepEqual(JSON.parse((await unseal(key, value))!), { email: 'friend@example.org', refreshToken: 'refresh-1' });
});

test('switching to an unlisted account on the Gmail step gets no access, and its token is revoked', async t => {
  const calls = mockGoogle(t, url =>
    url.endsWith('/token')
      ? {
          json: {
            refresh_token: 'refresh-x',
            scope: gmailScope,
            id_token: idToken({ email: 'stranger@gmail.com', email_verified: true }),
          },
        }
      : { json: {} },
  );
  const response = await serveAuth(callbackRequest('grant.s1'), env);
  assert.equal(response.headers.get('Location'), '/?signin=not-allowed');
  assert.ok(!setCookies(response).some(item => item.startsWith(`${sessionCookie}=`)));
  assert.equal(calls[1]!.url, 'https://oauth2.googleapis.com/revoke');
  assert.equal(calls[1]!.body.get('token'), 'refresh-x');
});

test('the callback refuses a wrong state, a cancelled consent and a missing Gmail permission', async t => {
  mockGoogle(t, () => ({
    json: { refresh_token: 'r', scope: 'openid', id_token: idToken({ email: 'owner@gmail.com', email_verified: true }) },
  }));
  const callback = (query: string, cookie = 'nilmail_state=grant.s1') =>
    serveAuth(new Request(`${origin}/api/auth/callback?${query}`, { headers: { Cookie: cookie } }), env);
  assert.equal((await callback('state=grant.other&code=c')).headers.get('Location'), '/?signin=expired');
  assert.equal((await callback('state=grant.s1&code=c', '')).headers.get('Location'), '/?signin=expired');
  assert.equal((await callback('state=grant.s1&error=access_denied')).headers.get('Location'), '/?signin=cancelled');
  assert.equal((await callback('state=grant.s1&code=c')).headers.get('Location'), '/?signin=permission');
});

test('the token route turns the cookie into a fresh access token', async t => {
  const calls = mockGoogle(t, () => ({ json: { access_token: 'access-2', expires_in: 3599 } }));
  const response = await serveAuth(
    post('/api/auth/token', { Cookie: await sessionFor('o.w.n.e.r@gmail.com', 'refresh-1') }),
    env,
  );
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { accessToken: 'access-2', expiresIn: 3599 });
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  assert.equal(calls[0]!.body.get('grant_type'), 'refresh_token');
  assert.equal(calls[0]!.body.get('refresh_token'), 'refresh-1');
});

test('taking an address off the list ends that session at the next renewal', async t => {
  const calls = mockGoogle(t, () => ({ json: {} }));
  const response = await serveAuth(post('/api/auth/token', { Cookie: await sessionFor('friend@example.org', 'refresh-1') }), {
    ...env,
    ALLOWED_EMAILS: 'owner@gmail.com',
  });
  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { error: 'not-allowed' });
  assert.match(setCookies(response)[0]!, /^nilmail_session=; Max-Age=0/);
  assert.equal(calls[0]!.url, 'https://oauth2.googleapis.com/revoke');
  assert.equal(calls[0]!.body.get('token'), 'refresh-1');
});

test('the token route signs out when there is no session, an old or forged cookie, or Google revoked it', async t => {
  mockGoogle(t, () => ({ status: 400, json: { error: 'invalid_grant' } }));
  assert.equal((await serveAuth(post('/api/auth/token'), env)).status, 401);
  for (const value of ['abc.def', await seal(key, 'refresh-from-an-older-version')]) {
    const response = await serveAuth(post('/api/auth/token', { Cookie: `${sessionCookie}=${value}` }), env);
    assert.equal(response.status, 401);
    assert.match(setCookies(response)[0]!, /^nilmail_session=; Max-Age=0/);
  }
  const revoked = await serveAuth(post('/api/auth/token', { Cookie: await sessionFor('owner@gmail.com', 'old') }), env);
  assert.equal(revoked.status, 401);
  assert.deepEqual(await revoked.json(), { error: 'signed-out' });
  assert.match(setCookies(revoked)[0]!, /^nilmail_session=; Max-Age=0/);
});

test('a Google outage is not a sign-out', async t => {
  mockGoogle(t, () => ({ status: 500, json: { error: 'backend_error' } }));
  const response = await serveAuth(post('/api/auth/token', { Cookie: await sessionFor('owner@gmail.com', 'r') }), env);
  assert.equal(response.status, 502);
  assert.deepEqual(setCookies(response), []);
});

test('sign-out revokes the token at Google and clears the cookie', async t => {
  const calls = mockGoogle(t, () => ({ json: {} }));
  const response = await serveAuth(post('/api/auth/logout', { Cookie: await sessionFor('owner@gmail.com', 'refresh-1') }), env);
  assert.equal(response.status, 204);
  assert.equal(calls[0]!.url, 'https://oauth2.googleapis.com/revoke');
  assert.equal(calls[0]!.body.get('token'), 'refresh-1');
  assert.match(setCookies(response)[0]!, /^nilmail_session=; Max-Age=0/);
});

test('POST routes answer only the app itself, and missing secrets or an empty allow-list are reported', async () => {
  const foreign = await serveAuth(post('/api/auth/token', { Origin: 'https://evil.example' }), env);
  assert.equal(foreign.status, 403);
  assert.equal((await serveAuth(new Request(`${origin}/api/auth/token`, { method: 'POST' }), env)).status, 403);
  assert.equal((await serveAuth(new Request(`${origin}/api/auth/token`), env)).status, 404, 'GET is not a route');
  const start = (overrides: Record<string, string | undefined>) =>
    serveAuth(new Request(`${origin}/api/auth/start`), { ...env, ...overrides });
  assert.equal((await serveAuth(new Request(`${origin}/api/auth/start`), {})).status, 503);
  assert.equal((await start({ SESSION_KEY: 'c2hvcnQ=' })).status, 503);
  assert.equal((await start({ ALLOWED_EMAILS: undefined })).status, 503);
  assert.equal((await start({ ALLOWED_EMAILS: ' , ' })).status, 503);
});
