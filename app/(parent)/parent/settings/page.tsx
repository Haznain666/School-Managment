import type { Metadata } from 'next';

import { NotificationPreferencesForm } from '@/components/parent/NotificationPreferencesForm';
import { Card, CardTitle } from '@/components/ui/Card';
import { PageHeader } from '@/components/ui/PageHeader';
import { requireSchoolRole } from '@/lib/school-guard';
import { getSchoolUserByUid } from '@/lib/school-queries';

export const metadata: Metadata = {
  title: 'Settings',
};

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * A parent's own settings — notification preferences, and their contact details
 * shown read-only.
 *
 * The details are the school's record, not the parent's to edit here: an
 * address a parent changed in the portal and the office never saw would be
 * worse than one they had to phone in, because both sides would believe it was
 * current. The screen says who to ask rather than offering a field that writes
 * to nothing.
 */
export default async function ParentSettingsPage() {
  const { claims, locationId } = await requireSchoolRole(['parent']);
  const profile = await getSchoolUserByUid(locationId, claims.uid);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Settings"
        description="What this school emails you, and the contact details it holds."
      />

      <NotificationPreferencesForm />

      <Card header={<CardTitle title="Your details" />}>
        <dl className="grid gap-4 sm:grid-cols-3">
          {[
            { label: 'Name', value: profile?.name ?? null },
            { label: 'Email', value: profile?.email ?? null },
            { label: 'Phone', value: profile?.phone ?? null },
          ].map((field) => (
            <div key={field.label}>
              <dt className="text-xs font-medium uppercase tracking-wide text-ink-muted">
                {field.label}
              </dt>
              <dd className="mt-1 break-words text-sm text-ink">
                {field.value === null || field.value === '' ? (
                  <span className="text-ink-muted">Not set</span>
                ) : (
                  field.value
                )}
              </dd>
            </div>
          ))}
        </dl>

        <p className="mt-4 text-xs text-ink-muted">
          These are the school&rsquo;s record of you. Ask the school office to
          change them — your email address is also how you sign in, so it is not
          something the portal can alter on its own.
        </p>
      </Card>
    </div>
  );
}
