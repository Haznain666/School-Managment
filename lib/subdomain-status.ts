import type { BadgeVariant } from '@/components/ui/Badge';

/**
 * How a school's subdomain state is presented, in one place.
 *
 * The status is written by two API routes and read by at least two screens.
 * Keeping the label, the colour and the "can this be retried" rule together is
 * what stops a row rendering a red "Failed" badge beside a disabled retry
 * button, or a green "Ready" beside a recorded error.
 *
 * Deliberately dependency-free apart from the badge's own type: this is
 * imported into client components and must not drag anything server-only into
 * the browser bundle.
 */

export type SubdomainStatus =
  | 'pending'
  | 'provisioning'
  | 'ready'
  | 'failed'
  | 'throttled'
  | 'unmanaged';

export interface SubdomainStatusDescriptor {
  label: string;
  variant: BadgeVariant;
  /** One sentence an operator can act on. */
  hint: string;
  /** False where pressing retry could not change anything. */
  retryable: boolean;
}

const DESCRIPTORS: Record<SubdomainStatus, SubdomainStatusDescriptor> = {
  pending: {
    label: 'Not provisioned',
    variant: 'neutral',
    hint: 'This school predates automatic provisioning, or its subdomain has never been requested. Provision it to create the record.',
    retryable: true,
  },
  provisioning: {
    label: 'Provisioning',
    variant: 'warning',
    hint: 'The subdomain exists at the host. DNS and the HTTPS certificate usually finish within a few minutes — check again to confirm.',
    retryable: true,
  },
  ready: {
    label: 'Ready',
    variant: 'success',
    hint: 'The subdomain resolves and is serving this school over HTTPS.',
    retryable: true,
  },
  failed: {
    label: 'Failed',
    variant: 'danger',
    hint: 'The last attempt did not succeed. Retrying is safe — provisioning never deletes an existing domain.',
    retryable: true,
  },
  throttled: {
    label: 'Rate limited',
    variant: 'warning',
    hint: 'Hostinger is rate-limiting this account, so the last attempt was not completed. Nothing is wrong with the request and nothing was lost — press Provision again in a minute.',
    /*
     * Warning, not danger, and that colour is the whole point of this status.
     *
     * A 429 is the host saying "not now", and the module used to record it as
     * `failed` with the raw JSON body beside it. The one school on the live
     * deployment therefore carried a red badge reading
     * `Hostinger refused the request (HTTP 429). { "message": "Too Many
     * Attempts.", "correlation_id": … }` — which sends an operator looking for
     * a misconfiguration that does not exist, in a request that was correct and
     * would have succeeded seconds later.
     */
    retryable: true,
  },
  unmanaged: {
    label: 'Manual',
    variant: 'neutral',
    hint: 'No hosting API token was configured when this was last attempted. Set HOSTINGER_API_TOKEN and HOSTINGER_USERNAME, then press Provision — otherwise this subdomain has to be created by hand in the hosting panel.',
    /*
     * Retryable, and this reversed on 2026-08-16.
     *
     * It was `false`, on the reasoning that retrying without a token returns
     * `unmanaged` again and the button would only teach an operator that it
     * does nothing. That was right about a single request and wrong about the
     * lifetime of a deployment: `unmanaged` records the state at the *last
     * attempt*, not a permanent property of the platform. The moment somebody
     * sets the token — which is the entire reason those variables are in
     * `.env.example` — every school already sitting at `unmanaged` had no
     * control on any screen that could provision it, and the only ways out
     * were the hosting panel or a hand-edited row.
     *
     * Four schools were in exactly that state when this was found. Provisioning
     * is idempotent and never deletes, so a press with no token still costs
     * nothing but one round trip and leaves the row as it was.
     */
    retryable: true,
  },
};

export function describeSubdomainStatus(
  status: string | null | undefined,
): SubdomainStatusDescriptor {
  return DESCRIPTORS[(status ?? 'pending') as SubdomainStatus] ?? DESCRIPTORS.pending;
}
