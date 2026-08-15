import type { Metadata } from 'next';

import { AnnouncementManager } from '@/components/comms/AnnouncementManager';
import { PageHeader } from '@/components/ui/PageHeader';
import { listAnnouncements } from '@/lib/announcement-queries';
import { listAdmissionsBranches, listGrades, listSections } from '@/lib/admissions-queries';
import { gradeLabels, sectionLabel } from '@/lib/class-labels';
import { requireSchoolPermission } from '@/lib/school-guard';
import { CONFIGURABLE_ROLES } from '@/lib/permissions';
import { ROLE_LABELS, USER_ROLES } from '@/types/school-auth';

export const metadata: Metadata = {
  title: 'Communications',
};

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Communications — what the school tells people.
 *
 * Every read is scoped to the caller's own school: the location id comes from
 * their verified session, so there is no request parameter that could widen it.
 *
 * The audience pickers are built here, on the server, from the school's own
 * classes and campuses. The ids they carry are re-read through tenant-filtered
 * queries when the announcement is saved and again when it is sent — a picker
 * is a convenience, never the enforcement.
 */
export default async function CommunicationsPage() {
  const { locationId, permissions } = await requireSchoolPermission('comms.read');

  const [announcements, grades, sections, branches] = await Promise.all([
    listAnnouncements(locationId),
    listGrades(locationId),
    listSections(locationId, {}),
    listAdmissionsBranches(locationId),
  ]);

  // Qualified by campus only where two grades share a name — see
  // `lib/class-labels.ts`.
  const gradeById = gradeLabels(grades, branches);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Communications"
        description="Announcements to the notice board on every portal, and to people's email when you ask for it."
      />

      <AnnouncementManager
        announcements={announcements.map((row) => ({
          ...row,
          // Dates cross to a client component as ISO strings: a Date does not
          // survive serialisation, and a string the browser formats in the
          // reader's own locale is what the rest of this product does.
          scheduledAt: row.scheduledAt?.toISOString() ?? null,
          sentAt: row.sentAt?.toISOString() ?? null,
        }))}
        branches={branches.map((branch) => ({ id: branch.id, label: branch.name }))}
        grades={grades.map((grade) => ({
          id: grade.id,
          label: gradeById.get(grade.id) ?? grade.name,
        }))}
        sections={sections.map((section) => ({
          id: section.id,
          label: sectionLabel(gradeById.get(section.gradeId) ?? 'Class', section.name),
        }))}
        /*
          Students and parents are addressable even though they are not
          configurable roles — `CONFIGURABLE_ROLES` exists because nothing they
          reach is permission-gated, which is a different question from whether
          a school can send them a notice. They are most of who a school talks
          to.
        */
        roles={USER_ROLES.filter(
          (role) =>
            role === 'student' || role === 'parent' || CONFIGURABLE_ROLES.includes(role),
        ).map((role) => ({ id: role, label: ROLE_LABELS[role] }))}
        canWrite={permissions.includes('comms.write')}
        canSend={permissions.includes('comms.send')}
      />
    </div>
  );
}
