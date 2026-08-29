/**
 * The branch boundary, asserted rather than trusted — Sprint 19a, item 2f.
 *
 * ── Why a script and not a review note ───────────────────────────────────
 * Every failure this catches is **silent and looks correct**. A listing that
 * forgets its campus filter returns more rows, and more rows is what a working
 * screen looks like: nothing throws, nothing is red, and the only person who
 * can tell is a branch administrator who happens to recognise a name from
 * another campus. There is nothing for a type-checker or a passing build to
 * object to — which is the same argument `check-accounting` makes about an
 * unbalanced ledger, and the reason both of these exist.
 *
 * The opposite mistake is worse still. `eq(subjects.branchId, campus)` on a
 * table where **null means shared** returns *nothing at all* at every school in
 * production today, because every row is shared. An empty subject list reads as
 * a school that was never set up rather than as a filter that is wrong, and the
 * school's own administrator would report it as data loss.
 *
 * ── What it covers ───────────────────────────────────────────────────────
 *  1. The catalogue: `branches.manage` is registered in both places, and
 *     migration `0035`'s CHECK is the same list as `PERMISSIONS`.
 *  2. The resolver exists and exports the whole surface every caller needs.
 *  3. No `lib/*.ts` compares a **nullable** branch column with `eq`.
 *  4. Every exported `list*` function that selects from one of the nine
 *     branch-owned tables refers to the scope — or carries an explicit
 *     allowlist comment, so an intentional school-wide read is a decision
 *     somebody wrote down rather than one nobody noticed.
 *  5. `0035` adds all nine columns with `ON DELETE set null`, and creates
 *     `school_user_branches` with the unique index the writer leans on.
 *
 * It reads source text and needs **no database**, which is what lets it sit in
 * CI beside `check-loaders` and `check-accounting` rather than on the machine
 * that holds the credentials.
 *
 *   npm run check-branch-scope
 *
 * Exit code 1 on any violation.
 */

import { readdirSync, readFileSync as read } from 'node:fs';

/**
 * Every source read here is normalised to LF first.
 *
 * The repository is developed on Windows with `core.autocrlf=true`, so the
 * working tree is CRLF and git stores LF. A pattern anchored on `\n}` — which
 * is how this script finds the end of a function — matches in CI and silently
 * matches *nothing* on a developer's machine, so the check would pass locally
 * for the wrong reason and only ever fail on the server.
 */
function readFileSync(path: string): string {
  return read(path, 'utf8').split('\r\n').join('\n');
}

import { DEFAULT_ROLE_PERMISSIONS, PERMISSIONS, PERMISSION_GROUPS, PERMISSION_LABELS } from '../lib/permissions';

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

const MIGRATION_PATH = 'db/migrations/0035_sprint19a_branch_boundary.sql';
const MIGRATION = readFileSync(MIGRATION_PATH);

/**
 * The nine tables of decision D1, by their Drizzle export name and their SQL
 * name. `branch_id` on every one of them is **nullable and means shared**.
 */
const BRANCH_OWNED = [
  { drizzle: 'subjects', sql: 'subjects' },
  { drizzle: 'feeTypes', sql: 'fee_types' },
  { drizzle: 'gradingSchemes', sql: 'grading_schemes' },
  { drizzle: 'examTerms', sql: 'exam_terms' },
  { drizzle: 'concessionSchemes', sql: 'concession_schemes' },
  { drizzle: 'leaveTypes', sql: 'leave_types' },
  { drizzle: 'salaryComponents', sql: 'salary_components' },
  { drizzle: 'resultSubcategories', sql: 'result_subcategories' },
  { drizzle: 'lateFeeRules', sql: 'late_fee_rules' },
] as const;

/** The names that count as "this query knows about the scope". */
const SCOPE_MARKERS = [
  'branchIds',
  'branchScope',
  'sharedOrOwnedBy',
  'ownedBy',
  'effectiveBranchIds',
];

/**
 * The comment that opts a read out, and the shape it has to take.
 *
 * A bare `// eslint-disable`-style marker would be too easy to paste. This one
 * has to carry a reason on the same line, because the reason is the point: an
 * intentional school-wide read is a decision, and a decision nobody wrote down
 * is indistinguishable from an omission six months later.
 */
const ALLOW = /\/\/\s*check-branch-scope:\s*\S+/;

/* -----------------------------------------------------------------------------
 * 1. The permission catalogue.
 * -------------------------------------------------------------------------- */

section('The permission catalogue');

