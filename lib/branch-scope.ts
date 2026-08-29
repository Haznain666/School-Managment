import 'server-only';

import {
  and,
  asc,
  eq,
  inArray,
  isNull,
  or,
  sql,
  type AnyColumn,
  type SQL,
} from 'drizzle-orm';
import { cache } from 'react';

import { branches, schoolUserBranches, schoolUsers } from '@/db/schema';

import { db } from './drizzle';

/**
 * `lib/branch-scope.ts` — Sprint 19a. Which campuses may this person see, and
 * which one are they looking at?
 *
 * ── One resolver, and every read goes through it ─────────────────────────
 * Before this file, "which campus" was answered in three different places with
 * three different rules: `claims.branchId` read straight into a query, a
 * `PrincipalScope` resolved from `principal_assignments`, and — across most of
 * the catalogue modules — not answered at all, so a branch administrator's
 * subject list, fee heads, exam terms and leave types were the whole group's.
 *
 * Everything now asks here. **If you find yourself writing `claims.branchId`
 * inside a query, that is the defect this module exists to prevent.** The one
 * legitimate reader of `claims.branchId` is this file.
 *
 * ── The four kinds of caller, in the order the rules are applied ─────────
 *
 *  1. **The owner** — `school_admin` with `branch_id IS NULL`. Every campus,
 *     `branchIds: null`. This is decision D3: one person, one login, many
 *     scopes. Extra hats are assignments, never second `school_users` rows.
 *  2. **Branch-bound** — anybody carrying a `branch_id`. Their own campus plus
 *     whatever `school_user_branches` grants them (decision D2). Somebody with
 *     no grants gets exactly one id, which is what every branch-bound member
 *     has today.
 *  3. **School-wide but not the owner** — a principal appointed across the
 *     group, an accountant, an HR manager. `branchIds: null` here, narrowed
 *     *downstream* by `resolvePrincipalScope`. See "Two boundaries" below.
 *  4. **The platform operator** — `isPlatformAdmin`, arriving through "Login as
 *     Admin". Falls into rule 1 by construction: no membership row means no
 *     campus, and the alternative is an operator who opens a school and is
 *     shown none of it.
 *
 * ── Two boundaries, kept apart on purpose ────────────────────────────────
 * `PrincipalScope` narrows what a *head* is shown, from assignments an
 * administrator makes and can change daily. `BranchScope` narrows what anybody
 * is shown, from the campus they belong to. They compose — a principal bound to
 * Karachi and assigned the O-Levels division sees O-Levels at Karachi — but
 * merging them into one type would mean a screen could no longer tell "you head
 * no division yet" from "your campus has nothing in it", and the difference
 * between those two sentences is the difference between a setting and a broken
 * page.
 *
 * ── An out-of-scope `?branch=` is not an error ───────────────────────────
 * Rule 4 of the spec, and it is worth saying why: a stale bookmark, a link
 * pasted between colleagues at different campuses, and a campus deactivated
 * since the tab was opened all arrive as the same request. Every one of them
 * resolves to `selected: null` — the caller's whole scope — never to a 500 and
 * never to somebody else's campus. A 500 teaches people the product is broken;
 * showing them another campus is the leak this sprint exists to close.
 *
 * ── Request-cached ───────────────────────────────────────────────────────
 * A page and its layout both ask, and on the dashboard so does every aggregate.
 * `cache()` memoises on the arguments for the life of one request, the same
 * arrangement `resolvePrincipalScope` and `membershipFor` use.
 */

export interface BranchOption {
  id: string;
  name: string;
}

