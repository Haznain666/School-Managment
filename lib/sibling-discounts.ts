import 'server-only';

import { and, asc, eq, gt, inArray, isNull, or } from 'drizzle-orm';

import {
  academicYears,
  branches,
  concessionSchemes,
  grades,
  lateFeeRules,
  schoolUsers,
  sections,
  studentConcessions,
  studentEnrollments,
  studentProfiles,
} from '@/db/schema';

import { applySchemeToStudents } from './concession-schemes';
import { describeError } from './describe-error';
import { db } from './drizzle';
import { toDateOnly } from './fee-queries';
import { repriceOpenChallans } from './fee-challans';
import { listSiblings, listStudentsForGuardianIdentity, type SiblingRow } from './siblings';

/**
 * The sibling discount: who qualifies, who stops qualifying, and who takes it
 * away (Sprint 20, items 6, 7d and 9).
 *
 * ── Three rules, and the second is the one with teeth ────────────────────
 *
 *  **9a. Never the only child.** A sibling discount is granted from the
 *  *second* sibling onwards. Ordering is by **enrolment date, then admission
 *  number** — the eldest enrolment keeps the undiscounted fee and every later
 *  one is discounted. Any other ordering (by name, by age, by id) makes the
 *  discount move between children when somebody corrects a spelling, which is a
 *  fee change nobody asked for and nothing would explain.
 *
 *  **9b. The last one standing loses it.** When the siblings leave and one
 *  child remains, that child's *sibling* grant is closed — and only their
 *  sibling grant. A scholarship is a judgement about that child and is
 *  untouched. Unless the school has switched `sibling_discount_for_last_child`
 *  on, in which case nothing is removed at all.
 *
 *  **9c. The count is school-wide.** A child at Defence with a sister at
 *  Karachi has a sibling. Every read below is scoped by `location_id` and by
 *  nothing else — see the banner on `enrolledFamily`.
 *
 * ── What "removal" means, and what it deliberately does not do ───────────
 * A removal is a **`valid_until`, never a `DELETE`**. `student_concessions`
 * closes a grant by dating it, so the vouchers it already discounted stay
 * explainable — the same reasoning the append-only ledger rests on. A deleted
 * grant makes February's slip unexplainable, and a parent asking why their
 * February fee was 4,000 lower gets "nobody knows".
 *
 * A consequence worth stating because it looks like a bug and is not: a voucher
 * **already issued** keeps its discount. `listActiveConcessions` matches a
 * grant against the voucher's own billing date, and the close date is later
 * than that date, so this month's slip is unchanged and next month's is not.
 * That is the right answer — the voucher was raised for a month in which the
 * family did have two children here.
 *
 * ── Only grants that came from a `sibling` scheme are ever touched ───────
 * `student_concessions.scheme_id` is provenance, and `concession_schemes
 * .scheme_type` is what makes it legible. A concession typed in by hand and
 * called "Sibling discount", with no scheme behind it, is **not** touched: the
 * product cannot know what a school meant by a string, and taking money off a
 * family on the strength of a name is exactly the inference migration `0037`
 * refuses to make when it backfills every existing scheme to `other`.
 *
 * ── Claimed, not checked ─────────────────────────────────────────────────
 * CLAUDE.md's rule, and production runs **seven** scheduler processes. The
 * claim here is on the **grant row itself**: a conditional
 * `UPDATE … WHERE the grant is still open … RETURNING`. Postgres decides it on
 * one row under one lock, so exactly one process closes each grant and the
 * other six get nothing back and do nothing. That is a finer claim than a
 * per-school day flag and it needs no new column — see `closeGrant`.
 *
 * **Claim first, then revert on failure**, exactly as `lib/voucher-auto-send.ts`
 * does: the repricing that follows a close is wrapped, and a throw puts the
 * grant back the way it was. Without that a transient failure would leave a
 * family's discount closed and their open vouchers priced as though it were
 * not, which is the one state nothing on any screen would report.
 */

/** A scheme a school could grant as its sibling discount. */
export interface SiblingSchemeRow {
  id: string;
  name: string;
  discountType: 'percentage' | 'fixed';
  discountValue: string;
}

