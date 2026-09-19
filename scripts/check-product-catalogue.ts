/**
 * The Features and Roadmap tabs say only things the code actually does.
 *
 * ── Why this exists ──────────────────────────────────────────────────────
 * `lib/product-catalogue.ts` is the content behind `/super-admin/features` and
 * `/super-admin/roadmap`. Most of it is derived — the role-access matrix is
 * resolved from `DEFAULT_ROLE_PERMISSIONS` at render time, and `ROLE_PROFILES`
 * is `USER_ROLES.map(...)`, so a renamed role or module key is already a
 * `typecheck` failure.
 *
 * Three things are **not** derived, because they cannot be: the routes a
 * feature lists, the sidebar a role sees on its first day, and which roles
 * reach a feature through their own portal rather than through a permission.
 * Each of those is a second copy of something the code already knows, and
 * `CLAUDE.md` is blunt about what a second copy is: the copy that goes stale.
 *
 * ── And it went stale before it ever shipped ─────────────────────────────
 * Sprint 34's QA found four defects of exactly this family in one pass:
 *
 *   · `lesson-plans` was gated on `academics.read`, which derived **Full** for
 *     seven administrative roles. Its only route is `/teacher/lesson-plans`,
 *     and the teacher layout is `requireSchoolRole(['teacher'])` — none of the
 *     seven can open it. A Features tab told a prospect a head could read
 *     lesson plans; no screen anywhere shows one.
 *   · Three routes did not exist: `/dashboard/payroll/runs`,
 *     `/dashboard/payroll/payslips`, `/dashboard/performance/staff`. Only the
 *     `[runId]` / `[payslipId]` / `[userId]` children are real, so all three
 *     parents are 404s.
 *   · The Accountant's default view omitted Payroll and Staff performance, and
 *     Marketing's omitted Staff performance — all three of which their real
 *     sidebar shows.
 *   · Marketing rendered **None** on Staff KPIs while reaching their own
 *     scorecard at `/dashboard/performance/me`.
 *
 * None of that is visible to `typecheck`, to `lint`, or to a build. Every one
 * of them is a sentence a salesperson would read aloud. So they are assertions
 * now.
 *
 *   npm run check-product-catalogue
 *
 * Exit code 1 on any violation.
 */

import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { schoolNav } from '../components/school/school-nav';
import { DEFAULT_ROLE_PERMISSIONS, PERMISSIONS } from '../lib/permissions';
import { PLATFORM_MODULE_KEYS, type PlatformModuleKey } from '../lib/platform-modules';
import {
  GLOSSARY,
  PRODUCT_FEATURES,
  ROADMAP_ITEMS,
  ROLE_PROFILES,
} from '../lib/product-catalogue';
import { ADMIN_PORTAL_ROLES, USER_ROLES } from '../types/school-auth';

let checks = 0;
let failures = 0;

function ok(label: string): void {
  checks += 1;
  console.log(`  ✓ ${label}`);
}

function fail(label: string, detail?: string): void {
  checks += 1;
  failures += 1;
  console.log(`  ✗ ${label}`);
  if (detail !== undefined) console.log(`      ${detail}`);
}

function assert(condition: boolean, label: string, detail?: string): void {
  if (condition) ok(label);
  else fail(label, detail);
}

/* -----------------------------------------------------------------------------
 * 1. Every route a feature names is a route that exists
 *
 * Resolved against the filesystem rather than the build manifest, so this runs
 * without a build. A segment counts as real when it has its own `page.tsx`, or
 * when it has a dynamic child (`[id]`) that does — `/dashboard/reports/
 * outstanding-aging` is a valid `[reportKey]` and must not be reported.
 * -------------------------------------------------------------------------- */

const ROUTE_ROOTS = [
  'app',
  'app/(school-admin)',
  'app/(teacher)',
  'app/(student)',
  'app/(parent)',
  'app/(super-admin)',
  'app/(public)',
  'app/(platform-public)',
];

