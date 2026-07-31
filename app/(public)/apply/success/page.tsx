import type { Metadata } from 'next';
import type { CSSProperties } from 'react';

import { Card } from '@/components/ui/Card';
import { paletteToCSSVars } from '@/lib/branding';
import { getCurrentSchoolBranding } from '@/lib/school-tenant';

export const metadata: Metadata = {
  title: 'Application submitted',
};

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Confirmation after an application is submitted.
 *
 * The details come from the query string rather than a database read: the
 * applicant has no session, so there is nothing to authenticate a lookup with,
 * and the alternative — accepting an application id and reading the row — would
 * turn this page into a way to read anybody's application by guessing. What is
 * shown here is only what the person just typed in themselves.
 */
export default async function ApplySuccessPage({
  searchParams,
}: {
  searchParams: Promise<{
    ref?: string;
    student?: string;
    guardian?: string;
    phone?: string;
  }>;
}) {
  const school = await getCurrentSchoolBranding();
  const brandStyle = paletteToCSSVars(school?.palette ?? null) as unknown as CSSProperties;

  const { ref, student, guardian, phone } = await searchParams;

  const studentName = student ?? 'your child';
  const guardianName = guardian ?? 'you';

  return (
    <main
      style={brandStyle}
      className="flex min-h-screen items-center justify-center bg-slate-50 px-4 py-12"
    >
      <div className="w-full max-w-lg">
        <div className="mb-8 flex flex-col items-center text-center">
          {school?.logoUrl != null && school.logoUrl !== '' ? (
            // Logo dimensions vary per school; a plain <img> avoids forcing one.
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={school.logoUrl}
              alt={`${school.name} logo`}
              className="mb-4 h-16 w-16 rounded-xl object-contain"
            />
          ) : (
            <span
              aria-hidden="true"
              className="mb-4 flex h-16 w-16 items-center justify-center rounded-xl bg-brand-primary text-xl font-bold text-white"
            >
              {(school?.name ?? 'SMS').slice(0, 2).toUpperCase()}
            </span>
          )}

          <h1 className="text-2xl font-bold text-slate-900">
            Application submitted successfully
          </h1>
        </div>

        <Card>
          <p className="text-sm text-slate-700">
            We have received your application for{' '}
            <strong className="text-slate-900">{studentName}</strong>. Our
            admissions team will contact{' '}
            <strong className="text-slate-900">{guardianName}</strong>
            {phone === undefined || phone === '' ? null : (
              <>
                {' '}
                at <span className="font-mono">{phone}</span>
              </>
            )}{' '}
            via WhatsApp regarding the next steps.
          </p>

          {ref === undefined || ref === '' ? null : (
            <p className="mt-4 rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-600">
              Your reference: <span className="font-mono font-medium">{ref}</span>
              <span className="mt-1 block text-xs text-slate-500">
                Quote this if you contact the school about your application.
              </span>
            </p>
          )}
        </Card>

        <p className="mt-6 text-center text-xs text-slate-400">
          You do not need an account to apply. If {studentName} is offered a
          place, {school?.name ?? 'the school'} will set one up for you.
        </p>
      </div>
    </main>
  );
}