/**
 * Every **active** scheme of type `sibling` at this school.
 *
 * Returns a list rather than one row on purpose. A school with two active
 * sibling schemes has not decided which one it means, and picking either at
 * random would file half its families under a rate nobody chose — so the
 * auto-apply below does nothing and says why, and the screens report the
 * ambiguity rather than resolving it.
 *
 * check-branch-scope: school-wide by design. A sibling discount is a family
 * fact and a family crosses campuses (item 8); scoping this to a campus would
 * make the auto-apply silently do nothing at the campus the scheme is not
 * owned by.
 */
export async function activeSiblingSchemes(
  locationId: string,
): Promise<SiblingSchemeRow[]> {
  return db
    .select({
      id: concessionSchemes.id,
      name: concessionSchemes.name,
      discountType: concessionSchemes.discountType,
      discountValue: concessionSchemes.discountValue,
    })
    .from(concessionSchemes)
    .where(
      and(
        eq(concessionSchemes.locationId, locationId),
        eq(concessionSchemes.schemeType, 'sibling'),
        eq(concessionSchemes.isActive, true),
      ),
    )
    .orderBy(asc(concessionSchemes.name));
}

/** One enrolled child of a family, as the ranking sees them. */
export interface FamilyMember {
  studentProfileId: string;
  studentId: string;
  name: string;
  enrollmentDate: string;
  branchId: string | null;
  branchName: string | null;
}

/**
 * The enrolled children among a set of student ids, eldest enrolment first.
 *
 * ⚠ **No branch predicate, ever.** `location_id` and nothing else. A family is
 * a family across campuses — `lib/siblings.ts` has matched on the school since
 * it was written and joins no `branches` — and `resolveBranchScope` applied
 * here would split one family into two on the day a school opened its second
 * campus. The sibling card would empty, the family voucher would split, the
 * discount would silently stop being granted, and **nothing would report an
 * error**. `scripts/check-branch-scope.ts` asserts the absence of a predicate
 * here in so many words, because this is the natural mistake for the next
 * scoping pass to make.
 *
 * check-branch-scope: school-wide by design — see the banner above.
 */
async function enrolledFamily(
  locationId: string,
  studentProfileIds: readonly string[],
): Promise<FamilyMember[]> {
  if (studentProfileIds.length === 0) return [];

  const activeYear = await db
    .select({ id: academicYears.id })
    .from(academicYears)
    .where(
      and(eq(academicYears.locationId, locationId), eq(academicYears.isActive, true)),
    )
    .limit(1);

  const yearId = activeYear[0]?.id ?? null;

  return db
    .select({
      studentProfileId: studentProfiles.id,
      studentId: studentProfiles.studentId,
      name: schoolUsers.name,
      enrollmentDate: studentEnrollments.enrollmentDate,
      branchId: grades.branchId,
      branchName: branches.name,
    })
    .from(studentEnrollments)
    .innerJoin(
      studentProfiles,
      eq(studentProfiles.id, studentEnrollments.studentProfileId),
    )
    .innerJoin(schoolUsers, eq(schoolUsers.id, studentProfiles.schoolUserId))
    .innerJoin(sections, eq(sections.id, studentEnrollments.sectionId))
    .innerJoin(grades, eq(grades.id, sections.gradeId))
    .leftJoin(branches, eq(branches.id, grades.branchId))
    .where(
      and(
        eq(studentEnrollments.locationId, locationId),
        eq(studentEnrollments.status, 'active'),
        ...(yearId === null ? [] : [eq(studentEnrollments.academicYearId, yearId)]),
        inArray(studentEnrollments.studentProfileId, [...studentProfileIds]),
      ),
    )
    /*
     * The ranking, and it is the whole of rule 9a. Enrolment date first,
     * admission number as the tie-break — both facts that do not change when
     * somebody corrects a name, which is what stops the discount moving between
     * children for no reason anyone could explain.
     */
    .orderBy(asc(studentEnrollments.enrollmentDate), asc(studentProfiles.studentId));
}

/** Where one student stands in their family, and whether that earns a discount. */
export interface SiblingStanding {
  /** Everyone in this family on the roll today, eldest enrolment first. */
  family: FamilyMember[];
  /** Siblings as the sibling card shows them, enrolled or not. */
  siblings: SiblingRow[];
  /** This student's 1-based place in `family`, or 0 when they are not on it. */
  rank: number;
  /** True when the family has two or more here and this one is not the first. */
  qualifies: boolean;
}

/**
 * Rule 9a, for one enrolled student.
 *
 * `listSiblings` decides *who is family* — one hop through a shared guardian,
 * matched on CNIC or phone, school-wide — and this decides who among them is
 * on the roll and in what order.
 */
