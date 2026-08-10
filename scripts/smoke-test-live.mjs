#!/usr/bin/env node

/**
 * Post-deploy verification against a LIVE origin.
 *
 *   node scripts/smoke-test-live.mjs https://schoolhub.codexmill.com
 *
 * Exits non-zero if the deployment is not healthy, so CI fails loudly rather
 * than reporting a green deploy of a broken site.
 *
 * ── Why it can prove a great deal without any credentials ────────────────
 * The sign-in route answers with a *different status for each kind of
 * misconfiguration*, and that turns a deliberately wrong password into a
 * precise health probe:
 *
 *   401 invalid_credentials  → route healthy, env present, bcrypt ran
 *   500 server_misconfigured → SUPER_ADMIN_* missing from the process
 *   429 too_many_attempts    → throttled, try later (not a deploy fault)
 *
 * That distinction is the whole diagnosis this project spent four sessions
 * failing to make by hand. Checking it on every deploy costs one request.
 *
 * ── The optional half ────────────────────────────────────────────────────
 * Given SMOKE_SUPER_ADMIN_EMAIL and SMOKE_SUPER_ADMIN_PASSWORD it also performs
 * a real sign-in and asserts the session cookie comes back correctly attributed.
 * Neither value is ever printed. Leave them unset and everything else still
 * runs — the credential-free checks already catch the failure this project
 * actually had.
 */

const origin = (process.argv[2] ?? process.env.SMOKE_ORIGIN ?? '').replace(/\/$/, '');

if (origin === '') {
  console.error('Usage: node scripts/smoke-test-live.mjs https://your-domain');
  process.exit(2);
}

let failures = 0;
let warnings = 0;

function pass(label, detail = '') {
  console.log(`  PASS  ${label}${detail === '' ? '' : ` — ${detail}`}`);
}

function fail(label, detail) {
  failures += 1;
  console.log(`  FAIL  ${label} — ${detail}`);
}

function warn(label, detail) {
  warnings += 1;
  console.log(`  WARN  ${label} — ${detail}`);
}

/**
 * Never follows redirects: where it points is often the thing being tested.
 *
 * `connection: close` is not decoration. Node's fetch keeps sockets alive for
 * several seconds afterwards, and calling `process.exit()` while they are open
 * aborts the process on Windows —
 * `Assertion failed: !(handle->flags & UV_HANDLE_CLOSING)` — which surfaced as
 * exit code 127 instead of the intended 1. A verifier whose own exit code is
 * unreliable is worse than no verifier, since CI reads exactly that number.
 * Closing each connection lets the loop drain and the process end on its own.
 */
async function request(path, init = {}) {
  const headers = { connection: 'close', ...(init.headers ?? {}) };
  return fetch(`${origin}${path}`, { redirect: 'manual', ...init, headers });
}

console.log(`\nSmoke test against ${origin}\n${'='.repeat(60)}`);

// -- 1. Is anything serving? --------------------------------------------------
console.log('\n1. Reachability');
try {
  const response = await request('/super-admin/login');

  if (response.status === 200) {
    pass('GET /super-admin/login', 'HTTP 200');
  } else {
    fail('GET /super-admin/login', `HTTP ${String(response.status)}, expected 200`);
  }

  if (!origin.startsWith('https://')) {
    // The session cookie carries `Secure` in production, so a browser will
    // silently discard it over plain http and every sign-in will appear to
    // succeed and then not stick.
    warn('scheme', 'not https — the Secure session cookie will not be stored');
  }
} catch (error) {
  fail('GET /super-admin/login', `request failed: ${String(error)}`);
}

