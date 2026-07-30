import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { BrandingManager } from '@/components/super-admin/BrandingManager';
import { isUuid } from '@/lib/validation';

export const metadata: Metadata = {
  title: 'Branding',
};

export const dynamic = 'force-dynamic';

export default async function SchoolBrandingPage({
  params,
}: {
  params: Promise<{ schoolId: string }>;
}) {
  const { schoolId } = await params;
  if (!isUuid(schoolId)) notFound();

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-lg font-semibold text-slate-900">Branding</h3>
        <p className="mt-1 text-sm text-slate-500">
          Upload the school logo and choose a colour palette. Colours are
          extracted from the logo and applied across the school&rsquo;s portal.
        </p>
      </div>

      <BrandingManager schoolId={schoolId} />
    </div>
  );
}
