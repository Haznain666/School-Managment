import 'server-only';

import { and, asc, eq, inArray } from 'drizzle-orm';

import {
  branches,
  coordinatorTeachers,
  schoolUsers,
  sectionHeadCoordinators,
} from '@/db/schema';
import { ROLE_LABELS, type UserRole } from '@/types/school-auth';

import { db } from './drizzle';

/**
 * `lib/approval-chain.ts` — who signs off whose leave. Sprint 33b.
 *
 * ── The chain, per campus ────────────────────────────────────────────────
 *   Principal (one) → Vice Principal (one) → Section Heads → Coordinators →
 *   Teachers → Junior Teachers
 *
 * with the **Branch Admin ranking alongside the Vice Principal** and heading
 * every non-teaching role (decision 3), and the **Principal holding every
 * approval at their campus** — they are the top of every chain here, so a
 * request nobody below has picked up is still decidable by somebody.
 *
 * ── A missing level is skipped, not waited for ───────────────────────────
 * Most schools have no Section Head, and plenty have no Coordinator either.
 * The chain resolves *upward* and returns the first level that exists, so a
 * school that has invited nobody but a Principal has a working approval flow on
 * the day this deploys. A level that would be empty is simply not in the list.
 *
 * ── Several supervisors means the level above ────────────────────────────
 * A teacher named by two coordinators — which is every junior teacher shared
 * across a section — routes to **Vice Principal and above**. That is a rule and
 * not an error: when two people are equally responsible, neither is, and
 * picking one of them would make the approval depend on the order rows happened
 * to be inserted in. It is stated in the returned `note`, so the screen can say
 * why the request went past the coordinator.
 *
 * ── Junior teachers are not a role ───────────────────────────────────────
 * A junior teacher is a `staff` row with **no `school_user_id`** — they have no
 * login (decision 6). HR files their leave, and it travels up this same chain:
 * with no account there is no `coordinator_teachers` row to read, so they land
 * on the multi-supervisor path above and go to the deputy and the head.
 *
 * ── Loaded once, resolved in memory ──────────────────────────────────────
 * `loadChainIndex` makes three indexed reads for a whole school; `resolveChain`
 * is pure. That is what lets the approvals list resolve fifty requests without
 * fifty round trips, and what lets `scripts/check-sprint33b.ts` execute the
 * three statements once and then assert the rules without a database at all.
 */

/** The person the leave belongs to, as the chain needs them. */
export interface ChainApplicant {
  staffId: string;
  /** `school_users.id`, or null for a junior teacher with no login. */
  schoolUserId: string | null;
  /** Their portal role, or null when they have no account. */
  role: UserRole | null;
  /** The campus on their **staff** record. Null = school-wide. */
  branchId: string | null;
  name: string;
}

/** One rung: everybody at that rung who may decide. */
export interface ChainLevel {
  role: UserRole;
  userIds: string[];
  /** One line for the screen: why this rung is in this chain. */
  reason: string;
}

export interface ApprovalChain {
  applicant: ChainApplicant;
  levels: ChainLevel[];
  /** Every id that may decide, in seniority order, deduplicated. */
  approverUserIds: string[];
  /** Why a rung was skipped, when one was. Null when the chain is plain. */
  note: string | null;
}

interface HeadRow {
  userId: string;
  role: UserRole;
  branchId: string | null;
}

export interface ChainIndex {
  locationId: string;
  /** teacher `school_users.id` → the coordinators who supervise them. */
  coordinatorsOfTeacher: ReadonlyMap<string, string[]>;
  /** coordinator `school_users.id` → the section heads above them. */
  sectionHeadsOfCoordinator: ReadonlyMap<string, string[]>;
  /** Every active head account, with the campus it belongs to. */
  heads: readonly HeadRow[];
}

/** The roles that sit above somebody in a chain, and are read as a set. */
const HEAD_ROLES: readonly UserRole[] = [
  'school_admin',
  'principal',
  'vice_principal',
  'branch_admin',
  'section_head',
];

/**
 * Which side of the school a role works on.
 *
 * Decision 3: the Branch Admin heads the **non-teaching** roles, the Vice
 * Principal the teaching ones, and the two rank together. A person with no
 * account at all is treated as teaching, because the case that produces one is
 * the junior teacher.
 */
