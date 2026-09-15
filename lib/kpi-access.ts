import 'server-only';

import { and, asc, count, desc, eq, gte, inArray, isNotNull, isNull, lte, or } from 'drizzle-orm';

import {
  academicYears,
  branches,
  coordinatorTeachers,
  grades,
  principalAssignments,
  schoolUsers,
  sections,
  staff,
  staffKpiRatings,
  staffKpiSettings,
  staffKpis,
  teacherPrincipals,
  timetableEntries,
  vicePrincipalPrincipals,
  STAFF_KPI_TARGET_ROLES,
  type PrincipalModel,
  type StaffKpiPeriod,
  type StaffKpiTargetRole,
  type TeacherPrincipalSource,
} from '@/db/schema';
import { ROLE_LABELS, type UserRole } from '@/types/school-auth';

import { resolveBranchScope, sharedOrOwnedBy } from './branch-scope';
import { db } from './drizzle';
import {
  DEFAULT_KPI_SETTINGS,
  derivePrincipal,
  isMonthKey,
  monthKeyFromDate,
  monthsOfYear,
  rateKeyFor,
  type AssignmentLike,
  type BranchAdminRater,
  type DerivedPrincipal,
  type KpiSettings,
  type MonthKey,
  type PrincipalRater,
  type RatingRecord,
} from './kpis';
import { permissionsForRole } from './permission-queries';
import type { Permission } from './permissions';
import { getPrincipalModel } from './principal-resolver';

/**
 * `lib/kpi-access.ts` — Sprint 32. Who may define, rate and see which KPIs.
 *
 * ── One resolver, enforced on the write ──────────────────────────────────
 * The permission key is never the whole rule. "A principal rates only their
 * own teachers", "a coordinator only the teachers assigned to them", "a
 * deputy never rates a deputy" and rule 7's two settings are *scoping* rules,
 * in the way `payroll.approve` is a key plus "your own grades". They live here
 * and nowhere else, and every route calls `rateRefusal` again on the write —
 * `lib/principal-resolver.ts` calls itself a visibility boundary, and for a
 * rating that is not good enough.
 *
 * ── Why this does not reuse `resolveRunApprovers` ────────────────────────
 * Payroll covers a person when the campus matches *or* the grades intersect,
 * so one teacher can fall under two heads. Rule 7b says that never happens
 * here. The teacher's principal is derived from where they teach **most**,
 * stored in `teacher_principals`, and overridden only by a transfer.
 */

/* ------------------------------------------------------------ people */

/** A member of staff who can be rated. */
export interface StaffPerson {
  userId: string;
  name: string;
  role: StaffKpiTargetRole;
  branchId: string | null;
  branchName: string | null;
  /** The HR record behind the login, when there is one. */
  staffId: string | null;
  designation: string | null;
}

export async function listStaffPeople(locationId: string): Promise<StaffPerson[]> {
  const rows = await db
    .select({
      userId: schoolUsers.id,
      name: schoolUsers.name,
      role: schoolUsers.role,
      branchId: schoolUsers.branchId,
      branchName: branches.name,
    })
    .from(schoolUsers)
    .leftJoin(branches, eq(branches.id, schoolUsers.branchId))
    .where(
      and(
        eq(schoolUsers.locationId, locationId),
        eq(schoolUsers.isActive, true),
        inArray(schoolUsers.role, [...STAFF_KPI_TARGET_ROLES]),
      ),
    )
    .orderBy(asc(schoolUsers.name));

  if (rows.length === 0) return [];

  // A second read rather than a join: `staff.school_user_id` is not unique, and
  // a join would print a person twice the day HR keeps two records for them.
  const records = await db
    .select({ id: staff.id, schoolUserId: staff.schoolUserId, designation: staff.designation })
    .from(staff)
    .where(
      and(
        eq(staff.locationId, locationId),
        inArray(
          staff.schoolUserId,
          rows.map((row) => row.userId),
        ),
      ),
    )
    .orderBy(asc(staff.createdAt));

  const recordFor = new Map<string, { id: string; designation: string | null }>();
  for (const record of records) {
    if (record.schoolUserId !== null && !recordFor.has(record.schoolUserId)) {
      recordFor.set(record.schoolUserId, { id: record.id, designation: record.designation });
    }
  }

  return rows.map((row) => ({
    userId: row.userId,
    name: row.name,
    role: row.role as StaffKpiTargetRole,
    branchId: row.branchId,
    branchName: row.branchName,
    staffId: recordFor.get(row.userId)?.id ?? null,
    designation: recordFor.get(row.userId)?.designation ?? null,
  }));
}