export async function siblingStandingFor(
  locationId: string,
  studentProfileId: string,
): Promise<SiblingStanding> {
  const siblings = await listSiblings(locationId, studentProfileId);

  const family = await enrolledFamily(locationId, [
    studentProfileId,
    ...siblings.map((sibling) => sibling.studentProfileId),
  ]);

  const index = family.findIndex(
    (member) => member.studentProfileId === studentProfileId,
  );

  return {
    family,
    siblings,
    rank: index + 1,
    // Two or more here, and not the eldest enrolment. A family of one gets
    // nothing, which is rule 9a in one line.
    qualifies: family.length >= 2 && index > 0,
  };
}

/**
 * The same question for a child who is **not enrolled yet** — the wizard.
 *
 * There is no student to start from, so the keys come straight off the guardian
 * rows the clerk has typed. A child being admitted today is by definition the
 * newest enrolment, so any existing enrolled sibling means they qualify: there
 * is nobody they could displace at the top of the ranking.
 */
export async function siblingStandingForNewChild(
  locationId: string,
  identities: readonly { cnic: string | null; phone: string | null }[],
): Promise<SiblingStanding> {
  const seen = new Map<string, SiblingRow>();

  for (const identity of identities) {
    const found = await listStudentsForGuardianIdentity(locationId, identity);
    for (const row of found) seen.set(row.studentProfileId, row);
  }

  const siblings = [...seen.values()].sort((left, right) =>
    left.name.localeCompare(right.name),
  );

  const family = await enrolledFamily(
    locationId,
    siblings.map((sibling) => sibling.studentProfileId),
  );

  return {
    family,
    siblings,
    // They are not on the roll yet, so they have no rank. Written as
    // `family.length + 1` rather than 0 because the panel prints it as "the
    // second child of this family", which is what an admissions clerk is being
    // told and is true the moment the enrolment commits.
    rank: family.length + 1,
    qualifies: family.length >= 1,
  };
}

/** The two sibling settings, with the defaults a school that has none gets. */
export interface SiblingPolicy {
  autoApply: boolean;
  keepForLastChild: boolean;
}

export async function siblingPolicyFor(locationId: string): Promise<SiblingPolicy> {
  const rows = await db
    .select({
      autoApply: lateFeeRules.autoApplySiblingDiscount,
      keepForLastChild: lateFeeRules.siblingDiscountForLastChild,
    })
    .from(lateFeeRules)
    .where(eq(lateFeeRules.locationId, locationId))
    .limit(1);

  // Both off for a school that has never opened the fee settings screen. That
  // is the only safe reading: the alternative is a school discovering it has
  // been discounting fees because a table had no row in it.
  return rows[0] ?? { autoApply: false, keepForLastChild: false };
}

/** What `autoApplySiblingDiscountFor` did, for the caller's log line. */
export type AutoApplyOutcome =
  | { granted: false; reason: 'policy_off' | 'no_scheme' | 'ambiguous_scheme' | 'not_qualified' }
  | { granted: true; schemeName: string };

/**
 * Item 6a. Grants the school's sibling scheme to a newly enrolled child, when
 * the school has asked for that and the child qualifies.
 *
 * ── It runs AFTER the enrolment has committed, and never throws ──────────
 * A deliberate departure from the spec's own hazard note, and the reason is the
 * argument this repository has already made twice — about the GHL sync and
 * about the photo upload. **A child admitted is a fact.** A discount that did
 * not apply is one click from the profile, is visible there (the panel says the
 * child qualifies and offers the button), and self-heals. An admission that
 * rolled back because a discount failed is a queue at the admissions desk and a
 * clerk told to "check the details", with no detail wrong.
 *
 * So this is called from `POST /api/school/students` after `enrollStudent`
 * returns, it swallows its own failures, and it reports what it did rather than
 * throwing. `enrollStudent`'s `batch()` could not have contained it in any case
 * — every statement in a batch is built before any of them runs, and this needs
 * the guardians in the database to know whether there is a sibling at all.
 */
