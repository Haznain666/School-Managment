import { and, asc, eq } from 'drizzle-orm';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import type { CSSProperties } from 'react';

import { ApplyForm } from '@/components/admissions/ApplyForm';
import { Card } from '@/components/ui/Card';
import { branches, gradeLabel, grades } from '@/db/schema';
import { getActiveAcademicYear } from '@/lib/admissions-queries';
import { paletteToCSSVars } from '@/lib/branding';
import { db } from '@/lib/drizzle';
import { getModuleFlags } from '@/lib/school-queries';
import { getSchoolBranding, getSchoolHeaders } from '@/lib/school-tenant';

export const metadata: Metadata = {
  title: 'Apply for admission',
};

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * The public application form.
 *
 * No authentication: an applicant has no account, and the whole point of the
 * page is that they can reach it before they do. The school is decided by the
 * subdomain (or `?school=` in development) — never by anything typed here — so
 * the branding shown and the school an application is filed against are always
 * the same one.
 *
 * Two states short-circuit the form, and they are deliberately distinguished: a
 * school that has not bought the module is not the same as a school between
 * academic years, and telling a parent the difference saves them a phone call.
 */
export default async function ApplyPage() {
  const { locationId } = await getSchoolHeaders();

  // Middleware rewrites to /school-not-found when the host resolves to nothing,
  // so reaching here without a tenant means something upstream changed.
  if (locationId === null || locationId === '') {
    redirect('/school-not-found');
  }

  const [school, moduleFlags, activeYear] = await Promise.all([
    getSchoolBranding(locationId),
    getModuleFlags(locationId),
    getActiveAcademicYear(locationId),
  ]);

  const brandStyle = paletteToCSSVars(school?.palette ?? null) as unknown as CSSProperties;
  const schoolName = school?.name ?? 'This school';

  const heading =
    activeYear === null ? 'Admissions' : `Admissions ${activeYear.name}`;

  const [branchRows, gradeRows] =
    moduleFlags.admissions && activeYear !== null
      ? await Promise.all([
          db
            .select({ id: branches.id, name: branches.name })
            .from(branches)
            .where(
              and(eq(branches.locationId, locationId), eq(branches.isActive, true)),
            )
            .orderBy(asc(branches.name)),
          db
            .select({
              id: grades.id,
              branchId: grades.branchId,
              name: grades.name,
              displayName: grades.displayName,
            })
            .from(grades)
            .where(and(eq(grades.locationId, locationId), eq(grades.isActive, true)))
            .orderBy(asc(grades.sortOrder)),
        ])
      : [[], []];

  return (
    <main style={brandStyle} className="min-h-screen bg-surface-sunken px-4 py-12">
      <div className="mx-auto w-full max-w-3xl">
        <header className="mb-8 flex flex-col items-center text-center">
          {school?.logoUrl != null && school.logoUrl !== '' ? (
            // Logo dimensions vary per school; a plain <img> avoids forcing one.
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={school.logoUrl}
              alt={`${schoolName} logo`}
              className="mb-4 h-16 w-16 rounded-xl object-contain"
            />
          ) : (
            <span
              aria-hidden="true"
              className="mb-4 flex h-16 w-16 items-center justify-center rounded-xl bg-brand-primary text-xl font-bold text-brand-onPrimary"
            >
              {schoolName.slice(0, 2).toUpperCase()}
            </span>
          )}

          <h1 className="text-2xl font-bold text-ink">{schoolName}</h1>
          <p className="mt-1 text-sm text-ink-muted">{heading}</p>
        </header>

        {!moduleFlags.admissions ? (
          <Card>
            <h2 className="text-base font-semibold text-ink">
              Applications are not currently open
            </h2>
            <p className="mt-2 text-sm text-ink-muted">
              {schoolName} is not accepting online applications at the moment.
              Please contact the school office directly.
            </p>
          </Card>
        ) : activeYear === null ? (
          <Card>
            <h2 className="text-base font-semibold text-ink">
              Admissions are not open at this time
            </h2>
            <p className="mt-2 text-sm text-ink-muted">
              {schoolName} has not opened admissions for the coming academic year
              yet. Please check back, or contact the school office.
            </p>
          </Card>
        ) : (
          <>
            <p className="mb-6 text-sm text-ink-muted">
              Fill this in and our admissions team will email you about the next
              steps. Nothing here is a commitment — you can talk to us before
              deciding anything.
            </p>

            <ApplyForm
              branches={branchRows}
              grades={gradeRows.map((grade) => ({
                id: grade.id,
                branchId: grade.branchId,
                label: gradeLabel(grade),
              }))}
            />
          </>
        )}
      </div>
    </main>
  );
}
