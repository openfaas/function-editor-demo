import crypto from 'crypto';

const COOKIE_NAME = 'function_editor_session';
const SESSION_TTL_SECONDS = 8 * 60 * 60;

function safeEqual(left, right) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);

  return leftBuffer.length === rightBuffer.length
    && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function parseCookies(header = '') {
  return Object.fromEntries(header.split(';').flatMap((part) => {
    const separator = part.indexOf('=');
    if (separator === -1) {
      return [];
    }

    const name = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();
    return name ? [[name, decodeURIComponent(value)]] : [];
  }));
}

function sign(value, secret) {
  return crypto.createHmac('sha256', secret).update(value).digest('base64url');
}

export function createAuth({
  username,
  password,
  sessionSecret,
  secureCookies = false,
  now = () => Date.now(),
}) {
  if (!username || !password || !sessionSecret) {
    throw new Error('EDITOR_USERNAME, EDITOR_PASSWORD, and SESSION_SECRET must be set');
  }
  if (sessionSecret.length < 32) {
    throw new Error('SESSION_SECRET must contain at least 32 characters');
  }

  function createSession() {
    const payload = Buffer.from(JSON.stringify({
      username,
      expiresAt: now() + (SESSION_TTL_SECONDS * 1000),
    })).toString('base64url');

    return `${payload}.${sign(payload, sessionSecret)}`;
  }

  function readSession(req) {
    let token;
    try {
      token = parseCookies(req.headers.cookie)[COOKIE_NAME];
    } catch {
      return null;
    }
    if (!token) {
      return null;
    }

    const separator = token.lastIndexOf('.');
    if (separator === -1) {
      return null;
    }

    const payload = token.slice(0, separator);
    const signature = token.slice(separator + 1);
    if (!safeEqual(signature, sign(payload, sessionSecret))) {
      return null;
    }

    try {
      const session = JSON.parse(Buffer.from(payload, 'base64url').toString());
      return session.username === username && session.expiresAt > now() ? session : null;
    } catch {
      return null;
    }
  }

  function cookie(value, maxAge = SESSION_TTL_SECONDS) {
    const parts = [
      `${COOKIE_NAME}=${encodeURIComponent(value)}`,
      'Path=/',
      'HttpOnly',
      'SameSite=Strict',
      `Max-Age=${maxAge}`,
    ];
    if (secureCookies) {
      parts.push('Secure');
    }
    return parts.join('; ');
  }

  function login(req, res) {
    const suppliedUsername = typeof req.body?.username === 'string' ? req.body.username : '';
    const suppliedPassword = typeof req.body?.password === 'string' ? req.body.password : '';

    if (!safeEqual(suppliedUsername, username) || !safeEqual(suppliedPassword, password)) {
      return res.status(401).json({ success: false, error: 'Invalid username or password' });
    }

    res.setHeader('Set-Cookie', cookie(createSession()));
    return res.json({ success: true, username });
  }

  function logout(_req, res) {
    res.setHeader('Set-Cookie', cookie('', 0));
    return res.json({ success: true });
  }

  function status(req, res) {
    const session = readSession(req);
    return res.status(session ? 200 : 401).json({
      authenticated: Boolean(session),
      ...(session ? { username: session.username } : {}),
    });
  }

  function requireAuth(req, res, next) {
    const session = readSession(req);
    if (!session) {
      return res.status(401).json({ success: false, error: 'Authentication required' });
    }

    req.user = { username: session.username };
    return next();
  }

  return { login, logout, status, requireAuth };
}