export async function autoApplySiblingDiscountFor(params: {
  locationId: string;
  studentProfileId: string;
  actorUid: string;
}): Promise<AutoApplyOutcome> {
  const { locationId, studentProfileId, actorUid } = params;

  const policy = await siblingPolicyFor(locationId);
  if (!policy.autoApply) return { granted: false, reason: 'policy_off' };

  const schemes = await activeSiblingSchemes(locationId);

  if (schemes.length === 0) {
    console.warn(
      `[sibling-discount] ${locationId}: auto-apply is on but no active sibling scheme exists`,
    );
    return { granted: false, reason: 'no_scheme' };
  }

  /*
   * Two active sibling schemes is not a case to resolve — it is a case to
   * refuse. Choosing one at random files half a school's families under a rate
   * nobody picked, and the difference only surfaces when two parents compare
   * their vouchers.
   */
  if (schemes.length > 1) {
    console.warn(
      `[sibling-discount] ${locationId}: ${String(schemes.length)} active sibling schemes, so nothing was granted automatically`,
    );
    return { granted: false, reason: 'ambiguous_scheme' };
  }

  const scheme = schemes[0]!;
  const standing = await siblingStandingFor(locationId, studentProfileId);
  if (!standing.qualifies) return { granted: false, reason: 'not_qualified' };

  /*
   * `applySchemeToStudents` and not a second grant path. It is the one place
   * the freezing rule lives — the scheme's name, rate, dates and heads are
   * copied onto the grant — and a second writer would be a second place for
   * that to be forgotten. It also skips a student who already holds the scheme
   * and reprices their open vouchers, both of which are wanted here.
   */
  await applySchemeToStudents({
    locationId,
    schemeId: scheme.id,
    studentProfileIds: [studentProfileId],
    actorUid,
  });

  return { granted: true, schemeName: scheme.name };
}

/** What the enrolment applied, for the response and the log. */
export interface EnrollmentDiscountResult {
  /** Schemes the clerk chose on the wizard's Discounts step. */
  chosen: number;
  /** Grants actually written. Lower than `chosen` when one was already held. */
  granted: number;
  /** The sibling scheme's name when auto-apply granted one, else null. */
  autoApplied: string | null;
  /** A sentence for the clerk when something did not happen. */
  problem: string | null;
}

/**
 * Everything a new enrolment does about discounts, in one call that never
 * throws.
 *
 * Called from `POST /api/school/students` **after** `enrollStudent` has
 * committed. See `autoApplySiblingDiscountFor` for why that is outside the
 * transaction and why that is the right call.
 */
export async function applyEnrollmentDiscounts(params: {
  locationId: string;
  actorUid: string;
  studentProfileId: string;
  schemeIds: readonly string[];
}): Promise<EnrollmentDiscountResult> {
  const { locationId, actorUid, studentProfileId } = params;

  let granted = 0;
  let autoApplied: string | null = null;
  let problem: string | null = null;

  /*
   * The clerk's own choices first, then the automatic one.
   *
   * That order matters at a school with auto-apply on where the clerk has also
   * ticked the sibling scheme by hand: `applySchemeToStudents` skips a student
   * who already holds the scheme, so the automatic pass finds it already there
   * and grants nothing. The reverse order would produce the same rows, and this
   * way the clerk's deliberate act is the one recorded first.
   */
  for (const schemeId of params.schemeIds) {
    try {
      const result = await applySchemeToStudents({
        locationId,
        schemeId,
        studentProfileIds: [studentProfileId],
        actorUid,
      });
      granted += result.granted;
    } catch (caught) {
      problem = 'One of the chosen discounts could not be applied. Apply it from the student’s profile.';
      console.error(
        `[sibling-discount] chosen scheme ${schemeId} failed at ${locationId}: ${describeError(caught)}`,
      );
    }
  }

  try {
    const outcome = await autoApplySiblingDiscountFor({
      locationId,
      studentProfileId,
      actorUid,
    });

    if (outcome.granted) autoApplied = outcome.schemeName;
    else if (outcome.reason === 'no_scheme') {
      problem =
        'This school applies the sibling discount automatically but has no active Sibling Discount scheme, so nothing was granted.';
    } else if (outcome.reason === 'ambiguous_scheme') {
      problem =
        'This school has more than one active Sibling Discount scheme, so none was granted automatically.';
    }
  } catch (caught) {
    problem =
      'The sibling discount could not be applied automatically. Apply it from the student’s profile.';
    console.error(
      `[sibling-discount] auto-apply failed at ${locationId}: ${describeError(caught)}`,
    );
  }

  return { chosen: params.schemeIds.length, granted, autoApplied, problem };
}