function isTeachingSide(role: UserRole | null): boolean {
  switch (role) {
    case 'principal':
    case 'vice_principal':
    case 'section_head':
    case 'coordinator':
    case 'teacher':
    case null:
      return true;
    default:
      return false;
  }
}

/** Heads of one role whose campus covers this applicant's. */
function headsFor(
  index: ChainIndex,
  role: UserRole,
  branchId: string | null,
  exclude: string | null,
): string[] {
  return index.heads
    .filter(
      (head) =>
        head.role === role &&
        head.userId !== exclude &&
        // A head with no campus of their own runs the school and covers every
        // campus. A campus head covers their own, and covers a member of staff
        // who has no campus either — that person belongs to the school, and the
        // campus guard the routes apply refuses them to a campus-bound approver
        // in any case. Both halves are needed: without the first, a
        // single-campus school whose head has no `branch_id` has no approver at
        // all, which is most schools.
        (head.branchId === null || branchId === null || head.branchId === branchId),
    )
    .map((head) => head.userId);
}

/**
 * The whole school's supervision links and heads, in three indexed reads.
 *
 * Tenant-scoped on every one of them. Nothing here takes an id from a request.
 */
export async function loadChainIndex(locationId: string): Promise<ChainIndex> {
  const [supervision, sections, heads] = await Promise.all([
    db
      .select({
        coordinatorUserId: coordinatorTeachers.coordinatorUserId,
        teacherUserId: coordinatorTeachers.teacherUserId,
      })
      .from(coordinatorTeachers)
      .where(eq(coordinatorTeachers.locationId, locationId)),
    db
      .select({
        sectionHeadUserId: sectionHeadCoordinators.sectionHeadUserId,
        coordinatorUserId: sectionHeadCoordinators.coordinatorUserId,
      })
      .from(sectionHeadCoordinators)
      .where(eq(sectionHeadCoordinators.locationId, locationId)),
    db
      .select({
        userId: schoolUsers.id,
        role: schoolUsers.role,
        branchId: schoolUsers.branchId,
      })
      .from(schoolUsers)
      .where(
        and(
          eq(schoolUsers.locationId, locationId),
          eq(schoolUsers.isActive, true),
          inArray(schoolUsers.role, [...HEAD_ROLES]),
        ),
      ),
  ]);

  const coordinatorsOfTeacher = new Map<string, string[]>();
  for (const row of supervision) {
    const held = coordinatorsOfTeacher.get(row.teacherUserId) ?? [];
    held.push(row.coordinatorUserId);
    coordinatorsOfTeacher.set(row.teacherUserId, held);
  }

  const sectionHeadsOfCoordinator = new Map<string, string[]>();
  for (const row of sections) {
    const held = sectionHeadsOfCoordinator.get(row.coordinatorUserId) ?? [];
    held.push(row.sectionHeadUserId);
    sectionHeadsOfCoordinator.set(row.coordinatorUserId, held);
  }

  return {
    locationId,
    coordinatorsOfTeacher,
    sectionHeadsOfCoordinator,
    heads: heads.map((row) => ({
      userId: row.userId,
      role: row.role as UserRole,
      branchId: row.branchId,
    })),
  };
}

/**
 * The chain above one person. Pure — every read is already in `index`.
 *
 * The levels come back in seniority order, nearest first, which is the order
 * the screen lists them in and the order a school would name them.
 */