/** Does `segments` resolve to a page, allowing one dynamic hop per segment? */
function resolves(segments: readonly string[]): boolean {
  const walk = (dir: string, rest: readonly string[]): boolean => {
    if (!existsSync(dir)) return false;

    if (rest.length === 0) {
      if (existsSync(join(dir, 'page.tsx'))) return true;

      /*
       * Or the page sits in a route group directly beneath this segment.
       * Every portal's home lives in a `(home)` group — STATE.md §5bz moved
       * them there so a root `loading.tsx` stopped wrapping every sibling
       * route — and `/dashboard/performance` keeps its board in `(overview)`.
       * Without this branch the check reports `/dashboard` itself as a 404,
       * which is the sort of false positive that gets a check deleted.
       */
      return readdirSync(dir).some(
        (entry) =>
          entry.startsWith('(') &&
          statSync(join(dir, entry)).isDirectory() &&
          existsSync(join(dir, entry, 'page.tsx')),
      );
    }

    // `noUncheckedIndexedAccess` types a destructured head as possibly
    // undefined, although `rest.length === 0` was handled above.
    const head = rest[0] ?? '';
    const tail = rest.slice(1);

    // A literal child directory.
    if (head !== '' && existsSync(join(dir, head))) {
      if (walk(join(dir, head), tail)) return true;
    }

    // Or a dynamic segment standing in for it — `[reportKey]`, `[runId]`.
    for (const entry of readdirSync(dir)) {
      if (!entry.startsWith('[')) continue;
      const full = join(dir, entry);
      if (!statSync(full).isDirectory()) continue;
      if (walk(full, tail)) return true;
    }

    // Or a route group that is transparent in the URL.
    for (const entry of readdirSync(dir)) {
      if (!entry.startsWith('(')) continue;
      const full = join(dir, entry);
      if (!statSync(full).isDirectory()) continue;
      if (walk(full, rest)) return true;
    }

    return false;
  };

  return ROUTE_ROOTS.some((root) => walk(root, segments));
}

console.log('=== Every route a feature names exists ===');

let routeCount = 0;
const badRoutes: string[] = [];

for (const feature of PRODUCT_FEATURES) {
  for (const route of feature.routes) {
    routeCount += 1;
    const segments = route.split('/').filter((part) => part !== '');
    if (!resolves(segments)) badRoutes.push(`${feature.key} → ${route}`);
  }
}

assert(
  badRoutes.length === 0,
  `all ${String(routeCount)} routes across ${String(PRODUCT_FEATURES.length)} features resolve to a page`,
  badRoutes.join('\n      '),
);

/* -----------------------------------------------------------------------------
 * 2. A feature's routes are reachable by the roles its matrix promises
 *
 * The defect that made this script worth writing. A feature whose only routes
 * live in one portal cannot be **Full** for nine administrative roles.
 * -------------------------------------------------------------------------- */

console.log('\n=== A feature reachable only from one portal claims no admin access ===');

/** Which portal a route belongs to, or null for the administrative shell. */
function portalOf(route: string): 'teacher' | 'student' | 'parent' | null {
  if (route.startsWith('/teacher')) return 'teacher';
  if (route.startsWith('/student')) return 'student';
  if (route.startsWith('/parent')) return 'parent';
  return null;
}

for (const feature of PRODUCT_FEATURES) {
  const portals = feature.routes.map(portalOf);
  const adminReachable = portals.some((p) => p === null);

  // A feature with no administrative route may not be gated on a permission:
  // a permission would derive access for roles that cannot open any of it.
  if (!adminReachable && feature.routes.length > 0) {
    assert(
      feature.permissions.length === 0,
      `${feature.key}: no /dashboard route, so it names no permissions`,
      feature.permissions.length > 0
        ? `gated on ${feature.permissions.join(', ')}, which derives access for ` +
          `roles that cannot open ${feature.routes.join(' or ')}`
        : undefined,
    );
  }
}

/* -----------------------------------------------------------------------------
 * 3. Every role's default view is the sidebar it actually gets
 *
 * Executed, not described. Only the modules that have screens are enabled:
 * `lms`, `event_mgmt`, `transport`, `library` and `hostel` are switches with
 * nothing behind them, and a school running this build does not turn them on.
 * -------------------------------------------------------------------------- */

console.log('\n=== Each role’s default view matches the sidebar it is actually given ===');

const UNBUILT_MODULES: readonly PlatformModuleKey[] = [
  'lms',
  'event_mgmt',
  'transport',
  'library',
  'hostel',
];

const moduleFlags = Object.fromEntries(
  PLATFORM_MODULE_KEYS.map((key) => [key, !UNBUILT_MODULES.includes(key)]),
) as Record<PlatformModuleKey, boolean>;