ok(
  (PERMISSIONS as readonly string[]).includes('branches.manage'),
  'branches.manage is in PERMISSIONS',
);

ok(
  PERMISSION_GROUPS.some((group) =>
    (group.permissions as readonly string[]).includes('branches.manage'),
  ),
  'branches.manage is in a PERMISSION_GROUPS entry, so the permissions screen picks it up on its own',
);

ok(
  PERMISSION_LABELS['branches.manage'] !== undefined &&
    PERMISSION_LABELS['branches.manage'] !== '',
  'branches.manage has a label — an unlabelled key is a blank row on the matrix',
);

ok(
  DEFAULT_ROLE_PERMISSIONS.school_admin.includes('branches.manage'),
  'the school administrator holds it by default',
);

ok(
  !DEFAULT_ROLE_PERMISSIONS.branch_admin.includes('branches.manage'),
  'a campus administrator does not — editing the campus record is editing the boundary they are confined by',
);

ok(
  !DEFAULT_ROLE_PERMISSIONS.principal.includes('branches.manage') &&
    !DEFAULT_ROLE_PERMISSIONS.teacher.includes('branches.manage'),
  'and neither a head nor a teacher holds it',
);

/*
 * The migration's CHECK and the code's list have to be the same set, or the
 * schema file and the live database disagree — which is the exact failure that
 * constraint exists to prevent, and STATE.md §5aa records the cost of it.
 */
const checkClause = /"permission" IN \(([\s\S]*?)\)\s*\);/.exec(MIGRATION);

ok(checkClause !== null, `${MIGRATION_PATH} widens role_permissions_permission_check`);

if (checkClause !== null) {
  const inMigration = new Set(
    [...checkClause[1]!.matchAll(/'([a-z.]+)'/g)].map((match) => match[1]!),
  );

  const missing = PERMISSIONS.filter((permission) => !inMigration.has(permission));
  const extra = [...inMigration].filter(
    (permission) => !(PERMISSIONS as readonly string[]).includes(permission),
  );

  ok(
    missing.length === 0,
    `every key in PERMISSIONS is in the migration's CHECK (missing: ${missing.join(', ') || 'none'})`,
  );
  ok(
    extra.length === 0,
    `the migration's CHECK names no key the code does not (extra: ${extra.join(', ') || 'none'})`,
  );
}

/* -----------------------------------------------------------------------------
 * 2. The resolver.
 * -------------------------------------------------------------------------- */

section('lib/branch-scope.ts');

const RESOLVER = readFileSync('lib/branch-scope.ts');

for (const exported of [
  'resolveBranchScope',
  'effectiveBranchIds',
  'sharedOrOwnedBy',
  'ownedBy',
  'scopeAdmitsWrite',
  'branchForWrite',
  'outOfScopeMessage',
  'readBranchParam',
]) {
  ok(
    new RegExp(`export (async )?(function|const) ${exported}\\b`).test(RESOLVER),
    `it exports ${exported}`,
  );
}

ok(
  RESOLVER.includes("import 'server-only'"),
  'it is server-only — the scope is decided on the server or it is not a boundary',
);

