'use client';

import { useEffect, useState } from 'react';

import { useAuth } from '@/components/auth/AuthProvider';
import { Badge, statusToBadgeVariant } from '@/components/ui/Badge';
import { Card } from '@/components/ui/Card';
import { apiFetch } from '@/lib/api-client';

interface SchoolRow {
  subdomain: string;
  locationId: string;
  schoolName: string;
  status: string;
  logoUrl: string | null;
}

export function SchoolsTable() {
  const { status: authStatus } = useAuth();
  const [schools, setSchools] = useState<SchoolRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (authStatus !== 'authenticated') return;

    let cancelled = false;

    void apiFetch<{ schools: SchoolRow[] }>('/api/schools')
      .then((data) => {
        if (!cancelled) setSchools(data.schools);
      })
      .catch(() => {
        if (!cancelled) setError('Could not load schools.');
      });

    return () => {
      cancelled = true;
    };
  }, [authStatus]);

  if (error !== null) {
    return (
      <Card>
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
      </Card>
    );
  }

  if (schools === null) {
    return (
      <Card>
        <p className="text-sm text-slate-500">Loading schools…</p>
      </Card>
    );
  }

  if (schools.length === 0) {
    return (
      <Card>
        <p className="text-sm text-slate-600">
          No schools provisioned yet. Create one with{' '}
          <code className="rounded bg-slate-100 px-1.5 py-0.5">POST /api/schools</code>.
        </p>
      </Card>
    );
  }

  return (
    <Card className="p-0">
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th scope="col" className="px-4 py-3 font-medium">
                School
              </th>
              <th scope="col" className="px-4 py-3 font-medium">
                Subdomain
              </th>
              <th scope="col" className="px-4 py-3 font-medium">
                Location ID
              </th>
              <th scope="col" className="px-4 py-3 font-medium">
                Status
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {schools.map((school) => (
              <tr key={school.locationId}>
                <td className="px-4 py-3 font-medium text-slate-900">
                  {school.schoolName}
                </td>
                <td className="px-4 py-3 text-slate-600">{school.subdomain}</td>
                <td className="px-4 py-3 font-mono text-xs text-slate-600">
                  {school.locationId}
                </td>
                <td className="px-4 py-3">
                  <Badge variant={statusToBadgeVariant(school.status)}>
                    {school.status}
                  </Badge>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