/** The signed-in caller's own membership row. */
async function callerRow(
  locationId: string,
  authUserId: string,
): Promise<{ id: string; name: string } | null> {
  const rows = await db
    .select({ id: schoolUsers.id, name: schoolUsers.name })
    .from(schoolUsers)
    .where(and(eq(schoolUsers.locationId, locationId), eq(schoolUsers.authUserId, authUserId)))
    .orderBy(asc(schoolUsers.createdAt), asc(schoolUsers.id))
    .limit(1);
  return rows[0] ?? null;
}

/* ---------------------------------------------------------- settings */

export async function getKpiSettings(locationId: string): Promise<KpiSettings> {
  const rows = await db
    .select()
    .from(staffKpiSettings)
    .where(eq(staffKpiSettings.locationId, locationId))
    .limit(1);

  const row = rows[0];
  if (row === undefined) return { ...DEFAULT_KPI_SETTINGS };

  return {
    ratePrincipals: row.ratePrincipals,
    principalRaters: row.principalRaters as PrincipalRater[],
    rateBranchAdmins: row.rateBranchAdmins,
    branchAdminRaters: row.branchAdminRaters as BranchAdminRater[],
  };
}

export async function saveKpiSettings(
  locationId: string,
  settings: KpiSettings,
  updatedBy: string | null,
): Promise<void> {
  const now = new Date();
  await db
    .insert(staffKpiSettings)
    .values({ locationId, ...settings, updatedBy, updatedAt: now })
    .onConflictDoUpdate({
      target: staffKpiSettings.locationId,
      set: { ...settings, updatedBy, updatedAt: now },
    });
}

/* ------------------------------------------ one teacher, one principal */