/** What a caller may see, what they asked for, and what to draw. */
export interface BranchScope {
  /** null = every branch of this school. Otherwise the ids this caller may read. */
  branchIds: string[] | null;
  /** What the branch selector offers. Empty when there is nothing to choose. */
  options: BranchOption[];
  /** The branch the caller asked for, once validated against `branchIds`. */
  selected: string | null;
  /** True when there is one campus to look at: pin it, hide the selector. */
  pinned: boolean;
  /**
   * Whether the selector may offer *All campuses*.
   *
   * True for anyone whose scope is the whole school, and for a branch-bound
   * person who has been granted every campus there is — at which point "all"
   * and "the ones you hold" name the same set and withholding the option would
   * be a distinction with no difference behind it.
   */
  allowsAll: boolean;
  /**
   * Whether the caller's own membership row names a campus.
   *
   * Distinct from `branchIds !== null`, and the distinction is load-bearing on
   * **writes**. A one-branch school resolves `branchIds` to that one campus for
   * everybody, including its owner — which is right for reading and wrong for
   * creating: a subject the owner adds today, at a school with one campus,
   * should still be the *school's* when a second campus opens next year, not
   * silently confined to the first. `bound` is false for them, so the row is
   * written shared. See `branchForWrite`.
   */
  bound: boolean;
}

/**
 * Every active campus of a school, in the order a person reads a list.
 *
 * Active only. An inactive campus is invisible everywhere else in the portal —
 * see the note on the Active toggle in `components/super-admin/BranchForm.tsx`
 * — and offering it here would be the one control able to bring it back into
 * view without ever saying so.
 */
const activeBranches = cache(
  async (locationId: string): Promise<BranchOption[]> =>
    db
      .select({ id: branches.id, name: branches.name })
      .from(branches)
      .where(and(eq(branches.locationId, locationId), eq(branches.isActive, true)))
      .orderBy(asc(branches.name)),
);

/**
 * The extra campuses granted to one person.
 *
 * Keyed on `auth_user_id` because that is what a session carries. The join is
 * one indexed hop and saves every caller fetching their own membership row
 * first — which several screens were doing for nothing else.
 */
const grantedBranchIds = cache(
  async (locationId: string, authUserId: string): Promise<string[]> => {
    const rows = await db
      .select({ branchId: schoolUserBranches.branchId })
      .from(schoolUserBranches)
      .innerJoin(
        schoolUsers,
        and(
          eq(schoolUsers.id, schoolUserBranches.schoolUserId),
          eq(schoolUsers.locationId, locationId),
        ),
      )
      .where(
        and(
          eq(schoolUserBranches.locationId, locationId),
          eq(schoolUsers.authUserId, authUserId),
        ),
      );

    return rows.map((row) => row.branchId);
  },
);

/**
 * Who is asking, in the two facts this module needs.
 *
 * Structural rather than `SchoolSessionClaims`, because both halves of the
 * application have to be able to ask: a page holds claims and an API route
 * holds a `SchoolAuthContext`, and both carry these two fields. Widening the
 * parameter is what stops a route resolving the scope by hand — which is the
 * `claims.branchId`-in-a-query defect this whole module exists to prevent.
 */
export interface BranchScopeCaller {
  uid: string;
  branchId: string | null;
}

/**
 * The branch scope for one request.
 *
 * `requested` is the raw `?branch=` value — pass it straight through. Validating
 * it is this function's job, and doing it at the call site is how two screens
 * come to disagree about what an unknown id means.
 *
 * Memoised on **primitives**, not on the caller object. A route builds a fresh
 * context object per call, so a `cache()` keyed on it would never hit; keyed on
 * the three strings it does, which is what makes it safe for the dashboard to
 * ask once per aggregate.
 */
export async function resolveBranchScope(
  locationId: string,
  caller: BranchScopeCaller,
  requested?: string | null,
): Promise<BranchScope> {
  return resolveScopeFor(locationId, caller.uid, caller.branchId, requested ?? null);
}

