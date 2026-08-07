import 'server-only';

import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { createClient, type SupabaseClient, type User } from '@supabase/supabase-js';
import { cookies } from 'next/headers';

import { requireServerEnv, serverEnv } from './env';

/**
 * Supabase Auth (GoTrue) — the identity provider for the school portals.
 *
 * ── Why GoTrue does the verifying now ────────────────────────────────────
 * Until Stage 4 this application verified every credential itself — the
 * WhatsApp passcode, the invite token, the emergency token — and only asked
 * Firebase to *mint* a session for someone it had already authenticated, with
 * `createCustomToken`. Supabase has no equivalent of that call, which is what
 * made the earlier magic-link design so convoluted.
 *
 * Moving to email + password removes the problem rather than working around
 * it: `signInWithPassword` means GoTrue holds the password hash and answers
 * the question. This repo no longer owns any password-verification code.
 *
 * ── One account per person, not one per person per school ────────────────
 * A Supabase `auth.users.email` is globally unique, so it cannot express "the
 * same address is a teacher at School A and a parent at School B". The prior
 * `claude/school-email-auth-7f5vuh` branch solved that by giving each school
 * its own derived account, and STATE.md §5b assumed synthetic per-school
 * addresses for the same reason.
 *
 * Both are rejected here. A synthetic address cannot receive the signup OTP
 * that GoTrue itself sends, which is the whole point of using GoTrue. So:
 *
 *   **one Supabase account per human, and membership lives in `school_users`.**
 *
 * The tenant is not a property of the credential. It comes from the subdomain,
 * which middleware has already resolved, and the pair
 * (`locationId`, `auth_user_id`) selects the one `school_users` row that says
 * what this person may do *here*. One password, two schools, two roles.
 *
 * This is also what STATE.md §3 asked for — "authorization data stays in
 * `school_users`, not in the token" — and it retires hazard §4.3 outright:
 * there are no role claims in the JWT to go stale, so a role change takes
 * effect on the very next request.
 *
 * ── What `app_metadata` is still used for ────────────────────────────────
 * Exactly one thing: marking the per-school platform-operator accounts behind
 * the Super Admin's "Login as Admin" hand-off. Those have no `school_users`
 * row by design (see the absent-row note in `lib/school-auth.ts`), so their
 * claims have nowhere else to live. `app_metadata` is writable only with the
 * service-role key, which is what makes it safe to trust.
 */

/** Raised when Supabase Auth is unreachable, misconfigured, or refuses a call. */
export class SupabaseAuthError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'SupabaseAuthError';
    this.code = code;
  }
}

function projectUrl(): string {
  return requireServerEnv('SUPABASE_URL').trim().replace(/\/+$/, '');
}

/**
 * The cookie the browser actually carries.
 *
 * `@supabase/ssr` owns the format — it may chunk a large session across
 * `<name>.0`, `<name>.1` — but the stem stays the value of
 * `SCHOOL_SESSION_COOKIE_NAME`, so the name did not change when the provider
 * did, and neither did the logout route's job.
 */
export function sessionCookieName(): string {
  return serverEnv('SCHOOL_SESSION_COOKIE_NAME', 'school_session');
}

/** Cookie attributes shared by every route that writes the session. */
export function sessionCookieOptions(): CookieOptions {
  return {
    httpOnly: true,
    sameSite: 'lax',
    // Secure everywhere except local http development.
    secure: process.env.NODE_ENV === 'production',
    path: '/',
  };
}

/**
 * The service-role client. Never reachable from a browser: this module is
 * `server-only` and the key is read from a non-`NEXT_PUBLIC_` variable.
 *
 * `persistSession` and `autoRefreshToken` are off because this client is not
 * a signed-in user — it is the admin credential, used per call and discarded.
 * Leaving them on makes it try to write a session to a store that does not
 * exist on a server.
 */
let adminClient: SupabaseClient | null = null;

export function getAuthAdmin(): SupabaseClient {
  if (adminClient !== null) return adminClient;

  adminClient = createClient(projectUrl(), requireServerEnv('SUPABASE_SERVICE_ROLE_KEY'), {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });

  return adminClient;
}

