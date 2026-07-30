'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';

import { useAuth } from '@/components/auth/AuthProvider';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { apiFetch } from '@/lib/api-client';
import { portalPathForRole, type UserClaimRole } from '@/lib/claims';

interface HeldRole {
  id: string;
  role: UserClaimRole;
  branchId: string | null;
  branchName: string | null;
}

const ROLE_LABELS: Record<UserClaimRole, string> = {
  super_admin: 'Super Admin',
  school_admin: 'School Admin',
  principal: 'Principal',
  vice_principal: 'Vice Principal',
  coordinator: 'Coordinator',
  teacher: 'Teacher',
  hr_manager: 'HR Manager',
  accountant: 'Accountant',
  marketing: 'Marketing',
  student: 'Student',
  parent: 'Parent',
};

export function RoleSelector() {
  const router = useRouter();
  const { status, claims, getToken } = useAuth();

  const [roles, setRoles] = useState<HeldRole[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pendingRoleId, setPendingRoleId] = useState<string | null>(null);

  useEffect(() => {
    if (status === 'unauthenticated') {
      router.replace('/login');
      return;
    }
    if (status !== 'authenticated') return;

    let cancelled = false;

    void apiFetch<{ roles: HeldRole[] }>('/api/auth/roles')
      .then((data) => {
        if (!cancelled) setRoles(data.roles);
      })
      .catch(() => {
        if (!cancelled) setError('Could not load your roles. Please try again.');
      });

    return () => {
      cancelled = true;
    };
  }, [status, router]);

  const handleSelect = useCallback(
    async (held: HeldRole) => {
      setPendingRoleId(held.id);
      setError(null);

      try {
        await apiFetch('/api/auth/select-role', {
          method: 'POST',
          body: JSON.stringify({ role: held.role, branchId: held.branchId }),
        });

        // Claims changed server-side; pull a fresh token before routing so the
        // portal sees the role that was just activated.
        await getToken(true);

        const locationId = claims?.location_id ?? '';
        router.replace(portalPathForRole(held.role, locationId));
      } catch {
        setError('Could not switch to that role. Please try again.');
        setPendingRoleId(null);
      }
    },
    [claims, getToken, router],
  );

  if (error !== null && roles === null) {
    return (
      <Card>
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
      </Card>
    );
  }

  if (roles === null) {
    return (
      <Card>
        <p className="text-sm text-slate-500">Loading your roles…</p>
      </Card>
    );
  }

  if (roles.length === 0) {
    return (
      <Card>
        <p className="text-sm text-slate-600">
          No active roles are assigned to your account. Contact your school
          administrator.
        </p>
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      {error !== null ? (
        <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      ) : null}

      {roles.map((held) => (
        <Card key={held.id}>
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="font-medium text-slate-900">{ROLE_LABELS[held.role]}</p>
              <Badge variant="neutral" className="mt-1">
                {held.branchName ?? 'All branches'}
              </Badge>
            </div>
            <Button
              size="sm"
              isLoading={pendingRoleId === held.id}
              disabled={pendingRoleId !== null && pendingRoleId !== held.id}
              onClick={() => {
                void handleSelect(held);
              }}
            >
              Continue
            </Button>
          </div>
        </Card>
      ))}
    </div>
  );
}