// -- 2. Is the panel actually guarded? ---------------------------------------
console.log('\n2. Authentication gate');
try {
  const response = await request('/super-admin');
  const location = response.headers.get('location') ?? '';

  if (response.status >= 300 && response.status < 400) {
    pass('GET /super-admin unauthenticated', `HTTP ${String(response.status)} redirect`);

    if (/^https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0)/i.test(location)) {
      fail(
        'redirect target',
        `points at the bind address (${location}). Set HOSTNAME=0.0.0.0 — see DEPLOYMENT.md §2`,
      );
    } else {
      pass('redirect target', location === '' ? '(relative)' : location);
    }
  } else {
    fail(
      'GET /super-admin unauthenticated',
      `HTTP ${String(response.status)} — expected a redirect to the login page`,
    );
  }
} catch (error) {
  fail('GET /super-admin', `request failed: ${String(error)}`);
}

// -- 3. The credential-free configuration probe ------------------------------
console.log('\n3. Super Admin configuration (deliberately wrong password)');
try {
  const response = await request('/api/super-admin/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: 'smoke-test-not-a-real-account@example.invalid',
      password: 'deliberately-wrong-password-for-the-smoke-test',
    }),
  });

  const payload = await response.json().catch(() => null);
  const code = payload?.error?.code ?? '(no code)';

  if (response.status === 401 && code === 'invalid_credentials') {
    pass('login route', 'HTTP 401 invalid_credentials — env present, bcrypt ran');
  } else if (response.status === 500 && code === 'server_misconfigured') {
    fail(
      'login route',
      'HTTP 500 server_misconfigured — SUPER_ADMIN_EMAIL, SUPER_ADMIN_PASSWORD_HASH ' +
        'or SUPER_ADMIN_JWT_SECRET is missing from the running process',
    );
  } else if (response.status === 429) {
    warn('login route', 'HTTP 429 throttled — cannot probe right now, retry in 15 minutes');
  } else {
    fail('login route', `HTTP ${String(response.status)} ${code} — unexpected`);
  }
} catch (error) {
  fail('login route', `request failed: ${String(error)}`);
}

// -- 4. A real sign-in, when credentials were supplied -----------------------
const email = process.env.SMOKE_SUPER_ADMIN_EMAIL ?? '';
const password = process.env.SMOKE_SUPER_ADMIN_PASSWORD ?? '';

console.log('\n4. Real sign-in');
if (email === '' || password === '') {
  console.log(
    '  SKIP  set SMOKE_SUPER_ADMIN_EMAIL and SMOKE_SUPER_ADMIN_PASSWORD to enable',
  );
} else {
  try {
    const response = await request('/api/super-admin/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });

    const payload = await response.json().catch(() => null);

    if (response.status === 200 && payload?.ok === true) {
      pass('sign-in', 'HTTP 200');

      const cookie = response.headers.get('set-cookie') ?? '';

      if (cookie.includes('super_admin_session=')) {
        pass('session cookie', 'issued');
      } else {
        fail('session cookie', 'no super_admin_session in Set-Cookie');
      }

      for (const attribute of ['HttpOnly', 'Secure', 'SameSite']) {
        if (new RegExp(attribute, 'i').test(cookie)) {
          pass(`cookie ${attribute}`);
        } else {
          fail(`cookie ${attribute}`, 'missing — the session will not be safe or will not stick');
        }
      }
    } else {
      // The exact failure this whole exercise was about.
      fail(
        'sign-in',
        `HTTP ${String(response.status)} ${payload?.error?.code ?? ''} — ` +
          'check the boot log for "[super-admin] SUPER_ADMIN_PASSWORD_HASH IS MALFORMED"',
      );
    }
  } catch (error) {
    fail('sign-in', `request failed: ${String(error)}`);
  }
}

// -- Verdict -----------------------------------------------------------------
// `process.exitCode` rather than `process.exit()`: setting the code and letting
// the event loop drain cannot race with sockets still closing, which is what
// turned a clean "1" into a crash and a 127. See `request` above.
console.log(`\n${'='.repeat(60)}`);

if (failures === 0) {
  console.log(
    `DEPLOYMENT HEALTHY${warnings > 0 ? ` (${String(warnings)} warning(s))` : ''}\n`,
  );
  process.exitCode = 0;
} else {
  console.log(`DEPLOYMENT NOT HEALTHY — ${String(failures)} failure(s)\n`);
  process.exitCode = 1;
}
