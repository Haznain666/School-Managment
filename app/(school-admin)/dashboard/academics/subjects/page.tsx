import type { Metadata } from 'next';
import Link from 'next/link';

import { Badge } from '@/components/ui/Badge';
import { Card, CardTitle } from '@/components/ui/Card';
import { PageHeader } from '@/components/ui/PageHeader';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
} from '@/components/ui/Table';
import { listSubjects } from '@/lib/academics-queries';
import { requireSchoolPermission } from '@/lib/school-guard';

export const metadata: Metadata = {
  title: 'Subjects',
};

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export default async function SubjectsPage() {
  const { locationId, permissions } = await requireSchoolPermission('academics.read');
  const subjects = await listSubjects(locationId);

  const canEdit = permissions.includes('academics.write');

  return (
    <div className="space-y-6">
      <PageHeader
        title="Subjects"
        description="What the school teaches. The colour is what makes a subject findable in a full week&rsquo;s grid."
      />

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
          <p className="px-5 py-4 text-sm text-ink-muted">
            No subjects yet. A timetable cannot be built until the school has at
            least one.
          </p>
        ) : (
          <Table caption="Subjects">
              <TableHead>
                <TableRow>
                  <TableHeaderCell>Subject</TableHeaderCell>
                  <TableHeaderCell>Code</TableHeaderCell>
                  <TableHeaderCell>Status</TableHeaderCell>
                  {canEdit ? (
                    <TableHeaderCell>
                      <span className="sr-only">Actions</span>
                    </TableHeaderCell>
                  ) : null}
                </TableRow>
              </TableHead>
              <TableBody>
                {subjects.map((subject) => (
                  <TableRow key={subject.id}>
                    <TableCell>
                      <div className="flex items-center gap-3">
                        <span
                          aria-hidden="true"
                          className="h-4 w-4 shrink-0 rounded-full ring-1 ring-inset ring-line-strong"
                          style={{ backgroundColor: subject.color ?? '#e2e8f0' }}
                        />
                        <span className="font-medium text-ink">
                          {subject.name}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell muted className="font-mono text-xs">
                      {subject.code ?? '—'}
                    </TableCell>
                    <TableCell>
                      <Badge variant={subject.isActive ? 'success' : 'neutral'}>
                        {subject.isActive ? 'Active' : 'Retired'}
                      </Badge>
                    </TableCell>
                    {canEdit ? (
                      <TableCell align="numeric">
                        <Link
                          href={`/dashboard/academics/subjects/${subject.id}/edit`}
                          className="text-sm font-medium text-brand-primary hover:underline"
                        >
                          Edit
                        </Link>
                      </TableCell>
                    ) : null}
                  </TableRow>
                ))}
              </TableBody>
          </Table>
        )}
      </Card>
    </div>
  );
}