/**
 * A request-scoped client bound to the session cookie.
 *
 * `getAll`/`setAll` are wired to Next's cookie store, so GoTrue can rotate a
 * refresh token mid-request and the new one is written back without any call
 * site knowing. `setAll` throws inside a Server Component — Next forbids
 * writing cookies there — and that is swallowed on purpose: a layout only
 * *reads* the session, and the next route handler or Server Action will
 * perform the same refresh in a context that may write.
 */
export async function getSessionClient(): Promise<SupabaseClient> {
  const store = await cookies();

  return createServerClient(
    projectUrl(),
    requireServerEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY'),
    {
      cookieOptions: { name: sessionCookieName(), ...sessionCookieOptions() },
      cookies: {
        getAll: () => store.getAll(),
        setAll: (list) => {
          try {
            for (const { name, value, options } of list) {
              store.set(name, value, options);
            }
          } catch {
            // Read-only cookie store (Server Component). See the docblock.
          }
        },
      },
    },
  );
}

/**
 * The signed-in user, verified against Supabase.
 *
 * `getUser()` rather than `getSession()` deliberately: `getSession` returns
 * whatever the cookie claims without checking it, which is a forgery away from
 * being no check at all. `getUser` validates the access token with the auth
 * server. Every authorization decision in this codebase starts from this call.
 */
export async function getAuthenticatedUser(): Promise<User | null> {
  const client = await getSessionClient();
  const { data, error } = await client.auth.getUser();
  return error !== null || data.user === null ? null : data.user;
}

/** Normalises an address the way every lookup and every derivation must. */
export function normaliseEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * Signs in with email and password, writing the session cookie as a side
 * effect of the bound client.
 *
 * Returns null for any failure — wrong password, unknown address, unconfirmed
 * account. They are deliberately indistinguishable to the caller so the login
 * route cannot be turned into an account-enumeration oracle.
 */
export async function signInWithPassword(
  email: string,
  password: string,
): Promise<User | null> {
  const client = await getSessionClient();

  const { data, error } = await client.auth.signInWithPassword({
    email: normaliseEmail(email),
    password,
  });

  return error !== null ? null : data.user;
}

/** Clears the session with GoTrue and drops the cookie. */
export async function signOutCurrentSession(): Promise<void> {
  const client = await getSessionClient();
  await client.auth.signOut();
}

/**
 * Mints a session for an address without presenting its password, entirely
 * server-side.
 *
 * This is the one thing `signInWithPassword` cannot do, and two flows need it:
 * the Super Admin hand-off and the emergency-login link. Both have already
 * authenticated the caller by a token signed with the platform's own secret,
 * so what is wanted is a session for an *already-authenticated* person — the
 * exact shape Firebase's `createCustomToken` provided.
 *
 * `generateLink` produces a `token_hash` without sending any mail; `verifyOtp`
 * on the cookie-bound client redeems it and writes the session. Nothing is
 * emailed and nothing reaches the browser but the cookie.
 *
 * The rejected alternative, for the record: setting a random password and
 * calling `signInWithPassword`. It works, but it writes a real credential that
 * briefly exists and must be kept secret from the account's own owner.
 */
export async function mintSessionForEmail(email: string): Promise<User | null> {
  const address = normaliseEmail(email);

  const { data, error } = await getAuthAdmin().auth.admin.generateLink({
    type: 'magiclink',
    email: address,
  });

  if (error !== null || data.properties === null) {
    throw new SupabaseAuthError(
      'link_failed',
      `Supabase would not mint a sign-in link: ${error?.message ?? 'no link returned'}`,
    );
  }

  const client = await getSessionClient();

  const { data: verified, error: verifyError } = await client.auth.verifyOtp({
    type: 'magiclink',
    token_hash: data.properties.hashed_token,
  });

  if (verifyError !== null) {
    throw new SupabaseAuthError(
      'verify_failed',
      `Supabase rejected its own sign-in link: ${verifyError.message}`,
    );
  }

  return verified.user;
}

/**
 * Finds an auth user by address, or null.
 *
 * `listUsers` is paged and has no exact-match filter, so this walks pages
 * until it finds the address. In practice the first page answers it — the
 * callers here are the invite and platform-operator paths, which are rare and
 * not on any hot request. If the user table ever grows past a few thousand,
 * replace this with a lookup against `school_users.auth_user_id`, which is
 * indexed and is the mapping this application actually cares about.
 */