for (const role of ADMIN_PORTAL_ROLES) {
  const { items, sections } = schoolNav({
    role,
    permissions: [...DEFAULT_ROLE_PERMISSIONS[role]],
    moduleFlags,
  });

  const actual = [...items.map((i) => i.label), ...sections.map((s) => s.label)];
  const profile = ROLE_PROFILES.find((p) => p.role === role);
  const claimed: readonly string[] = profile?.defaultView ?? [];

  const missing = actual.filter((label) => !claimed.includes(label));
  const extra = claimed.filter((label) => !actual.includes(label));

  assert(
    missing.length === 0 && extra.length === 0,
    `${role}: default view matches schoolNav (${String(actual.length)} entries)`,
    [
      missing.length > 0 ? `sidebar has, catalogue omits: ${missing.join(', ')}` : '',
      extra.length > 0 ? `catalogue claims, sidebar lacks: ${extra.join(', ')}` : '',
    ]
      .filter((line) => line !== '')
      .join('\n      '),
  );
}

/* -----------------------------------------------------------------------------
 * 4. Structural invariants
 * -------------------------------------------------------------------------- */

console.log('\n=== The catalogue is internally consistent ===');

const permissionSet = new Set<string>(PERMISSIONS as readonly string[]);
const badKeys = PRODUCT_FEATURES.flatMap((feature) =>
  feature.permissions
    .filter((permission) => !permissionSet.has(permission))
    .map((permission) => `${feature.key} → ${permission}`),
);
assert(badKeys.length === 0, 'every permission named is a real PERMISSIONS key', badKeys.join(', '));

const moduleSet = new Set<string>(PLATFORM_MODULE_KEYS);
const badModules = PRODUCT_FEATURES.filter(
  (feature) => feature.module !== null && !moduleSet.has(feature.module),
).map((feature) => `${feature.key} → ${String(feature.module)}`);
assert(badModules.length === 0, 'every module named is a real PlatformModuleKey', badModules.join(', '));

const anchors = new Map<string, number>();
for (const entry of [...PRODUCT_FEATURES, ...ROADMAP_ITEMS]) {
  anchors.set(entry.key, (anchors.get(entry.key) ?? 0) + 1);
}
const duped = [...anchors.entries()].filter(([, n]) => n > 1).map(([key]) => key);
assert(duped.length === 0, 'no two entries share an anchor id', duped.join(', '));

const glossaryKeys = new Set(GLOSSARY.map((term) => term.key));
const badGlossary = PRODUCT_FEATURES.flatMap((feature) =>
  (feature.glossary ?? [])
    .filter((key) => !glossaryKeys.has(key))
    .map((key) => `${feature.key} → ${key}`),
);
assert(badGlossary.length === 0, 'every glossary reference resolves to a term', badGlossary.join(', '));

const profiled = new Set(ROLE_PROFILES.map((p) => p.role));
const missingRoles = USER_ROLES.filter((role) => !profiled.has(role));
assert(
  missingRoles.length === 0 && ROLE_PROFILES.length === USER_ROLES.length,
  `all ${String(USER_ROLES.length)} roles have exactly one profile`,
  missingRoles.join(', '),
);

/* -----------------------------------------------------------------------------
 * 5. Roadmap honesty — nothing listed as unbuilt has a screen
 * -------------------------------------------------------------------------- */

console.log('\n=== Nothing on the Roadmap is already built ===');

const roadmapModules = ROADMAP_ITEMS.map((item) => item.module).filter(
  (key): key is PlatformModuleKey => key !== undefined,
);

const builtAnyway = roadmapModules.filter((key) =>
  existsSync(join('app/(school-admin)/dashboard', key === 'event_mgmt' ? 'events' : key)),
);

assert(
  builtAnyway.length === 0,
  `no roadmap module has a /dashboard route (${String(roadmapModules.length)} checked)`,
  builtAnyway.join(', '),
);

const noDates = ROADMAP_ITEMS.every(
  (item) => !/\b(19|20)\d{2}\b|Sprint \d+|\bQ[1-4]\b|coming soon/i.test(`${item.summary} ${item.forWhom}`),
);
assert(noDates, 'no roadmap entry states a date, a sprint number or a timeline');

/* -------------------------------------------------------------------------- */

console.log(
  `\n  ${String(PRODUCT_FEATURES.length)} features · ${String(ROADMAP_ITEMS.length)} roadmap items · ` +
    `${String(ROLE_PROFILES.length)} role profiles · ${String(GLOSSARY.length)} glossary terms`,
);

console.log(
  failures === 0
    ? `\nPASS — ${String(checks)} assertions: the tabs say only what the code does.`
    : `\nFAIL — ${String(failures)} of ${String(checks)} assertions failed.`,
);

process.exitCode = failures === 0 ? 0 : 1;