/* -----------------------------------------------------------------------------
 * Rule 9b — the last one standing loses it.
 * -------------------------------------------------------------------------- */

/** An open sibling grant, and the child holding it. */
interface OpenSiblingGrant {
  concessionId: string;
  locationId: string;
  studentProfileId: string;
  concessionName: string;
  validFrom: string;
  validUntil: string | null;
  notes: string | null;
}

/**
 * Every open grant that came from a `sibling` scheme, at schools that have not
 * asked to keep it for the last child.
 *
 * ── Two callers, two scopes ──────────────────────────────────────────────
 * The timer passes nothing and sweeps the platform, which is what a backstop
 * is. The synchronous hooks pass `only` — one school and a handful of students
 * — because a clerk deleting one child must not make the server read every open
 * sibling grant at every tenant. Both narrowings are in the SQL rather than in
 * a `.filter()` afterwards, for the obvious reason.
 *
 * The `late_fee_rules` join is a LEFT one: a school with no settings row has
 * never chosen, and the column's default is false, so it is swept. Making it an
 * INNER join would silently exempt every school that has not opened the fee
 * settings screen — which is most of them.
 */
async function openSiblingGrants(
  today: string,
  only?: { locationId: string; studentProfileIds: readonly string[] },
): Promise<OpenSiblingGrant[]> {
  return db
    .select({
      concessionId: studentConcessions.id,
      locationId: studentConcessions.locationId,
      studentProfileId: studentConcessions.studentProfileId,
      concessionName: studentConcessions.concessionName,
      validFrom: studentConcessions.validFrom,
      validUntil: studentConcessions.validUntil,
      notes: studentConcessions.notes,
    })
    .from(studentConcessions)
    .innerJoin(
      concessionSchemes,
      and(
        eq(concessionSchemes.id, studentConcessions.schemeId),
        eq(concessionSchemes.schemeType, 'sibling'),
      ),
    )
    .leftJoin(
      lateFeeRules,
      eq(lateFeeRules.locationId, studentConcessions.locationId),
    )
    .where(
      and(
        // Still open. `gt`, not a raw template: the value crosses the driver
        // through the column's own mapper — CLAUDE.md, and the scheduled
        // announcements that never released.
        or(
          isNull(studentConcessions.validUntil),
          gt(studentConcessions.validUntil, today),
        ),
        or(
          isNull(lateFeeRules.siblingDiscountForLastChild),
          eq(lateFeeRules.siblingDiscountForLastChild, false),
        ),
        ...(only === undefined
          ? []
          : [
              eq(studentConcessions.locationId, only.locationId),
              // `inArray` with an empty list is `false` in Drizzle, which is
              // the right reading: a caller naming no students wants no rows.
              inArray(studentConcessions.studentProfileId, [
                ...only.studentProfileIds,
              ]),
            ]),
      ),
    );
}

/**
 * The date a closed grant runs to.
 *
 * Yesterday, so the grant stops applying to anything billed from today — and
 * never before `valid_from`, because a window that ends before it begins is a
 * row nobody can read. A grant made and closed on the same day therefore runs
 * for that one day, which is honest: it *was* granted.
 */
export function closingDate(today: string, validFrom: string): string {
  const yesterday = new Date(`${today}T00:00:00Z`);
  yesterday.setUTCDate(yesterday.getUTCDate() - 1);
  const closed = yesterday.toISOString().slice(0, 10);
  return closed < validFrom ? validFrom : closed;
}

/** The note an automatic removal leaves behind. */
function removalNote(existing: string | null, today: string): string {
  const line =
    `Closed automatically on ${today}: this is the only child of this family ` +
    'still enrolled here, so the sibling discount no longer applies. Switch ' +
    '“Keep the discount when only one child is left” on under Fees → Settings ' +
    'to stop this happening.';

  // Appended, never replaced. Whatever a human wrote on this grant is the
  // reason it exists, and an automatic process must not be the thing that
  // erases it.
  return existing === null || existing.trim() === '' ? line : `${existing}\n\n${line}`;
}

/**
 * Closes one grant, and only if nobody else already has.
 *
 * **This is the claim.** The `WHERE` repeats the "still open" test the
 * candidate read used, so of seven scheduler processes holding the same
 * candidate exactly one gets a row back and the other six get none. Postgres
 * decides it under one lock; there is no read-then-`if` anywhere in this path.
 */