export async function findAuthUserByEmail(email: string): Promise<User | null> {
  const address = normaliseEmail(email);
  const admin = getAuthAdmin();

  for (let page = 1; page <= 20; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });

    if (error !== null) {
      throw new SupabaseAuthError('list_failed', `Supabase user lookup failed: ${error.message}`);
    }

    const match = data.users.find((user) => normaliseEmail(user.email ?? '') === address);
    if (match !== undefined) return match;
    if (data.users.length < 200) return null;
  }

  return null;
}

/**
 * Returns the auth user for an address, creating it when absent.
 *
 * `email_confirm: true` because whoever calls this has already proved the
 * address some other way — an invitation sent to it, or an operator credential
 * — and a second confirmation mail would be a dead end rather than a check.
 *
 * The create is racy by nature: two concurrent invitations to one address both
 * see "absent". A duplicate create fails, and the second lookup resolves it,
 * so the outcome is one account either way. That idempotence is load-bearing
 * for exactly the reason `deriveSchoolUid` was — a resent invite or a retried
 * request must land on the same account, or one person silently becomes two.
 */
export async function getOrCreateAuthUser(
  email: string,
  metadata: Record<string, unknown> = {},
): Promise<User> {
  const address = normaliseEmail(email);

  const existing = await findAuthUserByEmail(address);
  if (existing !== null) return existing;

  const { data, error } = await getAuthAdmin().auth.admin.createUser({
    email: address,
    email_confirm: true,
    app_metadata: metadata,
  });

  if (error === null && data.user !== null) return data.user;

  const raced = await findAuthUserByEmail(address);
  if (raced !== null) return raced;

  throw new SupabaseAuthError(
    'create_failed',
    `Supabase would not create an account for ${address}: ${error?.message ?? 'unknown error'}`,
  );
}

/** Sets or replaces an account's password. Service-role, so no old password. */
export async function setUserPassword(userId: string, password: string): Promise<void> {
  const { error } = await getAuthAdmin().auth.admin.updateUserById(userId, { password });

  if (error !== null) {
    throw new SupabaseAuthError('password_failed', `Supabase rejected the password: ${error.message}`);
  }
}

/**
 * Signs a user out of every device.
 *
 * Worth being honest about what this does and does not buy. It revokes the
 * refresh tokens, so no new access token can be minted — but an access token
 * already in flight stays valid until it expires, up to an hour. Firebase's
 * `verifySessionCookie(cookie, true)` had no such gap.
 *
 * That gap is why `isAccountActive()` in `lib/school-auth.ts` exists and why
 * it must not be removed: it re-reads `school_users.is_active` on every single
 * request, which is what actually makes deactivation instant. This call is a
 * tidy-up on top of that guarantee, not the guarantee itself.
 */
export async function revokeAllSessions(userId: string): Promise<void> {
  const { error } = await getAuthAdmin().auth.admin.signOut(userId, 'global');

  if (error !== null) {
    throw new SupabaseAuthError('signout_failed', `Supabase sign-out failed: ${error.message}`);
  }
}

/**
 * Sends a six-digit code to an address, creating the account if it is new.
 *
 * This is the signup and password-reset entry point: GoTrue sends the mail and
 * owns the code, so there is no passcode table here and no rate limiting to
 * hand-roll.
 *
 * `shouldCreateUser` is a parameter rather than a constant because the two
 * callers need opposite answers. Signup must create. Password reset must not —
 * creating an account for an unknown address would confirm to the sender that
 * it was unknown, which is the enumeration oracle this avoids.
 */
export async function sendEmailOtp(
  email: string,
  shouldCreateUser: boolean,
): Promise<void> {
  const client = await getSessionClient();

  const { error } = await client.auth.signInWithOtp({
    email: normaliseEmail(email),
    options: { shouldCreateUser },
  });

  if (error !== null) {
    throw new SupabaseAuthError('otp_send_failed', `Supabase would not send the code: ${error.message}`);
  }
}

/**
 * Redeems a six-digit code and writes the session cookie.
 * Returns null when the code is wrong or expired — the caller must not say
 * which.
 */
export async function verifyEmailOtp(email: string, token: string): Promise<User | null> {
  const client = await getSessionClient();

  const { data, error } = await client.auth.verifyOtp({
    email: normaliseEmail(email),
    token,
    type: 'email',
  });

  return error !== null ? null : data.user;
}
