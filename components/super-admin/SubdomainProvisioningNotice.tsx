import { Card } from '@/components/ui/Card';
import { isHostingerConfigured, subdomainFor } from '@/lib/hostinger';

/**
 * Says, on the screen where schools are created, whether their subdomains will
 * be created with them.
 *
 * ── Why this is worth a card ─────────────────────────────────────────────
 * Automatic provisioning is off whenever `HOSTINGER_API_TOKEN` and
 * `HOSTINGER_USERNAME` are unset, and when it is off a school is created
 * successfully, is handed a URL, and that URL does not resolve. Every part of
 * that sequence looks like it worked. The only signal was a "Manual" badge in a
 * table column, which reads as a category rather than as a warning.
 *
 * The failure this prevents is a real one and it cost a session: the platform
 * was assumed broken because new schools were unreachable, when in fact nothing
 * was broken and two variables were missing.
 *
 * ── It names the variables, and does not print their values ──────────────
 * The token is a secret; whether a token *exists* is not. `isHostingerConfigured`
 * returns a boolean and nothing here can render a credential.
 *
 * ── On wildcard DNS ──────────────────────────────────────────────────────
 * The note about a wildcard record is not padding. It is the thing an operator
 * reaches for first — one `*.` record looks like it should remove the need for
 * per-school provisioning entirely — and on this host it does not work:
 * hostnames are matched per vhost and TLS is issued per hostname, so an alias
 * that was never created fails the handshake before any request is made.
 * Measured against the live deployment on 2026-08-16; see `STATE.md` §5ad.
 */
export function SubdomainProvisioningNotice() {
  const configured = isHostingerConfigured();
  const example = subdomainFor('abc-school');

  if (configured) {
    return (
      <Card>
        <p className="text-sm text-ink">
          <span className="font-medium">Subdomains are provisioned automatically.</span>{' '}
          A new school is aliased onto the platform website as it is created, so{' '}
          {example === null ? (
            'its slug-based hostname'
          ) : (
            <span className="font-mono">{example}</span>
          )}{' '}
          starts serving once DNS and its certificate settle — usually about
          three minutes.
        </p>
      </Card>
    );
  }

  return (
    <Card>
      <p className="text-sm font-medium text-status-warning-ink">
        Subdomains are not being created automatically.
      </p>
      <p className="mt-2 text-sm text-ink-muted">
        A school created now will save correctly and its portal will not be
        reachable, because nothing creates{' '}
        {example === null ? (
          'its hostname'
        ) : (
          <span className="font-mono">{example}</span>
        )}{' '}
        at the host. Set both of these in the hosting panel&rsquo;s Environment
        section and restart:
      </p>
      <ul className="mt-2 space-y-1 text-sm text-ink">
        <li>
          <span className="font-mono">HOSTINGER_API_TOKEN</span>
        </li>
        <li>
          <span className="font-mono">HOSTINGER_USERNAME</span>
        </li>
      </ul>
      <p className="mt-3 text-sm text-ink-muted">
        Then press <strong>Provision</strong> on each school below that is not
        yet Ready. Provisioning is idempotent and never deletes a domain, so it
        is safe to press more than once.
      </p>
      <p className="mt-3 text-sm text-ink-muted">
        A wildcard <span className="font-mono">*</span> DNS record does not
        replace this. It points every name at the right server, but the server
        matches hostnames per site and issues one certificate per hostname — a
        name that was never aliased fails the HTTPS handshake before the request
        reaches this application.
      </p>
    </Card>
  );
}
