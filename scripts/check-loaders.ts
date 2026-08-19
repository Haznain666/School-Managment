/**
 * Every data-fetching route shows a loader — including routes not yet written.
 *
 * ── The rule ─────────────────────────────────────────────────────────────
 * If a route's `page.tsx` fetches anything on the server, its segment has a
 * `loading.tsx`. Not "should have": *has*, and this script is what keeps that
 * true after the session that rolled it out has ended.
 *
 * ── Why a check and not a convention ─────────────────────────────────────
 * The requirement was explicit that it applies to all future development. A
 * rollout answers today. Only a check answers next sprint, because the next
 * person to add a screen will copy the nearest existing `page.tsx` — and a
 * `page.tsx` is a complete, working, green-building route on its own. Nothing
 * about a passing build would tell them a loader was missing, and nothing on
 * their fast local machine would show them the gap it fills. The gap is only
 * visible against the live origin, which was measured at ~1s per uncached
 * request on 2026-08-19.
 *
 * ── What counts as "fetches on the server" ───────────────────────────────
 * Either of:
 *   · `export const dynamic = 'force-dynamic'`
 *   · an `await` anywhere in the module
 *
 * Both are read from the source with comments stripped first, so a docblock
 * that merely *mentions* `force-dynamic` — several in this codebase do,
 * explaining why they don't use it — is not mistaken for the export. That is
 * not a hypothetical: `app/offline/page.tsx` says "No `force-dynamic`" in
 * prose and would otherwise be required to carry a loader it must never have.
 *
 * A page with neither is prerendered at build time. It has no fetch to wait
 * for, its HTML is served from the CDN edge, and a skeleton on it would be a
 * flash of fake content in front of content that was already there. Those are
 * required *not* to have a loader, and this script fails on that too — the
 * rule is "a loader exactly where there is a wait", in both directions.
 *
 * ── The third assertion, and the bug that bought it ──────────────────────
 * A `loading.tsx` in a segment that has no `page.tsx` beside it — a route
 * group root, or a bare layout directory — is a boundary for *everything*
 * below it, static children included.
 *
 * This app had five of them, one per portal group, and they were fine while
 * every route under them was dynamic. The moment `/super-admin/login` was made
 * static on 2026-08-19, the group's skeleton rendered above the sign-in form
 * **permanently**: a stat-tile row and a six-row table, shimmering, on a page
 * that had already finished. It was in the server HTML, so no amount of
 * hydration was going to remove it.
 *
 * With a loader in every segment that has a page, a group-level one adds
 * nothing and can only do that. So they are refused outright.
 *
 * ── The second assertion ─────────────────────────────────────────────────
 * A `loading.tsx` that exists but renders `null`, or a bare spinner, satisfies
 * the file check and none of the intent. Each one must render at least one
 * component from `components/ui/Skeleton` — which is also what keeps the
 * shapes consistent across 100+ routes instead of drifting into a hundred
 * hand-placed grey boxes.
 *
 *   npm run check-loaders
 *
 * Exit code 1 on any violation.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const APP_DIR = 'app';
const SKELETON_EXPORTS = [
  'Skeleton',
  'SkeletonText',
  'SkeletonTable',
  'SkeletonStatTiles',
  'SkeletonPageHeader',
  'SkeletonForm',
  'SkeletonDetail',
  'SkeletonChart',
  'SkeletonDocument',
];

let failures = 0;
let checks = 0;

function fail(message: string): void {
  failures += 1;
  console.log(`  ✗ ${message}`);
}

/**
 * Removes comments before the source is searched.
 *
 * Crude, deliberately: this is looking for whether somebody *typed* a
 * particular export, and there is exactly one way to type it. A parse would be
 * more machinery for the same answer.
 */
function stripComments(source: string): string {
  return source
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, '') // JSX comments
    .replace(/\/\*[\s\S]*?\*\//g, '') // block comments
    .replace(/^[ \t]*\/\/.*$/gm, ''); // line comments
}

function walk(directory: string, found: string[]): string[] {
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) walk(path, found);
    else if (entry === 'page.tsx') found.push(path);
  }
  return found;
}

/** The URL a segment serves, with route groups — `(school-admin)` — removed. */
function routeOf(segment: string): string {
  const parts = relative(APP_DIR, segment)
    .split(sep)
    .filter((part) => part !== '' && !(part.startsWith('(') && part.endsWith(')')));
  return `/${parts.join('/')}`;
}

/* -------------------------------------------------------------------------- */

const pages = walk(APP_DIR, []).sort();
let dynamicPages = 0;
let staticPages = 0;

for (const page of pages) {
  const segment = page.slice(0, page.length - `${sep}page.tsx`.length);
  const source = stripComments(readFileSync(page, 'utf8'));

  const forced = /export\s+const\s+dynamic\s*=\s*'force-dynamic'/.test(source);
  const awaits = /\bawait\b/.test(source);
  const fetches = forced || awaits;

  let loader: string | null = null;
  try {
    loader = readFileSync(join(segment, 'loading.tsx'), 'utf8');
  } catch {
    loader = null;
  }

  checks += 1;

  if (fetches) {
    dynamicPages += 1;

    if (loader === null) {
      fail(
        `${routeOf(segment)} fetches on the server but has no loading.tsx — ` +
          `add ${relative('.', join(segment, 'loading.tsx'))}`,
      );
      continue;
    }

    const usesSkeleton = SKELETON_EXPORTS.some((name) =>
      new RegExp(`<${name}\\b`).test(loader as string),
    );

    if (!usesSkeleton) {
      fail(
        `${routeOf(segment)} has a loading.tsx that renders no skeleton — ` +
          `use a shape from components/ui/Skeleton so the placeholder matches ` +
          `the page it stands in for`,
      );
    }
  } else {
    staticPages += 1;

    if (loader !== null) {
      fail(
        `${routeOf(segment)} is prerendered — it has no server fetch to wait ` +
          `for — so its loading.tsx would flash fake content in front of real ` +
          `content. Delete ${relative('.', join(segment, 'loading.tsx'))}, or ` +
          `if the page really does fetch, make that visible in its source.`,
      );
    }
  }
}

/* -- No loader may sit in a segment that has no page ----------------------- */

function walkLoaders(directory: string, found: string[]): string[] {
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) walkLoaders(path, found);
    else if (entry === 'loading.tsx') found.push(path);
  }
  return found;
}

for (const loader of walkLoaders(APP_DIR, []).sort()) {
  const segment = loader.slice(0, loader.length - `${sep}loading.tsx`.length);
  checks += 1;

  let hasPage = true;
  try {
    statSync(join(segment, 'page.tsx'));
  } catch {
    hasPage = false;
  }

  if (!hasPage) {
    fail(
      `${relative('.', loader)} has no page.tsx beside it, so it is a boundary ` +
        `for every route below it — including the prerendered ones, where it ` +
        `renders forever. Move it into the segment whose page it stands in for.`,
    );
  }
}

console.log(
  `  scanned ${String(pages.length)} routes — ` +
    `${String(dynamicPages)} fetch on the server, ${String(staticPages)} are prerendered`,
);

console.log(
  failures === 0
    ? `\nPASS — ${String(checks)} assertions: every route has exactly the loading state it needs.`
    : `\nFAIL — ${String(failures)} of ${String(checks)} assertions failed.`,
);

process.exitCode = failures === 0 ? 0 : 1;