const resolveScopeFor = cache(
  async (
    locationId: string,
    uid: string,
    callerBranchId: string | null,
    requested: string | null,
  ): Promise<BranchScope> => {
    const options = await activeBranches(locationId);

    /*
     * Item 13. One campus is not a question, so it is not asked: no selector,
     * no options, and the single branch applied silently.
     *
     * `pinned` is decided by the *school*, not by the caller — a one-branch
     * school pins its owner too. That is what keeps `SetupProgressCard` on the
     * owner's dashboard (item 4d), which is the case where it matters most.
     */
    if (options.length === 1) {
      const only = options[0]!;
      return {
        branchIds: [only.id],
        options: [],
        selected: only.id,
        pinned: true,
        allowsAll: false,
        bound: callerBranchId !== null,
      };
    }

    /*
     * Rule 2 first. A campus on the membership row is the narrowest answer, and
     * checking it before the role means a `school_admin` created *for one
     * campus* stays confined to it rather than being promoted to the group.
     */
    if (callerBranchId !== null) {
      const granted = await grantedBranchIds(locationId, uid);
      const live = new Set(options.map((option) => option.id));

      // A grant naming a campus that has since been deactivated is dropped
      // rather than honoured: the campus is invisible on every other screen,
      // and a scope that admits rows no listing offers is a scope nobody can
      // reason about.
      const allowed = [...new Set([callerBranchId, ...granted])].filter((id) =>
        live.has(id),
      );

      const scopedOptions = options.filter((option) => allowed.includes(option.id));
      const hasChoice = scopedOptions.length > 1;

      return {
        branchIds: allowed.length === 0 ? [callerBranchId] : allowed,
        /*
         * Item 13 again, one level down: a dropdown with one option is a
         * question with one answer.
         */
        options: hasChoice ? scopedOptions : [],
        selected: pick(requested, allowed, hasChoice ? null : callerBranchId),
        pinned: !hasChoice,
        // Every campus granted means "all" and "mine" are the same set.
        allowsAll: hasChoice && scopedOptions.length === options.length,
        bound: true,
      };
    }

    // Rules 1, 3 and 4 land here: no campus on the membership row means the
    // whole school, and `resolvePrincipalScope` narrows a head afterwards.
    return {
      branchIds: null,
      options,
      selected: pick(requested, null, null),
      pinned: false,
      allowsAll: true,
      bound: false,
    };
  },
);

/**
 * The `?branch=` value off a request URL, or null.
 *
 * One reader, so the parameter is spelled one way. `branch` rather than
 * `branchId` because it is in every link a colleague pastes to a colleague, and
 * `lib/report-catalogue.ts` has used the short form since Sprint 12.
 */
export function readBranchParam(url: URL): string | null {
  const value = url.searchParams.get('branch');
  return value === null || value === '' ? null : value;
}

/**
 * The requested campus, or the fallback, never anything else.
 *
 * `allowed === null` means every campus, and the id is honoured then only when
 * this school actually has it — an id from another tenant reaching this far
 * would otherwise be handed to a query.
 */
function pick(
  requested: string | null | undefined,
  allowed: string[] | null,
  fallback: string | null,
): string | null {
  if (requested === null || requested === undefined || requested === '') return fallback;
  if (allowed === null) return requested;
  return allowed.includes(requested) ? requested : fallback;
}

/**
 * The ids a query should actually filter on: the selection when there is one,
 * the whole scope when there is not.
 *
 * This is what nearly every listing wants. Somebody who has chosen the Karachi
 * campus wants Karachi; somebody who has not wants everything they may see.
 * `null` means no branch condition at all.
 */
export function effectiveBranchIds(scope: BranchScope): string[] | null {
  return scope.selected === null ? scope.branchIds : [scope.selected];
}

/**
 * The predicate for a table whose `branch_id` is **nullable and means shared**
 * — the nine catalogue tables of decision D1, and `announcements`.
 *
 * ── Never `eq` on these ──────────────────────────────────────────────────
 * A null `branch_id` means "shared by every campus", and at every school in
 * production today that is *every row*. `eq(column, branchId)` on this class of
 * table returns nothing at all, and an empty subject list reads as a school
 * that was never set up rather than as a filter that is wrong.
 *
 * `undefined` — no condition — when the scope reaches every campus, so the
 * unscoped query keeps exactly the shape it had before this sprint and the
 * unscoped path is provably unchanged.
 */
export function sharedOrOwnedBy(
  column: AnyColumn,
  branchIds: string[] | null,
): SQL | undefined {
  if (branchIds === null) return undefined;
  if (branchIds.length === 0) return isNull(column);
  return or(isNull(column), inArray(column, branchIds));
}

