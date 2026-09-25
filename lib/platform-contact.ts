/**
 * The address a school writes to when it needs the platform, not its own
 * office: a suspended account, an invoice with no bank account on file.
 *
 * One constant rather than a string in each screen, because it has already
 * changed once — `contact@codexmill.com` until the move to getschoolhub.com
 * on 2026-09-26 — and a copy left behind is a school writing to a mailbox
 * nobody reads.
 */
export const PLATFORM_SUPPORT_EMAIL = 'support@getschoolhub.com';
