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
  unmanaged: {
    label: 'Manual',
    variant: 'neutral',
    hint: 'No hosting API token is configured on this deployment, so subdomains are created by hand in the hosting panel.',
    // Nothing is broken and nothing would change: retrying without a token
    // returns `unmanaged` again. Offering the button would only teach the
    // operator that it does nothing.
    retryable: false,
  },
};

export function describeSubdomainStatus(
  status: string | null | undefined,
): SubdomainStatusDescriptor {
  return DESCRIPTORS[(status ?? 'pending') as SubdomainStatus] ?? DESCRIPTORS.pending;
}
