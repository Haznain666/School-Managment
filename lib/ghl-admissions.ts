import 'server-only';

import { and, eq } from 'drizzle-orm';

import { schools } from '@/db/schema';

import type { Database } from './drizzle';
import { serverEnv } from './env';
import { findOrCreateContact, ghlFetch, GhlAgencyError } from './ghl-client';

/**
 * GHL synchronisation for admissions (Sprint 4, Decision 4).
 *
 * Enrolling a student mirrors two people into the school's CRM: the child, so
 * the school has a record to attach fee and attendance automations to, and the
 * primary guardian, because they are who actually receives the WhatsApp.
 *
 * ── On failure ───────────────────────────────────────────────────────────
 * None of this may block an enrolment. A school whose GHL connection has
 * lapsed must still be able to admit a child; the sync is a mirror, not the
 * record. Every function here therefore either returns null on failure or
 * swallows it after logging, and the enrolment endpoints run them *after* the
 * database writes have already landed. `POST /api/school/students/[studentId]/sync-ghl`
 * exists to replay whatever did not make it.
 */

/** Confirms the location belongs to a school we know and have not deactivated. */
async function assertKnownSchool(db: Database, locationId: string): Promise<string> {
  const rows = await db
    .select({ name: schools.name })
    .from(schools)
    .where(and(eq(schools.locationId, locationId), eq(schools.isActive, true)))
    .limit(1);

  const school = rows[0];
  if (school === undefined) {
    throw new GhlAgencyError(
      403,
      `GHL admissions sync blocked: no active school for locationId ${locationId}`,
    );
  }

  return school.name;
}

export interface StudentContactInput {
  name: string;
  /** Usually the primary guardian's number — students rarely have their own. */
  phone?: string | undefined;
  email?: string | undefined;
  /** The admission number, e.g. `GVS-2025-0001`. */
  studentId: string;
}

interface ContactCreateResponse {
  contact?: { id?: string };
  id?: string;
}

/**
 * Mirrors a student into the school's GHL sub-account and returns the contact id.
 *
 * A student with a contactable number is deduplicated against the existing
 * contact for that number, so a second child on the same household number does
 * not fragment the CRM. Without a number there is nothing to deduplicate on, so
 * a fresh contact is created and tagged with the admission number instead.
 */
export async function createStudentGHLContact(
  db: Database,
  locationId: string,
  student: StudentContactInput,
  schoolName: string,
): Promise<string> {
  await assertKnownSchool(db, locationId);

  if (student.phone !== undefined && student.phone !== '') {
    const found = await findOrCreateContact(db, locationId, {
      phone: student.phone,
      name: student.name,
      email: student.email,
    });
    return found.contactId;
  }

  const [firstName, ...rest] = student.name.trim().split(/\s+/);

  const created = await ghlFetch<ContactCreateResponse>('/contacts/', locationId, {
    method: 'POST',
    body: {
      locationId,
      firstName: firstName ?? student.name,
      lastName: rest.join(' '),
      ...(student.email === undefined || student.email === ''
        ? {}
        : { email: student.email }),
      // Tags rather than custom fields: custom field ids differ per sub-account
      // and would need a per-school lookup for what is only a breadcrumb.
      tags: ['student', `student-id:${student.studentId.toLowerCase()}`],
      source: `SMS Platform — ${schoolName}`,
    },
  });

  const contactId = created.contact?.id ?? created.id;
  if (typeof contactId !== 'string' || contactId === '') {
    throw new GhlAgencyError(502, 'GHL did not return a contact id for the student.');
  }

  return contactId;
}

export interface GuardianContactInput {
  name: string;
  /** E.164, already normalised. */
  phone: string;
  email?: string | undefined;
}

/** Mirrors a guardian into the school's GHL sub-account and returns its id. */
export async function createGuardianGHLContact(
  db: Database,
  locationId: string,
  guardian: GuardianContactInput,
): Promise<string> {
  await assertKnownSchool(db, locationId);

  const found = await findOrCreateContact(db, locationId, {
    phone: guardian.phone,
    name: guardian.name,
    email: guardian.email,
  });

  return found.contactId;
}

/**
 * Adds the contact to the school's admission welcome workflow.
 *
 * Optional by design: `GHL_ADMISSION_WORKFLOW_ID` is not set on every
 * deployment, and a school that has not built the workflow should simply not
 * get one rather than see enrolments fail. Never throws.
 */
export async function triggerAdmissionWelcomeWorkflow(
  locationId: string,
  contactId: string,
): Promise<void> {
  const workflowId = serverEnv('GHL_ADMISSION_WORKFLOW_ID', '');

  if (workflowId === '') {
    console.warn(
      '[ghl-admissions] GHL_ADMISSION_WORKFLOW_ID is not set; skipping the admission welcome workflow.',
    );
    return;
  }

  try {
    await ghlFetch<unknown>(
      `/contacts/${contactId}/workflow/${workflowId}`,
      locationId,
      { method: 'POST', body: { eventStartTime: new Date().toISOString() } },
    );
    console.info(
      `[ghl-admissions] admission workflow triggered for contact ${contactId} at ${locationId}`,
    );
  } catch (error) {
    // A workflow is a nicety; the child is already enrolled.
    console.warn(
      `[ghl-admissions] could not trigger the admission workflow for contact ${contactId}:`,
      error,
    );
  }
}

export interface AdmissionSyncResult {
  studentContactId: string | null;
  guardianContactIds: Record<string, string>;
}

/**
 * Runs the whole post-enrolment sync and reports what succeeded.
 *
 * Each half is attempted independently: a guardian who fails to sync must not
 * take the student's contact down with them, because the manual re-sync route
 * works per record.
 */
export async function syncAdmissionContacts(
  db: Database,
  locationId: string,
  params: {
    student: StudentContactInput;
    schoolName: string;
    /** Keyed by `student_guardians.id` so the caller can write ids back. */
    guardians: ReadonlyArray<{ id: string } & GuardianContactInput>;
  },
): Promise<AdmissionSyncResult> {
  const guardianContactIds: Record<string, string> = {};

  for (const guardian of params.guardians) {
    try {
      guardianContactIds[guardian.id] = await createGuardianGHLContact(db, locationId, {
        name: guardian.name,
        phone: guardian.phone,
        email: guardian.email,
      });
    } catch (error) {
      console.warn(
        `[ghl-admissions] guardian sync failed for ${guardian.id} at ${locationId}:`,
        error,
      );
    }
  }

  let studentContactId: string | null = null;
  try {
    studentContactId = await createStudentGHLContact(
      db,
      locationId,
      params.student,
      params.schoolName,
    );
  } catch (error) {
    console.warn(
      `[ghl-admissions] student sync failed for ${params.student.studentId} at ${locationId}:`,
      error,
    );
  }

  return { studentContactId, guardianContactIds };
}
