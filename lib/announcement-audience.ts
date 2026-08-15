import 'server-only';

import { and, eq, inArray, isNotNull, type SQL } from 'drizzle-orm';

import {
  schoolUsers,
  sections,
  studentEnrollments,
  studentGuardians,
  studentProfiles,
  type AnnouncementAudience,
} from '@/db/schema';
import { USER_ROLES, type UserRole } from '@/types/school-auth';

import { db } from './drizzle';

/**
 * Turning "who is this for" into people.
 *
 * One module, because the answer is needed in three places that must not
 * disagree: the composer's "this reaches 412 people" count, the send that
 * writes the delivery log, and the notice board's "is this addressed to me".
 * Three implementations of the audience rule would mean a school telling
 * parents something the parents' own portal then decides was not for them.
 *
 * ── A class audience means the children *and* their guardians ────────────
 * "Class 5" as an audience is how a school speaks, and what a school means by
 * it is the families of Class 5. A notice about a Class 5 trip that reached
 * only the ten-year-olds and none of the parents would be a defect nobody
 * would report as one — the notice went out, it simply did not work. So a
 * grade or section audience resolves to the enrolled students plus every
 * guardian linked to them.
 *
 * Staff are not swept in by a class audience. A teacher of Class 5 is reached
 * by addressing teachers, which is a different sentence a school can also say.
 *
 * ── Inactive accounts are never in an audience ───────────────────────────
 * Applied here rather than at each call site, so a member of staff who left in
 * March cannot appear in an April delivery log.
 */

/** One person an announcement reaches. */
export interface AudienceMember {
  schoolUserId: string;
  name: string;
  email: string | null;
  phone: string;
  /**
   * Left as `string` rather than narrowed to `UserRole`.
   *
   * It is read for display and for grouping the delivery log, never branched
   * on. Narrowing it would force a decision about what to do with a row whose
   * role this build does not recognise, and every honest answer to that — drop
   * the person, or invent a role for them — is worse than showing what the
   * column says.
   */
  role: string;
}

export function isUserRole(value: unknown): value is UserRole {
  return typeof value === 'string' && (USER_ROLES as readonly string[]).includes(value);
}

/**
 * Validates and normalises an audience out of a request body.
 *
 * Returns the audience, or the message to show whoever sent it. Ids are checked
 * for shape only; whether a section belongs to this school is settled by the
 * tenant filter on the resolving query, which is the enforcement that cannot be
 * forgotten.
 */
export function parseAudience(raw: unknown): AnnouncementAudience | string {
  if (typeof raw !== 'object' || raw === null) return 'Say who this is for.';

  const value = raw as Record<string, unknown>;
  const kind = value['kind'];

  const idList = (input: unknown, noun: string): string[] | string => {
    if (!Array.isArray(input) || input.length === 0) return `Choose at least one ${noun}.`;
    if (input.length > 200) return `That is more ${noun}s than a school has.`;
    const out: string[] = [];
    for (const entry of input) {
      if (typeof entry !== 'string' || entry === '') return `Choose at least one ${noun}.`;
      if (!out.includes(entry)) out.push(entry);
    }
    return out;
  };

  if (kind === 'all') return { kind: 'all' };

  if (kind === 'roles') {
    const roles = idList(value['roles'], 'role');
    if (typeof roles === 'string') return roles;
    for (const role of roles) {
      if (!isUserRole(role)) return `"${role}" is not a role at this school.`;
    }
    return { kind: 'roles', roles };
  }

  if (kind === 'grades') {
    const gradeIds = idList(value['gradeIds'], 'class');
    if (typeof gradeIds === 'string') return gradeIds;
    return { kind: 'grades', gradeIds };
  }

  if (kind === 'sections') {
    const sectionIds = idList(value['sectionIds'], 'section');
    if (typeof sectionIds === 'string') return sectionIds;
    return { kind: 'sections', sectionIds };
  }

  return 'Say who this is for.';
}

/** A short description of an audience, for a list and for the delivery log. */
export function describeAudience(
  audience: AnnouncementAudience,
  labels: { roles?: Record<string, string>; classes?: Map<string, string> } = {},
): string {
  switch (audience.kind) {
    case 'all':
      return 'Everyone';
    case 'roles':
      return audience.roles
        .map((role) => labels.roles?.[role] ?? role.replace(/_/g, ' '))
        .join(', ');
    case 'grades':
      return audience.gradeIds
        .map((id) => labels.classes?.get(id) ?? 'a class')
        .join(', ');
    case 'sections':
      return audience.sectionIds
        .map((id) => labels.classes?.get(id) ?? 'a section')
        .join(', ');
  }
}

