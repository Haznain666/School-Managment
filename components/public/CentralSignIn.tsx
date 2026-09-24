'use client';

import { useCallback, useState, type FormEvent } from 'react';

import { PasswordField } from '@/components/school/PasswordField';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';

/**
 * The one sign-in form on the apex — Sprint 35, §7.
 *
 * A client component posting to `/api/platform/sign-in`, so the page around it
 * stays prerendered (CLAUDE.md, "do not make a static page dynamic by
 * accident"): nothing here reads a cookie, a header or a query parameter on
 * the server.
 *
 * Three outcomes: a super admin is sent to the panel; a person at one school is
 * sent to that school's own address with a single-use hand-off; a person at
 * several picks one from a list of school logos and names, and then is sent.
 * Every failure is one sentence, from the server, and says nothing about which
 * part was wrong.
 */

interface Envelope<T> {
  ok: boolean;
  data?: T;
  error?: { code?: string; message: string };
}

type SignInResult =
  | { kind: 'super_admin'; redirectTo: string }
  | { kind: 'redirect'; url: string; schoolName: string }
  | {
      kind: 'choose';
      chooserToken: string;
      entities: { schoolId: string; name: string; logoUrl: string | null; roleLabel: string }[];
    };

async function post<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  let payload: Envelope<T>;
  try {
    payload = (await response.json()) as Envelope<T>;
  } catch {
    throw new Error(
      response.status >= 500
        ? `The server is not responding (${String(response.status)}). Try again in a moment.`
        : 'The server returned an unexpected response.',
    );
  }

  if (!response.ok || payload.ok !== true || payload.data === undefined) {
    throw new Error(payload.error?.message ?? 'Sign-in failed.');
  }
  return payload.data;
}

export function CentralSignIn() {
  const [loginId, setLoginId] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [choice, setChoice] = useState<Extract<SignInResult, { kind: 'choose' }> | null>(null);
  const [going, setGoing] = useState<string | null>(null);

  const submit = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      setBusy(true);
      setError(null);

      try {
        const result = await post<SignInResult>('/api/platform/sign-in', { loginId, password });
        if (result.kind === 'super_admin') {
          window.location.assign(result.redirectTo);
          return;
        }
        if (result.kind === 'redirect') {
          setGoing(result.schoolName);
          window.location.assign(result.url);
          return;
        }
        setPassword('');
        setChoice(result);
        setBusy(false);
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : 'Sign-in failed.');
        setBusy(false);
      }
    },
    [loginId, password],
  );

  const choose = useCallback(
    async (schoolId: string, name: string) => {
      if (choice === null) return;
      setBusy(true);
      setError(null);
      try {
        const result = await post<{ url: string }>('/api/platform/handoff', {
          chooserToken: choice.chooserToken,
          schoolId,
        });
        setGoing(name);
        window.location.assign(result.url);
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : 'Could not open that school.');
        setBusy(false);
      }
    },
    [choice],
  );

  if (going !== null) {
    return (
      <p role="status" className="text-sm text-ink-muted">
        Opening {going}…
      </p>
    );
  }

  if (choice !== null) {
    return (
      <div className="space-y-4">
        <div>
          <h2 className="text-base font-semibold text-ink">Choose where to go</h2>
          <p className="mt-1 text-sm text-ink-muted">Your account belongs to more than one school.</p>
        </div>

        <ul className="space-y-2">
          {choice.entities.map((entity) => (
            <li key={entity.schoolId}>
              <button
                type="button"
                disabled={busy}
                onClick={() => void choose(entity.schoolId, entity.name)}
                className="flex w-full items-center gap-3 rounded-card border border-line bg-surface-raised p-3 text-left transition hover:border-brand-primary hover:shadow-card disabled:opacity-60"
              >
                {entity.logoUrl !== null && entity.logoUrl !== '' ? (
                  // School logos are whatever shape the school uploaded; a
                  // plain <img> avoids forcing one, exactly as the branded
                  // login layout does.
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={entity.logoUrl}
                    alt=""
                    className="h-10 w-10 shrink-0 rounded-lg object-contain"
                  />
                ) : (
                  <span
                    aria-hidden="true"
                    className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-brand-primarySubtle text-sm font-bold text-brand-onPrimarySubtle"
                  >
                    {entity.name.slice(0, 2).toUpperCase()}
                  </span>
                )}
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium text-ink">{entity.name}</span>
                  <span className="block text-xs text-ink-muted">{entity.roleLabel}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>

        {error !== null ? (
          <p role="alert" className="text-sm text-status-danger-ink">
            {error}
          </p>
        ) : null}

        <button
          type="button"
          className="text-sm text-ink-muted hover:text-ink"
          onClick={() => {
            setChoice(null);
            setError(null);
          }}
        >
          Use a different account
        </button>
      </div>
    );
  }

  return (
    <form className="space-y-4" onSubmit={(event) => void submit(event)} noValidate>
      <Input
        label="Login ID"
        name="loginId"
        autoComplete="username"
        autoCapitalize="none"
        spellCheck={false}
        value={loginId}
        disabled={busy}
        hint="Your email address. Students can use their student ID."
        onChange={(event) => {
          setLoginId(event.target.value);
        }}
      />
      <PasswordField
        label="Password"
        name="password"
        autoComplete="current-password"
        value={password}
        disabled={busy}
        onChange={setPassword}
      />

      {error !== null ? (
        <p role="alert" className="rounded-lg bg-status-danger-subtle px-3 py-2 text-sm text-status-danger-ink">
          {error}
        </p>
      ) : null}

      <Button
        type="submit"
        fullWidth
        isLoading={busy}
        disabled={loginId.trim() === '' || password === ''}
      >
        Sign in
      </Button>
    </form>
  );
}
