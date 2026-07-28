import assert from 'node:assert/strict';
import test from 'node:test';
import { createAuth } from './auth.js';

function response() {
  return {
    statusCode: 200,
    headers: {},
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    setHeader(name, value) {
      this.headers[name] = value;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };
}

function configuredAuth(overrides = {}) {
  return createAuth({
    username: 'admin',
    password: 'correct horse',
    sessionSecret: 'a-long-random-session-secret-for-tests',
    now: () => 1_000_000,
    ...overrides,
  });
}

test('rejects missing authentication configuration', () => {
  assert.throws(
    () => createAuth({ username: 'admin', password: '', sessionSecret: '' }),
    /must be set/,
  );
});

test('rejects a short session signing secret', () => {
  assert.throws(
    () => createAuth({ username: 'admin', password: 'password', sessionSecret: 'too-short' }),
    /at least 32 characters/,
  );
});

test('login rejects invalid credentials without setting a cookie', () => {
  const res = response();
  configuredAuth().login(
    { body: { username: 'admin', password: 'wrong' } },
    res,
  );

  assert.equal(res.statusCode, 401);
  assert.equal(res.headers['Set-Cookie'], undefined);
});

test('login creates an HttpOnly cookie accepted by protected routes', () => {
  const auth = configuredAuth();
  const loginResponse = response();
  auth.login(
    { body: { username: 'admin', password: 'correct horse' } },
    loginResponse,
  );

  const setCookie = loginResponse.headers['Set-Cookie'];
  assert.match(setCookie, /HttpOnly/);
  assert.match(setCookie, /SameSite=Strict/);
  assert.doesNotMatch(setCookie, /Secure/);

  const req = { headers: { cookie: setCookie.split(';')[0] } };
  let called = false;
  auth.requireAuth(req, response(), () => {
    called = true;
  });

  assert.equal(called, true);
  assert.deepEqual(req.user, { username: 'admin' });
});

test('rejects tampered and expired session cookies', () => {
  const auth = configuredAuth();
  const loginResponse = response();
  auth.login(
    { body: { username: 'admin', password: 'correct horse' } },
    loginResponse,
  );
  const cookie = loginResponse.headers['Set-Cookie'].split(';')[0];

  const tamperedResponse = response();
  auth.requireAuth(
    { headers: { cookie: `${cookie}x` } },
    tamperedResponse,
    () => assert.fail('tampered session passed'),
  );
  assert.equal(tamperedResponse.statusCode, 401);

  const expiredAuth = configuredAuth({ now: () => 1_000_000 + (9 * 60 * 60 * 1000) });
  const expiredResponse = response();
  expiredAuth.requireAuth(
    { headers: { cookie } },
    expiredResponse,
    () => assert.fail('expired session passed'),
  );
  assert.equal(expiredResponse.statusCode, 401);
});

test('logout expires the session cookie', () => {
  const res = response();
  configuredAuth().logout({}, res);

  assert.match(res.headers['Set-Cookie'], /Max-Age=0/);
});
