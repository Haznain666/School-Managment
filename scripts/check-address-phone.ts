/**
 * The address and phone protocol, asserted — including for pages not yet written.
 *
 * ── The rule ─────────────────────────────────────────────────────────────
 * Every address input in this product is `AddressAutocomplete`. Every phone
 * input is `PhoneField`. Not "should be": *is*, and this script is what keeps
 * that true after the session that rolled it out has ended.
 *
 * The requirement was explicit that it applies "on all the pages, existing and
 * in future". A rollout answers the first half. Only a check answers the second
 * half — the next person to add a staff form will reach for `<Input
 * label="Phone" />` because that is what every other field on their form looks
 * like, and nothing about a green build would tell them otherwise.
 *
 * ── Two halves ───────────────────────────────────────────────────────────
 * 1. **Behaviour.** The kind helpers in `lib/phone-formats.ts` are asserted
 *    directly: the masks, the ceiling, the switch between them, and above all
 *    `detectPhoneKind`, which is the piece that lets the dropdown exist without
 *    a `phone_kind` column and is therefore the piece whose failure would be
 *    silent.
 *
 * 2. **Reach.** Every `.tsx` under `app/` and `components/` is scanned for a
 *    raw `<Input>` or `<Textarea>` whose literal label names a phone or an
 *    address. That is a static scan of source text rather than of a parsed
 *    tree, which is crude and is the right amount of machinery here: the thing
 *    being prevented is somebody *typing the obvious wrong thing*, and the
 *    obvious wrong thing is spelled exactly one way.
 *
 * ── The one exemption, and why it is narrow ──────────────────────────────
 * School and Branch carry two always-visible fields, "Landline" and "Mobile
 * phone", against two separate columns. They predate the dropdown and are
 * better than it for those records: a campus has both numbers and a dropdown
 * would force a choice between them. They are exempt only while their own
 * props call `formatMobile(` or `formatLandline(` — so the exemption is for a
 * field that already enforces the masks, not for a filename. Delete the mask
 * and the exemption goes with it.
 *
 *   npm run check-address-phone
 *
 * Exit code 1 on any violation.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

import {
  LANDLINE_HINT,
  MOBILE_HINT,
  detectPhoneKind,
  formatPhoneOfKind,
  hasCompletePhoneDigits,
  isValidPhoneOfKind,
  phoneErrorOfKind,
  phoneHintOfKind,
  phonePlaceholderOfKind,
  PHONE_KIND_OPTIONS,
} from '../lib/phone-formats';

let failures = 0;
let checks = 0;

function ok(condition: boolean, description: string): void {
  checks += 1;
  if (condition) return;
  failures += 1;
  console.log(`  ✗ ${description}`);
}

function section(title: string): void {
  console.log(`\n=== ${title} ===`);
}

/* -----------------------------------------------------------------------------
 * 1. The masks, under the kind that selects them.
 * -------------------------------------------------------------------------- */
section('Masks by kind');

ok(
  formatPhoneOfKind('mobile', '03211234567') === '(0321) 123-4567',
  'mobile masks 4-3-4',
);
ok(
  formatPhoneOfKind('landline', '0213456789') === '(021) 3456789',
  'landline splits after the area code',
);
ok(
  formatPhoneOfKind('mobile', '(0321) abc 123-4567!!') === '(0321) 123-4567',
  'letters and punctuation are discarded, not rejected — digits only',
);
ok(
  formatPhoneOfKind('landline', '021-345-678-9') === '(021) 3456789',
  'a landline typed with dashes lands in the display form',
);
ok(
  formatPhoneOfKind('mobile', '+92 321 1234567') === '(0321) 123-4567',
  'a pasted +92 number is rewritten to trunk form rather than refused',
);
ok(
  formatPhoneOfKind('mobile', '0321123456789999') === '(0321) 123-4567',
  'mobile is fixed at eleven digits; the rest are dropped',
);
ok(
  formatPhoneOfKind('landline', '02134567890123456') === '(021) 3456789012',
  'landline accepts up to ten digits after the area code and no more',
);
ok(
  formatPhoneOfKind('mobile', '') === '' && formatPhoneOfKind('landline', '') === '',
  'an empty field formats to empty, never to a lone bracket',
);

