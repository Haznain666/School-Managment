import { eq } from 'drizzle-orm';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { schools } from '@/db/schema';
import { SchoolForm } from '@/components/super-admin/SchoolForm';
import { db } from '@/lib/drizzle';
import { publicEnv } from '@/lib/env';
import { isUuid } from '@/lib/validation';

export const metadata: Metadata = {
  title: 'Edit school',
};

export const dynamic = 'force-dynamic';

export default async function EditSchoolPage({
  params,
}: {
  params: Promise<{ schoolId: string }>;
}) {
  const { schoolId } = await params;
  if (!isUuid(schoolId)) notFound();

  const rows = await db.select().from(schools).where(eq(schools.id, schoolId)).limit(1);
  const school = rows[0];
  if (school === undefined) notFound();

  return (
    <div className="max-w-3xl space-y-6">
      <h3 className="text-lg font-semibold text-slate-900">Edit school</h3>

      <SchoolForm
        appDomain={publicEnv.appDomain}
        initial={{
          id: school.id,
          name: school.name,
          slug: school.slug,
          locationId: school.locationId,
          city: school.city,
          address: school.address ?? '',
          phone: school.phone ?? '',
          email: school.email ?? '',
          principalName: school.principalName ?? '',
        }}
      />
    </div>
  );
}