ok(
  /cache\(/.test(RESOLVER),
  'it is request-cached, because a page and its layout both ask',
);

ok(
  /pinned/.test(RESOLVER) && /allowsAll/.test(RESOLVER),
  'BranchScope carries `pinned` (item 13) and `allowsAll` (the All-campuses rule)',
);

/*
 * `sharedOrOwnedBy` must never reduce to `eq`. The whole reason it exists is
 * that a null `branch_id` on these tables means *shared*, and every row in
 * production today is one.
 */
const sharedBody = /export function sharedOrOwnedBy\([\s\S]*?\n}/.exec(RESOLVER)?.[0] ?? '';
ok(
  sharedBody.includes('isNull(') && sharedBody.includes('inArray('),
  'sharedOrOwnedBy admits shared rows as well as owned ones',
);
ok(
  !/\beq\(/.test(sharedBody),
  'sharedOrOwnedBy never uses `eq` — that hides every shared row, which is all of them',
);

/* -----------------------------------------------------------------------------
 * 3 and 4. The query modules.
 * -------------------------------------------------------------------------- */

section('The listings');

const libFiles = readdirSync('lib')
  .filter((name) => name.endsWith('.ts'))
  .map((name) => ({ name: `lib/${name}`, source: readFileSync(`lib/${name}`) }));

/*
 * 3. No `eq` against a nullable branch column, anywhere.
 *
 * The dangerous direction is silent in the other sense: it returns nothing, at
 * every school, and reads as an unconfigured module rather than a broken query.
 */
for (const file of libFiles) {
  for (const table of BRANCH_OWNED) {
    const pattern = new RegExp(`eq\\(\\s*${table.drizzle}\\.branchId`, 'g');
    const hits = file.source.match(pattern);
    ok(
      hits === null,
      `${file.name} does not compare ${table.drizzle}.branchId with eq — use sharedOrOwnedBy (${hits?.length ?? 0} found)`,
    );
  }
}

/*
 * 4. Every exported listing that reads one of the nine refers to the scope.
 *
 * "Listing" is a function whose name begins with `list` and whose parameters
 * include `locationId` — which is every tenant-scoped read in this repo by
 * convention, and the shape the spec names.
 */
const LISTING = /export async function (list\w+)\(([\s\S]*?)\)\s*:\s*Promise<[\s\S]*?\n}\n/g;

let scanned = 0;

for (const file of libFiles) {
  for (const match of file.source.matchAll(LISTING)) {
    const [whole, name = '', params = ''] = match;
    if (!params.includes('locationId')) continue;

    const touched = BRANCH_OWNED.filter((table) =>
      new RegExp(`\\.from\\(${table.drizzle}\\)`).test(whole),
    );
    if (touched.length === 0) continue;

    scanned += 1;

    // The allowlist comment may sit inside the function or in the docblock
    // immediately above it, which is where a reason belongs.
    const start = match.index ?? 0;
    const preamble = file.source.slice(Math.max(0, start - 1200), start);

    const scoped = SCOPE_MARKERS.some((marker) => whole.includes(marker));
    const allowed = ALLOW.test(whole) || ALLOW.test(preamble);

    ok(
      scoped || allowed,
      `${file.name}: ${name}() reads ${touched.map((table) => table.sql).join(', ')} without a branch scope — thread \`branchIds\` through it, or write down why it is school-wide with \`// check-branch-scope: <reason>\``,
    );
  }
}

ok(scanned >= 8, `every one of the nine catalogue listings was found and scanned (found ${scanned})`);

/* -----------------------------------------------------------------------------
 * 5. The migration.
 * -------------------------------------------------------------------------- */

section(MIGRATION_PATH);

for (const table of BRANCH_OWNED) {
  ok(
    new RegExp(`ALTER TABLE "${table.sql}" ADD COLUMN IF NOT EXISTS "branch_id" uuid`).test(
      MIGRATION,
    ),
    `${table.sql} gains a nullable branch_id`,
  );

  const constraint = new RegExp(
    `ALTER TABLE "${table.sql}" ADD CONSTRAINT "${table.sql}_branch_id_branches_id_fk"[\\s\\S]{0,260}?ON DELETE set null`,
  );
  ok(
    constraint.test(MIGRATION),
    `${table.sql}.branch_id is ON DELETE set null — a cascade would delete the school's own row with the campus`,
  );

  ok(
    new RegExp(
      `CREATE INDEX IF NOT EXISTS "${table.sql}_location_branch_idx"[\\s\\S]{0,140}?"location_id", "branch_id"`,
    ).test(MIGRATION),
    `${table.sql} is indexed on (location_id, branch_id) — tenant first, which is the only access pattern there is`,
  );
}

ok(
  !/ON DELETE cascade[\s\S]{0,80}?branch_id/.test(MIGRATION),
  'no branch_id column in this migration cascades',
);

ok(
  /CREATE TABLE IF NOT EXISTS "school_user_branches"/.test(MIGRATION),
  'school_user_branches is created',
);

ok(
  /CREATE UNIQUE INDEX IF NOT EXISTS "school_user_branches_user_branch_idx"[\s\S]{0,140}?"school_user_id", "branch_id"/.test(
    MIGRATION,
  ),
  'granting the same campus twice is refused by a unique index, which is what the writer leans on',
);

ok(
  /"granted_by_uid" text/.test(MIGRATION),
  'the grant records who made it — a column that answers with silence is worse than one nobody reads',
);

/* -------------------------------------------------------------------------- */

console.log(
  failures === 0
    ? `\nPASS — ${String(checks)} assertions across the catalogue, the resolver, the listings and migration 0035.`
    : `\nFAIL — ${String(failures)} of ${String(checks)} assertions failed.`,
);

process.exitCode = failures === 0 ? 0 : 1;