async function closeGrant(
  grant: OpenSiblingGrant,
  today: string,
): Promise<boolean> {
  const claimed = await db
    .update(studentConcessions)
    .set({
      validUntil: closingDate(today, grant.validFrom),
      notes: removalNote(grant.notes, today),
    })
    .where(
      and(
        eq(studentConcessions.id, grant.concessionId),
        or(
          isNull(studentConcessions.validUntil),
          gt(studentConcessions.validUntil, today),
        ),
      ),
    )
    .returning({ id: studentConcessions.id });

  return claimed.length > 0;
}

/** Puts a grant back exactly as it was, after the work following the claim threw. */
async function reopenGrant(grant: OpenSiblingGrant): Promise<void> {
  await db
    .update(studentConcessions)
    .set({ validUntil: grant.validUntil, notes: grant.notes })
    .where(eq(studentConcessions.id, grant.concessionId));
}

/**
 * Closes the grant if this child no longer qualifies, and reprices.
 *
 * Returns true when something was closed **by this caller**. The claim is what
 * makes that answer meaningful: a second process arriving a millisecond later
 * gets false and does nothing rather than writing a second note.
 */
async function reconcileGrant(
  grant: OpenSiblingGrant,
  today: string,
  actorUid: string,
): Promise<boolean> {
  const standing = await siblingStandingFor(grant.locationId, grant.studentProfileId);

  /*
   * The removal rule is **only** the last-one-standing case, and that is a
   * decision rather than an omission.
   *
   * Rule 9a ranks a family so that the eldest enrolment pays full and the rest
   * are discounted, and it would be arithmetically consistent to re-run that
   * ranking here and close the grant of whoever is now first. It is not done:
   * when the eldest of three leaves, that would take the discount off the
   * middle child — a fee *rise* on a family that still has two children at the
   * school, which is the opposite of what a sibling discount is for and which
   * no requirement asks for. The ranking decides who is granted one; only
   * running out of siblings takes one away.
   */
  if (standing.family.length >= 2) return false;

  // A child who has left keeps their grant untouched. Their history stays
  // explainable and their outstanding vouchers are not repriced *upward* on
  // their way out of the school, which would be the school billing a departing
  // family more than the slip they were handed.
  if (standing.rank === 0) return false;

  if (!(await closeGrant(grant, today))) return false;

  try {
    /*
     * Repricing, which usually changes nothing — and that is the point.
     *
     * The close date is yesterday and an open voucher is matched against its
     * own billing date, which is earlier, so this month's slip keeps its
     * discount. Next month's is raised without it. The call is made anyway
     * because "every concession change reprices" is the invariant, and a path
     * that skipped it would be the one place that stopped being true.
     */
    await repriceOpenChallans(db, {
      locationId: grant.locationId,
      studentProfileId: grant.studentProfileId,
      actorUid,
    });
  } catch (caught) {
    // Claim first, revert on failure — CLAUDE.md, and `voucher-auto-send`'s
    // `releaseClaim` is the worked example. A grant left closed with its
    // vouchers unrepriced is the one state no screen would report.
    await reopenGrant(grant).catch((error: unknown) => {
      console.error(
        `[sibling-discount] could not reopen ${grant.concessionId}: ${describeError(error)}`,
      );
    });
    throw caught;
  }

  return true;
}

/**
 * The synchronous half of rule 9b: reconcile a named set of children, now,
 * because somebody is watching.
 *
 * A parent must not have to wait for a timer to learn that their fee has gone
 * up, and the desk that has just removed a child from the roll is the only
 * place the consequence can be explained. The sweep above is the backstop for
 * the paths nobody thought of.
 *
 * Never throws. Whatever it could not close is picked up within the quarter
 * hour, and a departure that failed because a discount would not close is a
 * worse outcome than a discount that closes fifteen minutes late.
 */
export async function reconcileSiblingGrantsFor(params: {
  locationId: string;
  studentProfileIds: readonly string[];
  actorUid: string;
}): Promise<number> {
  const { locationId, actorUid } = params;
  const ids = [...new Set(params.studentProfileIds)];
  if (ids.length === 0) return 0;

  const today = toDateOnly(new Date());

  try {
    const grants = await openSiblingGrants(today, {
      locationId,
      studentProfileIds: ids,
    });

    let closed = 0;
    for (const grant of grants) {
      try {
        if (await reconcileGrant(grant, today, actorUid)) closed += 1;
      } catch (caught) {
        console.error(
          `[sibling-discount] ${grant.concessionId} failed at ${locationId}: ${describeError(caught)}`,
        );
      }
    }
    return closed;
  } catch (caught) {
    console.error(
      `[sibling-discount] reconcile failed at ${locationId}: ${describeError(caught)}`,
    );
    return 0;
  }
}