export function resolveChain(index: ChainIndex, applicant: ChainApplicant): ApprovalChain {
  const levels: ChainLevel[] = [];
  let note: string | null = null;
  const self = applicant.schoolUserId;
  const branchId = applicant.branchId;

  /*
   * Rung 1 — the coordinator, for a teacher.
   *
   * Exactly one coordinator is a supervisor. Two is a rule about what happens
   * next, not a tie to be broken: see the docblock.
   */
  if (applicant.role === 'teacher' || applicant.role === null) {
    const coordinators =
      self === null ? [] : (index.coordinatorsOfTeacher.get(self) ?? []).filter((id) => id !== self);

    if (coordinators.length === 1) {
      levels.push({
        role: 'coordinator',
        userIds: coordinators,
        reason: 'Their coordinator.',
      });
    } else if (coordinators.length > 1) {
      note =
        'More than one coordinator supervises them, so this goes to the Vice Principal and above.';
    } else if (self === null) {
      note = 'They have no portal account, so this goes to the Vice Principal and above.';
    }
  }

  /*
   * Rung 2 — the section head, for a coordinator. Same rule for the same
   * reason, and it is also how a teacher's coordinator's own head is reached:
   * the level is added for the coordinator *found above*, not only for an
   * applicant who is one.
   */
  if (applicant.role === 'coordinator' || levels.length > 0) {
    const under =
      applicant.role === 'coordinator'
        ? self === null
          ? []
          : [self]
        : (levels[0]?.userIds ?? []);

    const sectionHeads = [
      ...new Set(
        under.flatMap((coordinatorId) => index.sectionHeadsOfCoordinator.get(coordinatorId) ?? []),
      ),
    ].filter((id) => id !== self);

    if (sectionHeads.length > 0) {
      levels.push({
        role: 'section_head',
        userIds: sectionHeads,
        reason:
          applicant.role === 'coordinator'
            ? 'The section head they report to.'
            : 'The section head above their coordinator.',
      });
    }
  }

  // Rung 3 — the deputy. Vice Principal on the teaching side, Branch Admin on
  // the non-teaching side, and both when a school runs both: they rank
  // together, so either may sign.
  const deputyRoles: UserRole[] = isTeachingSide(applicant.role)
    ? ['vice_principal']
    : ['branch_admin'];

  for (const role of deputyRoles) {
    const userIds = headsFor(index, role, branchId, self);
    if (userIds.length > 0) {
      levels.push({
        role,
        userIds,
        reason:
          role === 'branch_admin'
            ? 'The campus administrator, who heads the non-teaching staff.'
            : 'The Vice Principal at their campus.',
      });
    }
  }

  // Rung 4 — the Principal. Always in the chain at their campus, decision 3.
  const principals = headsFor(index, 'principal', branchId, self);
  if (principals.length > 0) {
    levels.push({
      role: 'principal',
      userIds: principals,
      reason: 'The Principal, who may decide anything at their campus.',
    });
  }

  // Rung 5 — the School Administrator. Who approves the Principal's own leave,
  // and the backstop at a school that has invited nobody else yet.
  const owners = headsFor(index, 'school_admin', null, self);
  if (owners.length > 0) {
    levels.push({
      role: 'school_admin',
      userIds: owners,
      reason: 'The School Administrator.',
    });
  }

  return {
    applicant,
    levels,
    approverUserIds: [...new Set(levels.flatMap((level) => level.userIds))],
    note,
  };
}

/** Who is trying to decide, from the verified session and their own row. */
export interface ChainDecider {
  schoolUserId: string | null;
  role: UserRole;
}

/**
 * Why this person may not decide this request — or null.
 *
 * ── Called again on the write, deliberately ──────────────────────────────
 * The list uses this to decide what to show, and the decision endpoint calls it
 * again before it writes. A resolver used only for the list is a **visibility**
 * boundary, and `lib/principal-resolver.ts` already records that a visibility
 * boundary is not an authorisation one: a stale tab, a pasted id, or a
 * reassignment between the page rendering and the button being pressed all
 * arrive at the endpoint with a legitimate-looking request.
 */
export function decisionRefusal(chain: ApprovalChain, decider: ChainDecider): string | null {
  if (decider.schoolUserId === null) {
    return 'Sign in with your own school account to decide a leave request.';
  }

  if (decider.schoolUserId === chain.applicant.schoolUserId) {
    return 'You cannot decide your own leave request. It goes to whoever is above you.';
  }

  if (chain.approverUserIds.includes(decider.schoolUserId)) return null;

  const who =
    chain.levels.length === 0
      ? 'Nobody is set up to approve leave at their campus yet — a Principal or School Administrator needs an account there'
      : `This one goes to ${chain.levels
          .map((level) => ROLE_LABELS[level.role])
          .join(', then ')}`;

  return `${chain.applicant.name} does not report to you. ${who}.`;
}

/** The chain in one sentence, for a screen: "Coordinator, then Principal". */
export function chainSummary(chain: ApprovalChain): string {
  if (chain.levels.length === 0) return 'Nobody is set up to approve leave at their campus yet.';
  return chain.levels.map((level) => ROLE_LABELS[level.role]).join(' → ');
}