/**
 * The predicate for a table whose `branch_id` names the campus that owns the
 * row outright — `grades`, `students`, `staff`, `expenses`, `payroll_runs`.
 *
 * Deliberately a second function rather than a flag. On these tables a null is
 * not "shared", it is a row that predates the column or a data fault, and
 * admitting it would put another campus's records into a branch-bound reader's
 * list. The two helpers are one identifier apart at the call site and give
 * opposite answers, so read the column's own comment before choosing.
 *
 * An empty scope reaches nothing, and says so: `false`, not "no filter". The
 * dangerous direction here is the one where an empty list widens rather than
 * narrows, and it looks entirely normal on screen.
 */
export function ownedBy(column: AnyColumn, branchIds: string[] | null): SQL | undefined {
  if (branchIds === null) return undefined;
  if (branchIds.length === 0) return sql`false`;
  return inArray(column, branchIds);
}

/**
 * Whether a caller may write to a campus. Item 2e.
 *
 * Every POST and PATCH that accepts a `branchId` asks this and returns **403**
 * naming the campus rather than writing the row. That is not belt-and-braces
 * over the listing filter: a stale tab left open across a reassignment posts a
 * row that satisfies every constraint and then appears in no listing anywhere —
 * an accepted write nobody can see. `POST /api/school/timetable/entries` has
 * guarded period structures this way since Sprint 12, for the same reason.
 *
 * A null `branchId` — "shared by the school" — is admitted only for a caller
 * whose own scope is the whole school. A branch administrator creating a shared
 * fee head would be writing a row every other campus then bills against.
 */
export function scopeAdmitsWrite(scope: BranchScope, branchId: string | null): boolean {
  if (!scope.bound) {
    // School-wide caller: shared is theirs to write, and a named campus has to
    // be one this school actually has. `options` is that list, already filtered
    // to the tenant and to active campuses.
    return branchId === null || scope.options.some((option) => option.id === branchId);
  }

  if (branchId === null) return false;
  return scope.branchIds !== null && scope.branchIds.includes(branchId);
}

/**
 * The campus a write should be recorded against, or a refusal. Item 2e.
 *
 * ── Why this defaults rather than refuses ────────────────────────────────
 * No form in the product sent a campus before this sprint, so a rule of "a
 * branch-bound caller must name one" would have turned every existing create
 * button at a campus into a 403 on the day it deployed — a branch administrator
 * scheduling an exam term for their own campus, refused for not answering a
 * question nothing asked them. So an unanswered campus resolves to *theirs*,
 * which is the only campus the answer could have been.
 *
 * The one case that genuinely cannot be guessed is a person granted several
 * campuses who has not chosen between them. That is refused, and the message
 * says to pick one — inventing an answer there would file a policy under a
 * campus at random.
 */
export function branchForWrite(
  scope: BranchScope,
  requested: string | null,
): { ok: true; branchId: string | null } | { ok: false; message: string } {
  if (requested !== null) {
    return scopeAdmitsWrite(scope, requested)
      ? { ok: true, branchId: requested }
      : { ok: false, message: outOfScopeMessage(requested, scope.options) };
  }

  // A school-wide caller who named nothing means "every campus", which is what
  // a null column says. That is also every row in production today.
  if (!scope.bound) return { ok: true, branchId: null };

  const mine = scope.branchIds ?? [];
  if (mine.length === 1) return { ok: true, branchId: mine[0]! };
  if (scope.selected !== null) return { ok: true, branchId: scope.selected };

  return {
    ok: false,
    message:
      'Choose which campus this belongs to. You have access to more than one, ' +
      'and something created here is billed, timetabled or graded against ' +
      'exactly one of them.',
  };
}

/** The refusal sentence, naming the campus rather than the id. */
export function outOfScopeMessage(
  branchId: string | null,
  options: readonly BranchOption[],
): string {
  if (branchId === null) {
    return 'Only a school-wide administrator can create something every campus shares.';
  }

  const name = options.find((option) => option.id === branchId)?.name;

  return name === undefined
    ? 'That campus is not one you have access to.'
    : `You do not have access to ${name}.`;
}