export interface LiveAssignment extends AssignmentLike {
  principalName: string;
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Principal assignments in force today, held by active principals. */
export async function liveAssignments(locationId: string): Promise<LiveAssignment[]> {
  const now = today();
  const rows = await db
    .select({
      principalUserId: principalAssignments.schoolUserId,
      principalName: schoolUsers.name,
      branchId: principalAssignments.branchId,
      gradeIds: principalAssignments.gradeIds,
    })
    .from(principalAssignments)
    .innerJoin(schoolUsers, eq(schoolUsers.id, principalAssignments.schoolUserId))
    .where(
      and(
        eq(principalAssignments.locationId, locationId),
        eq(schoolUsers.isActive, true),
        eq(schoolUsers.role, 'principal'),
        lte(principalAssignments.startsOn, now),
        or(isNull(principalAssignments.endsOn), gte(principalAssignments.endsOn, now)),
      ),
    )
    .orderBy(asc(schoolUsers.name));

  return rows;
}

/** How a teacher's principal is known, for the screens. */
export interface TeacherPrincipalAnswer {
  principalUserId: string | null;
  /** `single` at a one-principal school, where nothing is stored. */
  source: TeacherPrincipalSource | 'single' | null;
  reason: DerivedPrincipal['reason'] | null;
  periods: number;
  candidates: string[];
}

/**
 * Every teacher's principal, reconciling the stored rows as it goes.
 *
 * ── A read that writes, deliberately and narrowly ────────────────────────
 * The derivation depends on the timetable and on principal assignments, which
 * are edited on screens that know nothing of KPIs. Hooking every one of those
 * writes would put this rule in eight routes. Instead the stored answer is
 * brought up to date whenever it is *used*: a derived row that no longer
 * matches is ended and replaced, and a transferred or assigned row is left
 * alone — a later timetable change does not undo a transfer.
 *
 * Race-safe for the seven schedulers and two principals who load at once: an
 * end is conditional on `ended_at IS NULL`, and an insert that loses to the
 * partial unique index does nothing.
 */
export async function resolveTeacherPrincipals(
  locationId: string,
  model: PrincipalModel,
  teachers: readonly StaffPerson[],
  principals: readonly StaffPerson[],
  assignments: readonly LiveAssignment[],
): Promise<Map<string, TeacherPrincipalAnswer>> {
  const answers = new Map<string, TeacherPrincipalAnswer>();

  if (model === 'single') {
    const head = principals[0]?.userId ?? null;
    for (const teacher of teachers) {
      answers.set(teacher.userId, {
        principalUserId: head,
        source: head === null ? null : 'single',
        reason: null,
        periods: 0,
        candidates: [],
      });
    }
    return answers;
  }

  if (teachers.length === 0) return answers;

  const [periodRows, homeRows, currentRows] = await Promise.all([
    db
      .select({
        teacherUserId: timetableEntries.teacherId,
        gradeId: sections.gradeId,
        branchId: grades.branchId,
        periods: count(),
      })
      .from(timetableEntries)
      .innerJoin(sections, eq(sections.id, timetableEntries.sectionId))
      .innerJoin(grades, eq(grades.id, sections.gradeId))
      .where(
        and(eq(timetableEntries.locationId, locationId), eq(timetableEntries.isActive, true)),
      )
      .groupBy(timetableEntries.teacherId, sections.gradeId, grades.branchId),
    db
      .select({
        teacherUserId: staff.schoolUserId,
        gradeId: sections.gradeId,
        branchId: grades.branchId,
      })
      .from(sections)
      .innerJoin(staff, eq(staff.id, sections.classTeacherId))
      .innerJoin(grades, eq(grades.id, sections.gradeId))
      .where(
        and(
          eq(sections.locationId, locationId),
          eq(sections.isActive, true),
          isNotNull(staff.schoolUserId),
        ),
      ),
    db
      .select({
        id: teacherPrincipals.id,
        teacherUserId: teacherPrincipals.teacherUserId,
        principalUserId: teacherPrincipals.principalUserId,
        source: teacherPrincipals.source,
        periods: teacherPrincipals.periods,
      })
      .from(teacherPrincipals)
      .where(and(eq(teacherPrincipals.locationId, locationId), isNull(teacherPrincipals.endedAt))),
  ]);

  const periodsBy = new Map<string, { gradeId: string; branchId: string; periods: number }[]>();
  for (const row of periodRows) {
    const list = periodsBy.get(row.teacherUserId) ?? [];
    list.push({ gradeId: row.gradeId, branchId: row.branchId, periods: Number(row.periods) });
    periodsBy.set(row.teacherUserId, list);
  }

  const homeBy = new Map<string, { gradeId: string; branchId: string }[]>();
  for (const row of homeRows) {
    if (row.teacherUserId === null) continue;
    const list = homeBy.get(row.teacherUserId) ?? [];
    list.push({ gradeId: row.gradeId, branchId: row.branchId });
    homeBy.set(row.teacherUserId, list);
  }

  const currentBy = new Map(currentRows.map((row) => [row.teacherUserId, row]));
  const livePrincipals = new Set(principals.map((person) => person.userId));

  for (const teacher of teachers) {
    const derived = derivePrincipal(
      assignments,
      periodsBy.get(teacher.userId) ?? [],
      homeBy.get(teacher.userId) ?? [],
    );
    const current = currentBy.get(teacher.userId);

    // A transfer or an assignment stands while its principal is still in post.
    if (
      current !== undefined &&
      current.source !== 'derived' &&
      livePrincipals.has(current.principalUserId)
    ) {
      answers.set(teacher.userId, {
        principalUserId: current.principalUserId,
        source: current.source,
        reason: null,
        periods: derived.periods,
        candidates: [],
      });
      continue;
    }

    const wanted = derived.principalUserId;

    if (current !== undefined && current.principalUserId !== wanted) {
      await db
        .update(teacherPrincipals)
        .set({ endedAt: new Date() })
        .where(and(eq(teacherPrincipals.id, current.id), isNull(teacherPrincipals.endedAt)));
    }

    if (wanted !== null && (current === undefined || current.principalUserId !== wanted)) {
      await db
        .insert(teacherPrincipals)
        .values({
          locationId,
          teacherUserId: teacher.userId,
          principalUserId: wanted,
          source: 'derived',
          periods: derived.periods,
        })
        .onConflictDoNothing();
    }

    answers.set(teacher.userId, {
      principalUserId: wanted,
      source: wanted === null ? null : 'derived',
      reason: derived.reason,
      periods: derived.periods,
      candidates: derived.principalUserId === null ? derived.candidates : [],
    });
  }

  return answers;
}

/**
 * Moves a teacher to a principal in one transaction: the current row ends and
 * the new one starts. Used by an accepted transfer and by the School Admin
 * settling a tie.
 */
export async function setTeacherPrincipal(
  locationId: string,
  teacherUserId: string,
  principalUserId: string,
  source: 'transferred' | 'assigned',
  requestedBy: string | null,
): Promise<void> {
  await db.transaction(async (tx) => {
    await tx
      .update(teacherPrincipals)
      .set({ endedAt: new Date() })
      .where(
        and(
          eq(teacherPrincipals.locationId, locationId),
          eq(teacherPrincipals.teacherUserId, teacherUserId),
          isNull(teacherPrincipals.endedAt),
        ),
      );
    await tx.insert(teacherPrincipals).values({
      locationId,
      teacherUserId,
      principalUserId,
      source,
      requestedBy,
    });
  });
}

/* ------------------------------------------------------------ context */

export interface KpiCaller {
  userId: string | null;
  name: string;
  role: UserRole;
  branchId: string | null;
}

export interface KpiContext {
  locationId: string;
  caller: KpiCaller;
  permissions: ReadonlySet<Permission>;
  /** The caller's campus scope: null for every campus. */
  branchIds: string[] | null;
  model: PrincipalModel;
  settings: KpiSettings;
  people: StaffPerson[];
  byId: ReadonlyMap<string, StaffPerson>;
  principals: StaffPerson[];
  assignments: LiveAssignment[];
  teacherPrincipal: ReadonlyMap<string, TeacherPrincipalAnswer>;
  /** coordinator user id → the teachers they supervise. */
  supervised: ReadonlyMap<string, ReadonlySet<string>>;
  /** vice principal user id → the principal they serve. */
  vicePrincipalOf: ReadonlyMap<string, string>;
}

export async function loadKpiContext(
  locationId: string,
  auth: { uid: string; role: UserRole; branchId: string | null },
): Promise<KpiContext> {
  const [me, permissions, scope, model, settings, people, assignments, links, deputies] =
    await Promise.all([
      callerRow(locationId, auth.uid),
      permissionsForRole(locationId, auth.role),
      resolveBranchScope(locationId, { uid: auth.uid, branchId: auth.branchId }),
      getPrincipalModel(locationId),
      getKpiSettings(locationId),
      listStaffPeople(locationId),
      liveAssignments(locationId),
      db
        .select({
          coordinatorUserId: coordinatorTeachers.coordinatorUserId,
          teacherUserId: coordinatorTeachers.teacherUserId,
        })
        .from(coordinatorTeachers)
        .where(eq(coordinatorTeachers.locationId, locationId)),
      db
        .select({
          vicePrincipalUserId: vicePrincipalPrincipals.vicePrincipalUserId,
          principalUserId: vicePrincipalPrincipals.principalUserId,
        })
        .from(vicePrincipalPrincipals)
        .where(eq(vicePrincipalPrincipals.locationId, locationId)),
    ]);

  const principals = people.filter((person) => person.role === 'principal');
  const teachers = people.filter((person) => person.role === 'teacher');

  const teacherPrincipal = await resolveTeacherPrincipals(
    locationId,
    model,
    teachers,
    principals,
    assignments,
  );

  const supervised = new Map<string, Set<string>>();
  for (const link of links) {
    const set = supervised.get(link.coordinatorUserId) ?? new Set<string>();
    set.add(link.teacherUserId);
    supervised.set(link.coordinatorUserId, set);
  }

  return {
    locationId,
    caller: {
      userId: me?.id ?? null,
      name: me?.name ?? 'Platform operator',
      role: auth.role,
      branchId: auth.branchId,
    },
    permissions: new Set(permissions),
    branchIds: scope.branchIds,
    model,
    settings,
    people,
    byId: new Map(people.map((person) => [person.userId, person])),
    principals,
    assignments,
    teacherPrincipal,
    supervised,
    vicePrincipalOf: new Map(
      deputies.map((row) => [row.vicePrincipalUserId, row.principalUserId]),
    ),
  };
}

/* -------------------------------------------------------------- rules */

function roleNoun(role: StaffKpiTargetRole): string {
  return ROLE_LABELS[role];
}

function admitsBranch(ctx: KpiContext, branchId: string | null): boolean {
  if (ctx.branchIds === null || branchId === null) return true;
  return ctx.branchIds.includes(branchId);
}

/** Whether a principal's assignments reach a campus. Everything, at a `single` school. */
export function principalReaches(
  ctx: KpiContext,
  principalUserId: string,
  branchId: string | null,
): boolean {
  if (ctx.model === 'single') return true;
  return ctx.assignments.some(
    (assignment) =>
      assignment.principalUserId === principalUserId &&
      (assignment.branchId === null || branchId === null || assignment.branchId === branchId),
  );
}

/**
 * The principal a head-type caller acts as.
 *
 * `all` at a one-principal school, where the head reaches everybody. At a
 * several-principal school a principal is themselves and a vice principal is
 * whichever principal they serve (rule 7c) — null until the School Admin says.
 */
export function headIdentity(ctx: KpiContext): string | 'all' | null {
  if (ctx.caller.role !== 'principal' && ctx.caller.role !== 'vice_principal') return null;
  if (ctx.model === 'single') return 'all';
  if (ctx.caller.role === 'principal') return ctx.caller.userId;
  return ctx.caller.userId === null ? null : (ctx.vicePrincipalOf.get(ctx.caller.userId) ?? null);
}

function isHead(role: UserRole): boolean {
  return role === 'principal' || role === 'vice_principal';
}

/**
 * Fourth pass, confirmation 4: with **one** principal and no branch admin over
 * this person's campus, the principal rates the non-teaching staff. With several
 * principals and no branch admin, nobody below the School Admin does.
 */
function principalCoversNonTeaching(ctx: KpiContext, target: StaffPerson): boolean {
  const branchAdminThere = ctx.people.some(
    (person) =>
      person.role === 'branch_admin' &&
      (person.branchId === null || target.branchId === null || person.branchId === target.branchId),
  );
  if (branchAdminThere) return false;
  return ctx.model === 'single' || ctx.principals.length === 1;
}

/**
 * Why this caller may not rate this person on a KPI of this role — or null.
 *
 * Every refusal is a sentence the rating screen prints as it stands, so it
 * names the person and what would have to change.
 */
export function rateRefusal(
  ctx: KpiContext,
  target: StaffPerson,
  kpiTargetRole: StaffKpiTargetRole = target.role,
): string | null {
  const role = ctx.caller.role;
  const me = ctx.caller.userId;

  if (me === null) return 'Sign in with your own school account to enter a rating.';
  if (kpiTargetRole !== target.role) {
    return `That KPI is for ${roleNoun(kpiTargetRole)}, and ${target.name} is ${roleNoun(target.role)}.`;
  }

  const self = me === target.userId;
  if (!self && !admitsBranch(ctx, target.branchId)) {
    return `${target.name} is at a campus you do not have access to.`;
  }

  if (target.role === 'principal') {
    const { ratePrincipals, principalRaters } = ctx.settings;
    if (!ratePrincipals) {
      return 'Your school does not mark principals’ progress. A School Administrator can switch it on in Staff performance → Setup.';
    }
    if (self) {
      return principalRaters.includes('self') ? null : 'Principals do not rate themselves at your school.';
    }
    if (role === 'school_admin' && principalRaters.includes('school_admin')) return null;
    if (role === 'branch_admin' && principalRaters.includes('branch_admin')) return null;
    return 'You are not one of the people your school has chosen to rate principals.';
  }

  if (target.role === 'branch_admin') {
    const { rateBranchAdmins, branchAdminRaters } = ctx.settings;
    if (!rateBranchAdmins) {
      return 'Your school does not mark branch admins’ progress. A School Administrator can switch it on in Staff performance → Setup.';
    }
    if (self) {
      return branchAdminRaters.includes('self')
        ? null
        : 'Branch admins do not rate themselves at your school.';
    }
    if (role === 'school_admin' && branchAdminRaters.includes('school_admin')) return null;
    if (isHead(role) && branchAdminRaters.includes('principal')) {
      const head = headIdentity(ctx);
      if (head === 'all') return null;
      if (head !== null && principalReaches(ctx, head, target.branchId)) return null;
      return `${target.name} runs a campus outside your principal’s reach.`;
    }
    return 'You are not one of the people your school has chosen to rate branch admins.';
  }

  if (self) return 'You cannot rate yourself.';

  const key = rateKeyFor(target.role);
  const holds = key !== null && ctx.permissions.has(key);
  const noKey = `Your role does not rate ${roleNoun(target.role)} staff at this school.`;

  switch (target.role) {
    case 'vice_principal': {
      if (role === 'vice_principal') return 'A Vice Principal never rates a Vice Principal.';
      if (!holds) return noKey;
      if (role === 'principal' && ctx.model === 'multiple') {
        const serves = ctx.vicePrincipalOf.get(target.userId);
        const mine =
          serves !== undefined ? serves === me : principalReaches(ctx, me, target.branchId);
        if (!mine) return `${target.name} serves another principal.`;
      }
      return null;
    }

    case 'teacher': {
      if (!holds) return noKey;
      if (role === 'coordinator') {
        return ctx.supervised.get(me)?.has(target.userId) === true
          ? null
          : `${target.name} is not one of the teachers assigned to you.`;
      }
      if (isHead(role)) {
        const head = headIdentity(ctx);
        if (head === 'all') return null;
        if (head === null) {
          return 'Your school has not said which principal you serve, so no teachers are in your reach yet.';
        }
        const answer = ctx.teacherPrincipal.get(target.userId);
        if (answer?.principalUserId === head) return null;
        if (answer === undefined || answer.principalUserId === null) {
          return `${target.name} has no principal yet. The School Administrator decides, in Staff performance → Setup.`;
        }
        const theirs = ctx.byId.get(answer.principalUserId)?.name ?? 'another principal';
        return `${target.name} falls under ${theirs}. Every teacher has one principal; request a transfer to change it.`;
      }
      return null;
    }

    case 'coordinator': {
      if (!holds) return noKey;
      if (isHead(role)) {
        const head = headIdentity(ctx);
        if (head === 'all') return null;
        if (head === null) {
          return 'Your school has not said which principal you serve, so no coordinators are in your reach yet.';
        }
        const heads = new Set<string>();
        for (const teacherId of ctx.supervised.get(target.userId) ?? []) {
          const answer = ctx.teacherPrincipal.get(teacherId);
          if (answer?.principalUserId != null) heads.add(answer.principalUserId);
        }
        if (heads.size > 0) {
          return heads.has(head) ? null : `${target.name} supervises another principal’s teachers.`;
        }
        return principalReaches(ctx, head, target.branchId)
          ? null
          : `${target.name} is outside your principal’s reach.`;
      }
      return null;
    }

    default: {
      if (holds) return null;
      if (isHead(role) && principalCoversNonTeaching(ctx, target)) return null;
      return noKey;
    }
  }
}

export type KpiVisibility = 'full' | 'overall' | null;

/**
 * What a caller may see of one person.
 *
 * `full` — KPIs, every monthly score and the comments. `overall` — the yearly
 * overall and nothing else (rule 9). A staff member always sees their own
 * (rule 10). Heads and coordinators read the people they may rate; HR and the
 * School Admin read everybody in their campus scope.
 */
export function visibilityOf(ctx: KpiContext, target: StaffPerson): KpiVisibility {
  if (ctx.caller.userId !== null && ctx.caller.userId === target.userId) return 'full';
  if (!admitsBranch(ctx, target.branchId)) return null;

  if (ctx.permissions.has('kpis.read')) {
    if (rateRefusal(ctx, target) === null) return 'full';
    const narrowed = isHead(ctx.caller.role) || ctx.caller.role === 'coordinator';
    if (!narrowed) return 'full';
    return 'overall';
  }

  return ctx.permissions.has('kpis.overall') ? 'overall' : null;
}

/* ---------------------------------------------------------- KPI rows */

export interface KpiRow {
  id: string;
  branchId: string | null;
  branchName: string | null;
  targetRole: StaffKpiTargetRole;
  name: string;
  description: string | null;
  period: StaffKpiPeriod;
  createdByName: string | null;
  updatedAt: string;
}

/** Live KPIs in the caller's campus scope — shared ones plus their campus's own. */
export async function listKpis(
  locationId: string,
  branchIds: string[] | null,
): Promise<KpiRow[]> {
  const rows = await db
    .select({
      id: staffKpis.id,
      branchId: staffKpis.branchId,
      branchName: branches.name,
      targetRole: staffKpis.targetRole,
      name: staffKpis.name,
      description: staffKpis.description,
      period: staffKpis.period,
      createdByName: schoolUsers.name,
      updatedAt: staffKpis.updatedAt,
    })
    .from(staffKpis)
    .leftJoin(branches, eq(branches.id, staffKpis.branchId))
    .leftJoin(schoolUsers, eq(schoolUsers.id, staffKpis.createdBy))
    .where(
      and(
        eq(staffKpis.locationId, locationId),
        isNull(staffKpis.deletedAt),
        sharedOrOwnedBy(staffKpis.branchId, branchIds),
      ),
    )
    .orderBy(asc(staffKpis.targetRole), asc(staffKpis.name));

  return rows.map((row) => ({ ...row, updatedAt: row.updatedAt.toISOString() }));
}

export async function getKpi(
  locationId: string,
  kpiId: string,
): Promise<{ id: string; branchId: string | null; targetRole: StaffKpiTargetRole; period: StaffKpiPeriod; name: string } | null> {
  const rows = await db
    .select({
      id: staffKpis.id,
      branchId: staffKpis.branchId,
      targetRole: staffKpis.targetRole,
      period: staffKpis.period,
      name: staffKpis.name,
    })
    .from(staffKpis)
    .where(
      and(eq(staffKpis.locationId, locationId), eq(staffKpis.id, kpiId), isNull(staffKpis.deletedAt)),
    )
    .limit(1);
  return rows[0] ?? null;
}

/** The KPIs that apply to one person: their role, shared or at their campus. */
export function kpisFor(kpis: readonly KpiRow[], person: StaffPerson): KpiRow[] {
  return kpis.filter(
    (kpi) =>
      kpi.targetRole === person.role &&
      (kpi.branchId === null || person.branchId === null || kpi.branchId === person.branchId),
  );
}

/* ------------------------------------------------------- academic year */

export interface YearRow {
  id: string;
  name: string;
  startMonth: number;
  startYear: number;
  endMonth: number;
  endYear: number;
  isActive: boolean;
}

export async function listYears(locationId: string): Promise<YearRow[]> {
  return db
    .select({
      id: academicYears.id,
      name: academicYears.name,
      startMonth: academicYears.startMonth,
      startYear: academicYears.startYear,
      endMonth: academicYears.endMonth,
      endYear: academicYears.endYear,
      isActive: academicYears.isActive,
    })
    .from(academicYears)
    .where(eq(academicYears.locationId, locationId))
    .orderBy(desc(academicYears.startYear), desc(academicYears.startMonth));
}

/**
 * The academic year a month belongs to. The active year wins where two overlap,
 * which is the same tie-break `getActiveAcademicYear` makes.
 */
export function yearForMonth(years: readonly YearRow[], month: MonthKey): YearRow | null {
  if (!isMonthKey(month)) return null;
  const containing = years.filter((year) => monthsOfYear(year).includes(month));
  return containing.find((year) => year.isActive) ?? containing[0] ?? null;
}

/* ------------------------------------------------------------ ratings */

export async function listRatings(
  locationId: string,
  academicYearId: string,
  ratedUserIds?: readonly string[],
): Promise<RatingRecord[]> {
  if (ratedUserIds !== undefined && ratedUserIds.length === 0) return [];

  const rows = await db
    .select({
      id: staffKpiRatings.id,
      kpiId: staffKpiRatings.kpiId,
      ratedUserId: staffKpiRatings.ratedUserId,
      periodMonth: staffKpiRatings.periodMonth,
      score: staffKpiRatings.score,
      comment: staffKpiRatings.comment,
      raterUserId: staffKpiRatings.raterUserId,
      raterRole: staffKpiRatings.raterRole,
      raterName: staffKpiRatings.raterName,
      createdAt: staffKpiRatings.createdAt,
    })
    .from(staffKpiRatings)
    .where(
      and(
        eq(staffKpiRatings.locationId, locationId),
        eq(staffKpiRatings.academicYearId, academicYearId),
        ratedUserIds === undefined
          ? undefined
          : inArray(staffKpiRatings.ratedUserId, [...ratedUserIds]),
      ),
    )
    .orderBy(asc(staffKpiRatings.createdAt));

  return rows.map((row) => ({
    id: row.id,
    kpiId: row.kpiId,
    ratedUserId: row.ratedUserId,
    month: monthKeyFromDate(row.periodMonth),
    score: row.score,
    comment: row.comment,
    raterUserId: row.raterUserId,
    raterRole: row.raterRole,
    raterName: row.raterName,
    createdAt: row.createdAt.toISOString(),
  }));
}