/* -----------------------------------------------------------------------------
 * 2. Validation, per kind.
 * -------------------------------------------------------------------------- */
section('Validation by kind');

ok(isValidPhoneOfKind('mobile', '(0321) 123-4567'), 'the mobile display form passes');
ok(
  !isValidPhoneOfKind('mobile', '0321-1234567'),
  'eleven correct digits in the wrong shape are still refused — the format is the spec',
);
ok(
  !isValidPhoneOfKind('mobile', '(0321) 123-456'),
  'ten digits is not a mobile',
);
ok(
  !isValidPhoneOfKind('mobile', '(3211) 234-5678'),
  'eleven digits without the trunk 0 is a number missing its prefix',
);
ok(isValidPhoneOfKind('landline', '(021) 3456789'), 'the landline display form passes');
ok(
  !isValidPhoneOfKind('landline', '(021) '),
  'an area code alone is a number nobody can ring',
);
ok(
  isValidPhoneOfKind('mobile', '') && isValidPhoneOfKind('landline', ''),
  'empty passes both — the field is optional wherever it appears',
);
ok(
  hasCompletePhoneDigits('landline', '0213456789') &&
    !hasCompletePhoneDigits('landline', '021'),
  'the digits-only check is the one the server asks, and ignores the brackets',
);

/* -----------------------------------------------------------------------------
 * 3. detectPhoneKind — the reason no table gained a `phone_kind` column.
 *
 * Every one of these is a value that already exists in the database or arrives
 * from an import, written before the dropdown existed. If the kind is derived
 * wrongly the field silently re-masks a stored number into a different one.
 * -------------------------------------------------------------------------- */
section('Kind detection');

ok(detectPhoneKind('(0321) 123-4567') === 'mobile', 'a masked mobile detects as mobile');
ok(detectPhoneKind('(021) 3456789') === 'landline', 'a masked landline detects as landline');
ok(
  detectPhoneKind('03001234567') === 'mobile',
  'bare eleven digits starting 03 are a mobile, not a 3-digit area code',
);
ok(
  detectPhoneKind('+923001234567') === 'mobile',
  'an E.164 number from the identity path detects as mobile',
);
ok(detectPhoneKind('0423530000') === 'landline', 'a bare landline detects as landline');
ok(detectPhoneKind('') === 'mobile', 'an empty field starts on the stricter mask');
ok(detectPhoneKind('(0321') === 'mobile', 'a half-typed mobile keeps its own mask');

// The round trip is the property that matters: a stored value, put under its
// own detected kind, must come back unchanged. Anything else silently rewrites
// data on load.
for (const stored of ['(0321) 123-4567', '(021) 3456789', '(042) 35300000']) {
  ok(
    formatPhoneOfKind(detectPhoneKind(stored), stored) === stored,
    `a stored "${stored}" survives being reloaded under its detected kind`,
  );
}

/* -----------------------------------------------------------------------------
 * 4. What the field shows.
 * -------------------------------------------------------------------------- */
section('Field copy');

ok(PHONE_KIND_OPTIONS.length === 2, 'the dropdown offers exactly two kinds');
ok(
  PHONE_KIND_OPTIONS[0]?.value === 'mobile' && PHONE_KIND_OPTIONS[1]?.value === 'landline',
  'Mobile leads, because it is the common case',
);
ok(
  phonePlaceholderOfKind('mobile') === '(0321) 123-4567' &&
    phonePlaceholderOfKind('landline') === '(021) 3456789',
  'each kind places its own example in the field',
);
ok(
  phoneHintOfKind('mobile') === MOBILE_HINT &&
    phoneHintOfKind('landline') === LANDLINE_HINT,
  'the hint states the format for the selected kind',
);
ok(
  phoneErrorOfKind('mobile') !== phoneErrorOfKind('landline'),
  'the two kinds fail with different messages',
);

/* -----------------------------------------------------------------------------
 * 5. Reach — no raw field anywhere names a phone or an address.
 * -------------------------------------------------------------------------- */
section('Every address and phone field uses the shared component');

const ROOTS = ['app', 'components'];