/**
 * Everybody one audience reaches, at this moment, for this school.
 *
 * `branchId` narrows any audience to one campus. It is applied to the *person*,
 * not to the class: a guardian is filed against the branch they belong to, and
 * a school with two campuses that addressed "all parents" from one of them
 * means the parents of that campus.
 *
 * Every table in every branch of this function carries the tenant filter,
 * including the ones reached by join. Hazard §4.4: these filters are the
 * enforcement, and an audience that leaked would put one school's notice in
 * front of another school's parents.
 */
export async function resolveAudience(
  locationId: string,
  audience: AnnouncementAudience,
  branchId: string | null = null,
): Promise<AudienceMember[]> {
  const person = {
    schoolUserId: schoolUsers.id,
    name: schoolUsers.name,
    email: schoolUsers.email,
    phone: schoolUsers.phone,
    role: schoolUsers.role,
  };

  const base: SQL[] = [eq(schoolUsers.locationId, locationId), eq(schoolUsers.isActive, true)];
  if (branchId !== null) base.push(eq(schoolUsers.branchId, branchId));

  const rows =
    audience.kind === 'all'
      ? await db
          .select(person)
          .from(schoolUsers)
          .where(and(...base))
      : audience.kind === 'roles'
        ? await db
            .select(person)
            .from(schoolUsers)
            .where(and(...base, inArray(schoolUsers.role, audience.roles)))
        : await resolveClassAudience(locationId, audience, base);

  return dedupe(rows);
}

/**
 * The families of a set of classes: the enrolled students, and their guardians.
 *
 * Two queries rather than one `or` across two join paths, because a guardian
 * reaches the enrolment through a different table than a student does and a
 * single query would need an outer join whose null rows mean two different
 * things. Two reads and one merge is the cheaper thing to be sure of.
 */
async function resolveClassAudience(
  locationId: string,
  audience: Extract<AnnouncementAudience, { kind: 'grades' } | { kind: 'sections' }>,
  base: readonly SQL[],
): Promise<AudienceMember[]> {
  const inClass =
    audience.kind === 'sections'
      ? inArray(studentEnrollments.sectionId, audience.sectionIds)
      : inArray(sections.gradeId, audience.gradeIds);

  const enrolled = and(
    eq(studentEnrollments.locationId, locationId),
    eq(studentEnrollments.status, 'active'),
    inClass,
  );

  const students = await db
    .select({
      schoolUserId: schoolUsers.id,
      name: schoolUsers.name,
      email: schoolUsers.email,
      phone: schoolUsers.phone,
      role: schoolUsers.role,
    })
    .from(studentEnrollments)
    .innerJoin(
      sections,
      and(eq(sections.id, studentEnrollments.sectionId), eq(sections.locationId, locationId)),
    )
    .innerJoin(
      studentProfiles,
      and(
        eq(studentProfiles.id, studentEnrollments.studentProfileId),
        eq(studentProfiles.locationId, locationId),
      ),
    )
    .innerJoin(schoolUsers, and(eq(schoolUsers.id, studentProfiles.schoolUserId), ...base))
    .where(enrolled);

  const guardians = await db
    .select({
      schoolUserId: schoolUsers.id,
      name: schoolUsers.name,
      email: schoolUsers.email,
      phone: schoolUsers.phone,
      role: schoolUsers.role,
    })
    .from(studentEnrollments)
    .innerJoin(
      sections,
      and(eq(sections.id, studentEnrollments.sectionId), eq(sections.locationId, locationId)),
    )
    .innerJoin(
      studentGuardians,
      and(
        eq(studentGuardians.studentProfileId, studentEnrollments.studentProfileId),
        eq(studentGuardians.locationId, locationId),
        // A guardian with no account of their own cannot be reached here. They
        // are on the student record and the office can phone them; putting a
        // row with no user in the delivery log would claim a delivery that no
        // channel could ever make.
        isNotNull(studentGuardians.schoolUserId),
      ),
    )
    .innerJoin(schoolUsers, and(eq(schoolUsers.id, studentGuardians.schoolUserId), ...base))
    .where(enrolled);

  return [...students, ...guardians];
}

/**
 * One row per person.
 *
 * A guardian of three children in the same grade is one recipient, not three.
 * The unique index on the delivery log would refuse the duplicates anyway; the
 * point of doing it here is that the *count* the composer shows before sending
 * has to be the number of people, or a school reads "1,240 recipients" for a
 * school of 400.
 */
function dedupe(rows: readonly AudienceMember[]): AudienceMember[] {
  const byId = new Map<string, AudienceMember>();
  for (const row of rows) byId.set(row.schoolUserId, row);
  return [...byId.values()];
}