/**
 * Every applicant in a decider's reach, as a set of staff ids.
 *
 * The inverse of the chain, resolved in memory over an index that was read
 * once. Used by the approvals list; the decision endpoint still re-checks the
 * one request it is about.
 */
export function reachableStaffIds(
  index: ChainIndex,
  applicants: readonly ChainApplicant[],
  decider: ChainDecider,
): Set<string> {
  const reachable = new Set<string>();
  for (const applicant of applicants) {
    if (decisionRefusal(resolveChain(index, applicant), decider) === null) {
      reachable.add(applicant.staffId);
    }
  }
  return reachable;
}

/*
 * "Is there already a Principal at this campus" is not a chain question and
 * does not live here. It is `headsAtBranch` / `headConflict` in
 * `lib/one-head-per-campus.ts`, called by every write that can make a head.
 */

/* ------------------------------------------------------- the setup screen */

export interface ChainPerson {
  userId: string;
  name: string;
  role: UserRole;
  branchId: string | null;
  branchName: string | null;
}

export interface ChainSetup {
  sectionHeads: Array<ChainPerson & { coordinatorUserIds: string[] }>;
  coordinators: Array<ChainPerson & { sectionHeadUserId: string | null }>;
  /** Schools that already have two of a head somewhere — decision 2's report. */
  duplicateHeads: Array<{ role: UserRole; branchId: string | null; names: string[] }>;
}

/**
 * The chain of command as the screen that edits it needs it.
 *
 * ── The duplicate report is part of the screen, not a migration artefact ──
 * `0048` will not create the one-head-per-campus indexes at a school that
 * already has two, because a migration that fails on live data stops every
 * other statement in the file. So the duplicates are **reported here**, on the
 * screen of the person who can resolve them, and nothing is ever deleted: one
 * of those two rows is somebody who signs in every morning.
 */
export async function listChainSetup(
  locationId: string,
  branchIds: string[] | null = null,
): Promise<ChainSetup> {
  const [people, links] = await Promise.all([
    db
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
          inArray(schoolUsers.role, [
            'section_head',
            'coordinator',
            'principal',
            'vice_principal',
          ]),
        ),
      )
      .orderBy(asc(schoolUsers.name)),
    db
      .select({
        sectionHeadUserId: sectionHeadCoordinators.sectionHeadUserId,
        coordinatorUserId: sectionHeadCoordinators.coordinatorUserId,
      })
      .from(sectionHeadCoordinators)
      .where(eq(sectionHeadCoordinators.locationId, locationId)),
  ]);

  const inScope = (branchId: string | null): boolean =>
    branchIds === null || branchId === null || branchIds.includes(branchId);

  const typed: ChainPerson[] = people.map((row) => ({
    userId: row.userId,
    name: row.name,
    role: row.role as UserRole,
    branchId: row.branchId,
    branchName: row.branchName,
  }));

  const headOfCoordinator = new Map(
    links.map((link) => [link.coordinatorUserId, link.sectionHeadUserId]),
  );

  // Decision 2: one Principal and one Vice Principal per campus. Counted here
  // rather than assumed from the index, which may not have been created.
  const duplicates = new Map<string, { role: UserRole; branchId: string | null; names: string[] }>();
  for (const person of typed) {
    if (person.role !== 'principal' && person.role !== 'vice_principal') continue;
    const key = `${person.role}|${person.branchId ?? 'school'}`;
    const held = duplicates.get(key) ?? { role: person.role, branchId: person.branchId, names: [] };
    held.names.push(person.name);
    duplicates.set(key, held);
  }

  return {
    sectionHeads: typed
      .filter((person) => person.role === 'section_head' && inScope(person.branchId))
      .map((person) => ({
        ...person,
        coordinatorUserIds: links
          .filter((link) => link.sectionHeadUserId === person.userId)
          .map((link) => link.coordinatorUserId),
      })),
    coordinators: typed
      .filter((person) => person.role === 'coordinator' && inScope(person.branchId))
      .map((person) => ({
        ...person,
        sectionHeadUserId: headOfCoordinator.get(person.userId) ?? null,
      })),
    duplicateHeads: [...duplicates.values()].filter((row) => row.names.length > 1),
  };
}