/**
 * Everybody a departing child was family with, resolved **before** they go.
 *
 * Called on the way *into* a deletion, because `student_guardians` cascades
 * with the profile: once the row is gone there is nothing left to match on and
 * the family is unrecoverable. The ids come back so the caller can reconcile
 * them afterwards, when the roll actually reflects the departure.
 */
export async function familyIdsBeforeDeparture(
  locationId: string,
  studentProfileId: string,
): Promise<string[]> {
  try {
    const siblings = await listSiblings(locationId, studentProfileId);
    return siblings.map((sibling) => sibling.studentProfileId);
  } catch (caught) {
    console.error(
      `[sibling-discount] could not read the family of ${studentProfileId} at ${locationId}: ${describeError(caught)}`,
    );
    return [];
  }
}

/**
 * The same, for a departure that leaves the student's rows in place — a
 * graduation, a withdrawal, any status moving off `active`.
 *
 * Safe to call afterwards, because the guardian rows survive: the family is
 * still resolvable from the child who left.
 */
export async function reconcileFamilyAfterDeparture(params: {
  locationId: string;
  studentProfileId: string;
  actorUid: string;
}): Promise<number> {
  const { locationId, studentProfileId, actorUid } = params;

  const siblings = await familyIdsBeforeDeparture(locationId, studentProfileId);

  return reconcileSiblingGrantsFor({
    locationId,
    // The departing child is included: their own grant is left alone by
    // `reconcileGrant` when they are off the roll, but a *withdrawal that was
    // undone* — a status corrected back to active — has to be able to reach
    // them again, and a set that never named them could not.
    studentProfileIds: [studentProfileId, ...siblings],
    actorUid,
  });
}

/* -----------------------------------------------------------------------------
 * The sweep.
 * -------------------------------------------------------------------------- */

/**
 * How often the backstop looks.
 *
 * Fifteen minutes, not one. The synchronous hooks above do the work at the two
 * moments a family's shape changes and somebody is watching; this exists for
 * the paths nobody thought of — a status edited straight on a record, a bulk
 * import that marks a cohort completed, a row changed at a psql prompt. The
 * candidate query is the cost here (unlike the auto-send sweep, whose claim
 * makes 1,439 of its 1,440 daily ticks free), and production runs seven of
 * these, so a slower cadence is the honest trade.
 */
const SWEEP_SECONDS = 15 * 60;

let sweepTimer: NodeJS.Timeout | null = null;
let sweeping = false;

/** One tick. Returns how many grants this process closed. */
export async function sweepSiblingDiscounts(now: Date = new Date()): Promise<number> {
  const today = toDateOnly(now);
  const grants = await openSiblingGrants(today);

  let closed = 0;

  for (const grant of grants) {
    try {
      if (await reconcileGrant(grant, today, 'system:sibling-sweep')) closed += 1;
    } catch (caught) {
      // One family's failure must not abandon the rest, and a throw here would
      // reach a timer callback with nothing to catch it.
      console.error(
        `[sibling-discount] ${grant.locationId}/${grant.concessionId} failed: ${describeError(caught)}`,
      );
    }
  }

  return closed;
}

/** Starts the sweep. Idempotent, like the outbox drainer beside it. */
export function startSiblingDiscountSweep(): void {
  if (sweepTimer !== null) return;

  sweepTimer = setInterval(() => {
    if (sweeping) return;
    sweeping = true;

    void sweepSiblingDiscounts()
      .then((closed) => {
        if (closed > 0) {
          console.info(`[sibling-discount] closed ${String(closed)} grant(s)`);
        }
      })
      .catch((caught: unknown) => {
        console.error(`[sibling-discount] sweep failed: ${describeError(caught)}`);
      })
      .finally(() => {
        sweeping = false;
      });
  }, SWEEP_SECONDS * 1000);

  // Never a reason to refuse to shut down.
  sweepTimer.unref?.();

  console.info(
    `[sibling-discount] sweep started (every ${String(SWEEP_SECONDS / 60)} minutes)`,
  );
}
