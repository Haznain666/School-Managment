'use client';

import { useState } from 'react';

import { Button } from '@/components/ui/Button';
import { Card, CardTitle } from '@/components/ui/Card';
import { AddressAutocomplete } from '@/components/ui/AddressAutocomplete';
import { Input } from '@/components/ui/Input';
import { PhoneField } from '@/components/ui/PhoneField';
import { schoolErrorMessage, schoolFetch } from '@/lib/school-client';

/**
 * The school's own contact details, edited by the school.
 *
 * The platform-owned fields — name, subdomain, school code, city — are shown
 * beside the editable ones rather than hidden, with one line saying who to ask.
 * A settings screen that simply omits them leaves an administrator wondering
 * where their school code went; showing them read-only answers the question
 * before it is asked.
 */

export interface SchoolProfileFormProps {
  /** Platform-owned, shown for reference only. */
  readOnly: {
    name: string;
    slug: string;
    city: string;
    schoolCode: string | null;
  };
  initial: {
    phone: string | null;
    email: string | null;
    address: string | null;
    principalName: string | null;
  };
  canEdit: boolean;
}

export function SchoolProfileForm({ readOnly, initial, canEdit }: SchoolProfileFormProps) {
  const [phone, setPhone] = useState(initial.phone ?? '');
  const [email, setEmail] = useState(initial.email ?? '');
  const [address, setAddress] = useState(initial.address ?? '');
  const [principalName, setPrincipalName] = useState(initial.principalName ?? '');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const save = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    setNotice(null);

    try {
      await schoolFetch('/api/school/settings', {
        method: 'PATCH',
        body: JSON.stringify({
          phone: phone.trim(),
          email: email.trim(),
          address: address.trim(),
          principalName: principalName.trim(),
        }),
      });
      setNotice('School details saved.');
    } catch (caught) {
      setError(schoolErrorMessage(caught, 'Could not save the school details.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card
      header={
        <CardTitle
          title="School profile"
          description="Your contact details, kept by you rather than by the platform."
        />
      }
    >
      {error !== null ? (
        <p
          role="alert"
          className="mb-4 rounded-lg bg-status-danger-subtle px-3 py-2 text-sm text-status-danger-ink"
        >
          {error}
        </p>
      ) : null}

      {notice !== null ? (
        <p className="mb-4 rounded-lg bg-status-success-subtle px-3 py-2 text-sm text-status-success-ink">
          {notice}
        </p>
      ) : null}

      <dl className="mb-6 grid gap-4 rounded-lg bg-surface-sunken p-4 sm:grid-cols-2 lg:grid-cols-4">
        {[
          { label: 'Name', value: readOnly.name },
          { label: 'Subdomain', value: readOnly.slug },
          { label: 'City', value: readOnly.city },
          { label: 'School code', value: readOnly.schoolCode },
        ].map((field) => (
          <div key={field.label}>
            <dt className="text-xs uppercase tracking-wide text-ink-muted">
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

        <p className="text-xs text-ink-muted sm:col-span-2 lg:col-span-4">
          These are set by the platform administrator. The school code prefixes
          every student ID, challan and payslip number already issued, so
          changing it is not something a school does to itself.
        </p>
      </dl>

      <div className="grid gap-4 sm:grid-cols-2">
        <PhoneField
          label="Phone"
          value={phone}
          disabled={!canEdit}
          onChange={setPhone}
        />
        <Input
          label="Email"
          type="email"
          value={email}
          disabled={!canEdit}
          onChange={(event) => {
            setEmail(event.target.value);
          }}
        />
        {/*
          "Head of School", not "Principal name" — Sprint 19a, item 1.

          A school group has one head and several campus principals, and this
          field was being read as the second. The per-campus principal is a
          `principal_assignments` row and is now set on the branch itself, which
          is why the Settings page lost its principal card in the same sprint
          and this field survived it.

          The column stays `schools.principal_name`. A column rename is 1,200
          lines of unreviewable diff for a caption, and `lib/global-search.ts`
          searches it by name.
        */}
        <Input
          label="Head of School"
          value={principalName}
          disabled={!canEdit}
          hint="The whole school's head. Printed on vouchers, payslips and letterheads. Each campus's own principal is set on that campus."
          onChange={(event) => {
            setPrincipalName(event.target.value);
          }}
        />
        <div className="sm:col-span-2">
          <AddressAutocomplete
            label="Address"
            multiline
            rows={2}
            // `/api/school/settings` accepts four fields and coordinates are
            // not among them, so a pinned location shown here could not be
            // saved. Offering one would read as data loss on the next Save.
            withCoordinates={false}
            value={{ address, latitude: null, longitude: null }}
            disabled={!canEdit}
            onChange={(next) => {
              setAddress(next.address);
            }}
          />
        </div>
      </div>

      {canEdit ? (
        <div className="mt-4">
          <Button
            isLoading={busy}
            onClick={() => {
              void save();
            }}
          >
            Save details
          </Button>
        </div>
      ) : null}
    </Card>
  );
}
