/**
 * Email address validation, to the standard the industry actually applies.
 *
 * ── What "industry standard" means here, and what it does not ────────────
 * It does not mean RFC 5322's full grammar. That grammar permits quoted local
 * parts, escaped characters, comments in parentheses and bare IP-literal
 * domains; the regex people copy off the internet to match it is ~6,000
 * characters long and still accepts `a@b`, which no mail system this product
 * will ever talk to would route. Implementing it would let through more bad
 * addresses than it caught.
 *
 * What it means is the rule every mail provider, signup form and validation
 * library converges on in practice, and which the HTML `type="email"` control
 * itself specifies: one `@`, a local part of the ordinary characters, a domain
 * of dot-separated labels, and a final label of at least two letters. That last
 * clause is the one doing the real work — it is what separates `admin@school`
 * (a typo, always) from `admin@school.edu.pk`.
 *
 * ── Why it is a module rather than an `<input type="email">` ─────────────
 * The browser control validates only when the form submits natively, and every
 * form in this application submits through `fetch`, so it validates never. And
 * the server has to make the same judgement anyway: a payload posted directly
 * bypasses the browser entirely. One implementation, imported by both, is the
 * only way the two can agree.
 */

/**
 * Practical address grammar.
 *
 *   local    one or more of the unreserved characters, dot-separated, with no
 *            leading, trailing or doubled dot
 *   @        exactly one
 *   domain   dot-separated labels of letters, digits and hyphens, each of which
 *            must start and end alphanumerically
 *   tld      at least two letters
 */
const ADDRESS =
  /^[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+)*@(?:[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?\.)+[A-Za-z]{2,}$/;

/**
 * Ceilings from RFC 5321, which is the transport limit an SMTP server enforces
 * rather than a stylistic preference. Checked separately from the pattern
 * because a length bound expressed inside a regex of this shape is unreadable,
 * and because it lets the two failures be reported differently.
 */
const MAX_LOCAL = 64;
const MAX_TOTAL = 254;

/** True when the address would be accepted by a mail system. */
export function isValidEmail(value: string): boolean {
  return emailRejectionReason(value) === null;
}

/**
 * Why an address is unacceptable, or null when it is fine.
 *
 * Returns the sentence shown to the operator. Saying which part is wrong is
 * worth the extra branches: "Enter a valid email address" against a typed
 * address tells someone only that the form disagrees with them, and the
 * commonest fault by far — a missing top-level domain — is invisible until it
 * is named.
 *
 * An empty value is *not* rejected here. Every field using this is optional at
 * some call site and required at another, and requiredness is the caller's
 * business; conflating the two would force every optional field to special-case
 * the empty string before asking.
 */
export function emailRejectionReason(value: string): string | null {
  const address = value.trim();
  if (address === '') return null;

  if (address.length > MAX_TOTAL) {
    return `That email address is too long — the limit is ${MAX_TOTAL} characters.`;
  }

  const at = address.lastIndexOf('@');
  if (at < 0) return 'An email address needs an @ — for example admin@school.edu.pk.';

  if (address.slice(0, at).length > MAX_LOCAL) {
    return `The part before the @ is too long — the limit is ${MAX_LOCAL} characters.`;
  }

  if (address.includes(' ')) return 'An email address cannot contain spaces.';

  if (!ADDRESS.test(address)) {
    const domain = address.slice(at + 1);
    if (domain !== '' && !domain.includes('.')) {
      return `“${domain}” is not a complete domain. Did you mean ${domain}.com or ${domain}.edu.pk?`;
    }
    return 'That is not a valid email address — for example admin@school.edu.pk.';
  }

  return null;
}

/** The form an address is stored and compared in. Addresses are case-insensitive. */
export function normaliseEmailAddress(value: string): string {
  return value.trim().toLowerCase();
}