/** The components a raw `<Input>`/`<Textarea>` must not be used in place of. */
const ADDRESS_COMPONENT = 'AddressAutocomplete';
const PHONE_COMPONENT = 'PhoneField';

/** Names that make a field an address field, or a phone field. */
const ADDRESS_LABEL = /address/i;
const PHONE_LABEL = /phone|mobile|landline|cell/i;

/**
 * The other things called an "address" in this product.
 *
 * "Email address", and the subdomain box on the panel chooser — "Your school's
 * address", which is a *web* address and takes a slug. Matched against the
 * label and the props together, because the label alone does not distinguish
 * the second case and `value={slug}` does.
 */
const NOT_POSTAL = /e-?mail|slug|subdomain|domain|url|website|ip/i;

/**
 * The shared components themselves, which necessarily render the raw inputs
 * this scan looks for. Their labels are props rather than literals, so they
 * would not match anyway — listed so that a future edit which *did* hard-code
 * a label there does not fail with a baffling message.
 */
const SELF = new Set([
  join('components', 'ui', 'AddressAutocomplete.tsx'),
  join('components', 'ui', 'PhoneField.tsx'),
]);

function walk(dir: string, out: string[]): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry.startsWith('.')) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (entry.endsWith('.tsx')) out.push(full);
  }
  return out;
}

/**
 * The props of one JSX element, as source text.
 *
 * Read by counting braces from the opening tag to the matching `>` rather than
 * by a single regex, because a prop value like `onChange={() => { … }}` has a
 * `>` inside it and a lazy regex stops there — which would truncate the props
 * of exactly the fields most likely to be wrong.
 */
function elementProps(source: string, start: number): string {
  let depth = 0;
  for (let index = start; index < source.length; index += 1) {
    const character = source[index];
    if (character === '{') depth += 1;
    else if (character === '}') depth -= 1;
    else if (character === '>' && depth === 0) return source.slice(start, index);
  }
  return source.slice(start, start + 600);
}

interface Violation {
  file: string;
  label: string;
  kind: 'address' | 'phone';
}

const violations: Violation[] = [];
let scanned = 0;
let fieldsSeen = 0;

for (const root of ROOTS) {
  for (const file of walk(root, [])) {
    const relativePath = relative('.', file);
    if (SELF.has(relativePath)) continue;

    const source = readFileSync(file, 'utf8');
    scanned += 1;

    for (const match of source.matchAll(/<(Input|Textarea)\b/g)) {
      const props = elementProps(source, match.index + match[0].length);
      const label = /\blabel=(?:"([^"]*)"|'([^']*)')/.exec(props);
      if (label === null) continue;

      const text = label[1] ?? label[2] ?? '';
      fieldsSeen += 1;

      if (ADDRESS_LABEL.test(text)) {
        if (!NOT_POSTAL.test(text) && !NOT_POSTAL.test(props)) {
          violations.push({ file: relativePath, label: text, kind: 'address' });
        }
        continue;
      }

      if (PHONE_LABEL.test(text)) {
        // The narrow exemption: a field that already applies a mask itself.
        // School and Branch keep two dedicated columns; see the header.
        const masked = props.includes('formatMobile(') || props.includes('formatLandline(');
        if (!masked) {
          violations.push({ file: relativePath, label: text, kind: 'phone' });
        }
      }
    }
  }
}

for (const violation of violations) {
  const wanted = violation.kind === 'address' ? ADDRESS_COMPONENT : PHONE_COMPONENT;
  console.log(
    `  ✗ ${violation.file}: <Input label="${violation.label}"> must be <${wanted}>`,
  );
}

checks += 1;
if (violations.length > 0) failures += 1;

console.log(
  `  scanned ${String(scanned)} components, ${String(fieldsSeen)} labelled fields, ` +
    `${String(violations.length)} violations`,
);

/* -------------------------------------------------------------------------- */

console.log(
  failures === 0
    ? `\nPASS — ${String(checks)} assertions across the phone masks, kind detection and the field rollout.`
    : `\nFAIL — ${String(failures)} of ${String(checks)} assertions failed.`,
);

process.exitCode = failures === 0 ? 0 : 1;
