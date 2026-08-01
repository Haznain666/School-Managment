import type { Metadata } from 'next';
import Link from 'next/link';

import { Badge } from '@/components/ui/Badge';
import { Card, CardTitle } from '@/components/ui/Card';
import { listSubjects } from '@/lib/academics-queries';
import { requireSchoolRole } from '@/lib/school-guard';
import { ACADEMICS_WRITE_ROLES, ADMIN_PORTAL_ROLES } from '@/types/school-auth';

export const metadata: Metadata = {
  title: 'Subjects',
};

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export default async function SubjectsPage() {
  const { claims, locationId } = await requireSchoolRole(ADMIN_PORTAL_ROLES);
  const subjects = await listSubjects(locationId);

  const canEdit = ACADEMICS_WRITE_ROLES.includes(claims.role);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-slate-900">Subjects</h2>
        <p className="mt-1 text-sm text-slate-500">
          What the school teaches. The colour is what makes a subject findable in
          a full week&rsquo;s grid.
        </p>
      </div>

      <Card
        header={
          <CardTitle
            title="All subjects"
            description={`${subjects.length} subject${subjects.length === 1 ? '' : 's'} defined.`}
            action={
              canEdit ? (
                <Link
                  href="/dashboard/academics/subjects/new"
                  className="text-sm font-medium text-brand-primary hover:underline"
                >
                  Add subject
                </Link>
              ) : undefined
            }
          />
        }
        className="p-0"
      >
        {subjects.length === 0 ? (
          <p className="px-5 py-4 text-sm text-slate-600">
            No subjects yet. A timetable cannot be built until the school has at
            least one.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th scope="col" className="px-5 py-3 font-medium">Subject</th>
                  <th scope="col" className="px-5 py-3 font-medium">Code</th>
                  <th scope="col" className="px-5 py-3 font-medium">Status</th>
                  {canEdit ? (
                    <th scope="col" className="px-5 py-3 font-medium">
                      <span className="sr-only">Actions</span>
                    </th>
                  ) : null}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {subjects.map((subject) => (
                  <tr key={subject.id}>
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-3">
                        <span
                          aria-hidden="true"
                          className="h-4 w-4 shrink-0 rounded-full ring-1 ring-inset ring-slate-300"
                          style={{ backgroundColor: subject.color ?? '#e2e8f0' }}
                        />
                        <span className="font-medium text-slate-900">
                          {subject.name}
                        </span>
                      </div>
                    </td>
                    <td className="px-5 py-3 font-mono text-xs text-slate-600">
                      {subject.code ?? '—'}
                    </td>
                    <td className="px-5 py-3">
                      <Badge variant={subject.isActive ? 'success' : 'neutral'}>
                        {subject.isActive ? 'Active' : 'Retired'}
                      </Badge>
                    </td>
                    {canEdit ? (
                      <td className="px-5 py-3 text-right">
                        <Link
                          href={`/dashboard/academics/subjects/${subject.id}/edit`}
                          className="text-sm font-medium text-brand-primary hover:underline"
                        >
                          Edit
                        </Link>
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
