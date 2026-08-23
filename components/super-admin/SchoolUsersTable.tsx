'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, CardTitle } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { DataTable, type DataTableColumn } from '@/components/ui/DataTable';
import { PhoneField } from '@/components/ui/PhoneField';
import { superAdminFetch, SuperAdminApiError } from '@/lib/super-admin-client';
import { MAX_BULK_DELETE, type DeletionOutcome } from '@/lib/user-deletion';
import { ROLE_LABELS, isUserRole } from '@/types/school-auth';

interface SchoolUserRow {
  id: string;
  name: string;
  role: string;
  phone: string;
  email: string | null;
  isActive: boolean;
  branchName: string | null;
  joinedAt: string | null;
  /** True once the person has a Supabase identity — i.e. has signed in once. */
  hasAuthAccount: boolean;
}

interface EmergencyToken {
  url: string;
  expiresAt: string;
  userName: string;
  userRole: string;
}

export interface SchoolUsersTableProps {
  schoolId: string;
}

/**
 * School members, with the controls a platform operator needs when a school
 * cannot help itself: send someone their sign-in details, issue an emergency
 * link, deactivate, delete.
 *
 * ── Why "Send sign-in email" exists ──────────────────────────────────────
 * "Add administrator" writes a member row and sends nothing — see the route at
 * `.../users/[userId]/send-signin`. Without this button the first
 * administrator of every school sits here having been told nothing, and the
 * operator's only recourse is to phone them and read the URL out.
 *
 * ── Deactivate versus delete ─────────────────────────────────────────────
 * Deactivate is the ordinary answer and takes effect on the person's next
 * request. Delete is offered because a mistyped address should not have to be
 * carried forever, but the API refuses it once the person's name is on any
 * record the school keeps, and says so. Both are confirmed inline rather than
 * through `window.confirm`, which is unstyled and easy to dismiss by reflex.
 */
export function SchoolUsersTable({ schoolId }: SchoolUsersTableProps) {
  const [users, setUsers] = useState<SchoolUserRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [issued, setIssued] = useState<EmergencyToken | null>(null);
  const [copied, setCopied] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [confirmBulk, setConfirmBulk] = useState(false);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [refusals, setRefusals] = useState<DeletionOutcome[]>([]);
  const headerCheckbox = useRef<HTMLInputElement>(null);

  const [isAdding, setIsAdding] = useState(false);
  const [adminName, setAdminName] = useState('');
  const [adminPhone, setAdminPhone] = useState('');
  const [adminEmail, setAdminEmail] = useState('');
  const [savingAdmin, setSavingAdmin] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const base = `/api/super-admin/schools/${schoolId}/users`;

  const load = useCallback(async () => {
    try {
      const data = await superAdminFetch<{ users: SchoolUserRow[] }>(base);
      setUsers(data.users);
      setError(null);
    } catch {
      setError('Could not load users.');
    }
  }, [base]);

  useEffect(() => {
    void load();
  }, [load]);

  /** Shared wrapper: one row busy at a time, errors reported the same way. */
  const act = useCallback(
    async (userId: string, run: () => Promise<string>, fallback: string) => {
      setPendingId(userId);
      setError(null);
      setNotice(null);

      try {
        setNotice(await run());
        await load();
      } catch (caught) {
        setError(caught instanceof SuperAdminApiError ? caught.message : fallback);
      } finally {
        setPendingId(null);
        setConfirmDelete(null);
      }
    },
    [load],
  );

  const sendSignIn = useCallback(
    (user: SchoolUserRow) =>
      act(
        user.id,
        async () => {
          const data = await superAdminFetch<{ email: string; name: string }>(
            `${base}/${user.id}/send-signin`,
            { method: 'POST' },
          );
          // "Queued", not "sent". The route hands the message to
          // `email_outbox` and returns; delivery happens seconds later outside
          // the request, and a bad address surfaces on the row rather than
          // here. Telling an operator "sent" when nothing has yet reached an
          // SMTP server is how they conclude the member has it and stop
          // chasing.
          return `Sign-in email queued for ${data.email}. It usually arrives within a minute.`;
        },
        'Could not queue the sign-in email.',
      ),
    [act, base],
  );

  const setActive = useCallback(
    (user: SchoolUserRow, isActive: boolean) =>
      act(
        user.id,
        async () => {
          await superAdminFetch(`${base}/${user.id}`, {
            method: 'PATCH',
            body: JSON.stringify({ is_active: isActive }),
          });
          return isActive
            ? `${user.name} reactivated.`
            : `${user.name} deactivated — access ends on their next request.`;
        },
        'Could not change that user.',
      ),
    [act, base],
  );

  const remove = useCallback(
    (user: SchoolUserRow) =>
      act(
        user.id,
        async () => {
          await superAdminFetch(`${base}/${user.id}`, { method: 'DELETE' });
          return `${user.name} deleted.`;
        },
        'Could not delete that user.',
      ),
    [act, base],
  );

  const selectedCount = users === null ? 0 : users.filter((u) => selected.has(u.id)).length;

  // React has no attribute for the indeterminate state, so it is set here.
  useEffect(() => {
    if (headerCheckbox.current === null) return;
    const total = users?.length ?? 0;
    headerCheckbox.current.indeterminate = selectedCount > 0 && selectedCount < total;
  }, [selectedCount, users]);

  const toggle = useCallback((userId: string) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(userId)) next.delete(userId);
      else next.add(userId);
      return next;
    });
    setConfirmBulk(false);
  }, []);

  const togglePage = useCallback(() => {
    setSelected((current) => {
      if (users === null) return current;
      const allOn = users.every((user) => current.has(user.id));
      return allOn ? new Set() : new Set(users.map((user) => user.id));
    });
    setConfirmBulk(false);
  }, [users]);

  /**
   * Bulk delete. A partial result is normal, not a failure — a member whose
   * name is on a register cannot be deleted at all — so the refusals are listed
   * with their reasons rather than collapsed into the count.
   */
  const removeSelected = useCallback(async () => {
    setBulkBusy(true);
    setError(null);
    setNotice(null);
    setRefusals([]);

    try {
      const data = await superAdminFetch<{
        outcomes: DeletionOutcome[];
        deleted: number;
        summary: string;
      }>(`${base}/bulk-delete`, {
        method: 'POST',
        body: JSON.stringify({ userIds: [...selected] }),
      });

      setNotice(data.summary);
      setRefusals(data.outcomes.filter((outcome) => !outcome.deleted));
      setSelected(new Set());
      setConfirmBulk(false);
      await load();
    } catch (caught) {
      setError(
        caught instanceof SuperAdminApiError
          ? caught.message
          : 'Could not delete those users.',
      );
    } finally {
      setBulkBusy(false);
    }
  }, [base, selected, load]);

  const generate = useCallback(
    async (userId: string) => {
      setPendingId(userId);
      setError(null);
      setCopied(false);

      try {
        const data = await superAdminFetch<EmergencyToken>(
          `${base}/${userId}/emergency-token`,
          { method: 'POST' },
        );
        setIssued(data);
      } catch (caught) {
        setError(
          caught instanceof SuperAdminApiError
            ? caught.message
            : 'Could not generate an emergency link.',
        );
      } finally {
        setPendingId(null);
      }
    },
    [base],
  );

  const addAdmin = useCallback(async () => {
    setSavingAdmin(true);
    setError(null);
    setNotice(null);

    try {
      const data = await superAdminFetch<{ userId: string; email: string }>(base, {
        method: 'POST',
        body: JSON.stringify({
          name: adminName.trim(),
          phone: adminPhone.trim(),
          email: adminEmail.trim(),
        }),
      });

      setNotice(
        `Administrator created. Nothing has been sent to ${data.email} yet — ` +
          'use "Send sign-in email" on their row to give them access.',
      );
      setIsAdding(false);
      setAdminName('');
      setAdminPhone('');
      setAdminEmail('');
      await load();
    } catch (caught) {
      setError(
        caught instanceof SuperAdminApiError
          ? caught.message
          : 'Could not create the administrator.',
      );
    } finally {
      setSavingAdmin(false);
    }
  }, [base, adminName, adminPhone, adminEmail, load]);

  const copy = useCallback(async () => {
    if (issued === null) return;
    try {
      await navigator.clipboard.writeText(issued.url);
      setCopied(true);
    } catch {
      // Clipboard access can be refused; the field is selectable either way.
      setCopied(false);
    }
  }, [issued]);

  if (users === null) {
    return (
      <Card>
        <p className="text-sm text-ink-muted">{error ?? 'Loading users…'}</p>
      </Card>
    );
  }

  const columns: Array<DataTableColumn<SchoolUserRow>> = [
    {
      id: 'select',
      headerClassName: 'w-10',
      className: 'w-10',
      header: (
        <input
          ref={headerCheckbox}
          type="checkbox"
          aria-label="Select every user"
          className="h-4 w-4 rounded border-line-strong"
          checked={users.length > 0 && selectedCount === users.length}
          onChange={togglePage}
        />
      ),
      cell: (user) => (
        <input
          type="checkbox"
          aria-label={`Select ${user.name}`}
          className="h-4 w-4 rounded border-line-strong"
          checked={selected.has(user.id)}
          onChange={() => {
            toggle(user.id);
          }}
        />
      ),
    },
    {
      id: 'name',
      header: 'Name',
      sortValue: (user) => user.name,
      searchValue: (user) => `${user.name} ${user.email ?? ''} ${user.phone}`,
      cell: (user) => (
        <>
          <span className="font-medium text-ink">{user.name}</span>
          {user.branchName !== null ? (
            <span className="block text-xs text-ink-muted">{user.branchName}</span>
          ) : null}
        </>
      ),
    },
    {
      id: 'role',
      header: 'Role',
      muted: true,
      sortValue: (user) => (isUserRole(user.role) ? ROLE_LABELS[user.role] : user.role),
      cell: (user) => (isUserRole(user.role) ? ROLE_LABELS[user.role] : user.role),
    },
    {
      id: 'email',
      header: 'Email',
      muted: true,
      // Blank sorts last, which puts the accounts that cannot sign in at the
      // bottom rather than at the top of an ascending sort by accident.
      sortValue: (user) => user.email,
      cell: (user) =>
        user.email !== null && user.email !== '' ? (
          user.email
        ) : (
          <span
            className="text-status-warning-ink"
            title="Sign-in is by email, so this account cannot be used."
          >
            None — cannot sign in
          </span>
        ),
    },
    {
      id: 'phone',
      header: 'Phone',
      muted: true,
      className: 'font-mono text-xs',
      sortValue: (user) => user.phone,
      cell: (user) => user.phone,
    },
    {
      id: 'status',
      header: 'Status',
      sortValue: (user) => (!user.isActive ? 2 : user.hasAuthAccount ? 0 : 1),
      cell: (user) =>
        !user.isActive ? (
          <Badge variant="danger">Deactivated</Badge>
        ) : user.hasAuthAccount ? (
          <Badge variant="success">Active</Badge>
        ) : (
          <Badge variant="warning">Never signed in</Badge>
        ),
    },
    {
      id: 'actions',
      header: 'Actions',
      align: 'numeric',
      cell: (user) => {
        const busy = pendingId === user.id;
        const hasEmail = user.email !== null && user.email !== '';

        return confirmDelete === user.id ? (
          <div className="flex flex-nowrap items-center justify-end gap-2 whitespace-nowrap">
            <span className="text-xs text-status-danger-ink">
              Delete {user.name} permanently?
            </span>
            <Button
              variant="danger"
              size="sm"
              isLoading={busy}
              onClick={() => {
                void remove(user);
              }}
            >
              Delete
            </Button>
            <Button
              variant="ghost"
              size="sm"
              disabled={busy}
              onClick={() => {
                setConfirmDelete(null);
              }}
            >
              Cancel
            </Button>
          </div>
        ) : (
          <div className="flex flex-nowrap items-center justify-end gap-2 whitespace-nowrap">
            {user.isActive && hasEmail ? (
              <Button
                variant="secondary"
                size="sm"
                isLoading={busy}
                title="Emails them the portal address and how to set a password."
                onClick={() => {
                  void sendSignIn(user);
                }}
              >
                {user.hasAuthAccount ? 'Resend sign-in email' : 'Send sign-in email'}
              </Button>
            ) : null}

            {user.hasAuthAccount && user.isActive ? (
              <Button
                variant="secondary"
                size="sm"
                isLoading={busy}
                title="Single-use link that signs them in, for when email is unavailable."
                onClick={() => {
                  void generate(user.id);
                }}
              >
                Emergency link
              </Button>
            ) : null}

            <Button
              variant="ghost"
              size="sm"
              isLoading={busy}
              onClick={() => {
                void setActive(user, !user.isActive);
              }}
            >
              {user.isActive ? 'Deactivate' : 'Reactivate'}
            </Button>

            <Button
              variant="ghost"
              size="sm"
              disabled={busy}
              className="text-status-danger-ink hover:bg-red-50"
              onClick={() => {
                setConfirmDelete(user.id);
                setError(null);
                setNotice(null);
              }}
            >
              Delete
            </Button>
          </div>
        );
      },
    },
  ];

  const addForm = (
    <Card
      header={
        <CardTitle
          title="Add an administrator"
          description="Creates a school_admin. Use this only to give a school its first member — everyone after that is invited from inside the portal."
        />
      }
    >
      <div className="grid gap-4 sm:grid-cols-3">
        <Input
          label="Full name"
          value={adminName}
          onChange={(event) => {
            setAdminName(event.target.value);
          }}
        />
        <Input
          label="Email"
          type="email"
          value={adminEmail}
          hint="Their sign-in identity. Required — there is no other way in."
          onChange={(event) => {
            setAdminEmail(event.target.value);
          }}
        />
        <PhoneField
          label="Mobile number"
          value={adminPhone}
          hint="A contact record, not a login."
          onChange={setAdminPhone}
        />
      </div>

      <div className="mt-4 flex gap-3">
        <Button
          isLoading={savingAdmin}
          disabled={
            adminName.trim() === '' ||
            adminPhone.trim() === '' ||
            !adminEmail.includes('@')
          }
          onClick={() => {
            void addAdmin();
          }}
        >
          Create administrator
        </Button>
        <Button
          variant="ghost"
          onClick={() => {
            setIsAdding(false);
            setError(null);
          }}
        >
          Cancel
        </Button>
      </div>
    </Card>
  );

  return (
    <div className="space-y-4">
      {error !== null ? (
        <p role="alert" className="rounded-lg bg-status-danger-subtle px-3 py-2 text-sm text-status-danger-ink">
          {error}
        </p>
      ) : null}

      {notice !== null ? (
        <p role="status" className="rounded-lg bg-status-success-subtle px-3 py-2 text-sm text-status-success-ink">
          {notice}
        </p>
      ) : null}

      {refusals.length > 0 ? (
        <div className="rounded-lg bg-status-warning-subtle px-3 py-2 text-sm text-status-warning-onSubtle">
          <p className="font-medium">These were kept:</p>
          <ul className="mt-1 space-y-1">
            {refusals.map((outcome) => (
              <li key={outcome.id}>
                <span className="font-medium">{outcome.name}</span> — {outcome.reason}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {selected.size > 0 ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-line bg-surface-raised px-4 py-3">
          <span className="text-sm text-ink">
            {selected.size} user{selected.size === 1 ? '' : 's'} selected
            {selected.size > MAX_BULK_DELETE
              ? ` — the limit is ${MAX_BULK_DELETE} at a time`
              : ''}
          </span>

          <div className="flex flex-nowrap items-center gap-2 whitespace-nowrap">
            {confirmBulk ? (
              <>
                <span className="text-sm text-status-danger-ink">
                  Delete {selected.size} user{selected.size === 1 ? '' : 's'} permanently?
                </span>
                <Button
                  variant="danger"
                  size="sm"
                  isLoading={bulkBusy}
                  onClick={() => {
                    void removeSelected();
                  }}
                >
                  Delete
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={bulkBusy}
                  onClick={() => {
                    setConfirmBulk(false);
                  }}
                >
                  Cancel
                </Button>
              </>
            ) : (
              <>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    setSelected(new Set());
                  }}
                >
                  Clear
                </Button>
                <Button
                  variant="danger"
                  size="sm"
                  disabled={selected.size > MAX_BULK_DELETE}
                  onClick={() => {
                    setConfirmBulk(true);
                    setError(null);
                    setNotice(null);
                  }}
                >
                  Delete selected
                </Button>
              </>
            )}
          </div>
        </div>
      ) : null}

      {isAdding ? addForm : null}

      {issued !== null ? (
        <div
          role="dialog"
          aria-labelledby="emergency-link-heading"
          className="rounded-card border border-status-warning bg-status-warning-subtle p-5"
        >
          <h3 id="emergency-link-heading" className="font-semibold text-status-warning-onSubtle">
            Emergency login link generated
          </h3>
          <p className="mt-1 text-sm text-status-warning-onSubtle">
            This link expires in 15 minutes and can only be used once. It signs
            the recipient in as {issued.userName} — treat it as a password.
          </p>

          <div className="mt-3 flex flex-col gap-2 sm:flex-row">
            <input
              readOnly
              value={issued.url}
              aria-label="Emergency login URL"
              onFocus={(event) => {
                event.target.select();
              }}
              className="w-full rounded-lg border border-status-warning bg-surface-raised px-3 py-2 font-mono text-xs text-ink"
            />
            <Button
              size="sm"
              onClick={() => {
                void copy();
              }}
            >
              {copied ? 'Copied' : 'Copy'}
            </Button>
          </div>

          <p className="mt-3 text-xs text-status-warning-onSubtle">
            Send this link directly to {issued.userName} via any channel.
          </p>

          <div className="mt-3">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                setIssued(null);
                setCopied(false);
              }}
            >
              Done
            </Button>
          </div>
        </div>
      ) : null}

      <Card
        header={
          <CardTitle
            title="Members"
            description={`${users.length} user${
              users.length === 1 ? '' : 's'
            } at this school.`}
            action={
              isAdding ? undefined : (
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => {
                    setIsAdding(true);
                    setNotice(null);
                  }}
                >
                  Add administrator
                </Button>
              )
            }
          />
        }
      >
        <DataTable
          caption="Users at this school"
          columns={columns}
          rows={users}
          getRowKey={(user) => user.id}
          rowSelected={(user) => selected.has(user.id)}
          rowClassName={(user) => (user.isActive ? undefined : 'bg-surface-sunken')}
          defaultSort={{ columnId: 'name', direction: 'asc' }}
          search={{ placeholder: 'Name, email or phone' }}
          filters={[
            {
              id: 'role',
              label: 'Role',
              allLabel: 'Every role',
              options: [...new Set(users.map((user) => user.role))].map((role) => ({
                value: role,
                label: isUserRole(role) ? ROLE_LABELS[role] : role,
              })),
              rowValue: (user) => user.role,
            },
            {
              id: 'status',
              label: 'Status',
              allLabel: 'Every status',
              options: [
                { value: 'active', label: 'Active' },
                { value: 'pending', label: 'Never signed in' },
                { value: 'inactive', label: 'Deactivated' },
              ],
              rowValue: (user) =>
                !user.isActive ? 'inactive' : user.hasAuthAccount ? 'active' : 'pending',
            },
          ]}
          itemNoun={{ singular: 'user', plural: 'users' }}
          emptyTitle="This school has no users yet"
          emptyDescription="Nobody can be invited until it has one, because invitations are sent from inside the school portal. Create the first administrator to open it up."
          emptyAction={
            isAdding ? undefined : (
              <Button
                onClick={() => {
                  setIsAdding(true);
                  setNotice(null);
                }}
              >
                Add first administrator
              </Button>
            )
          }
          noResultTitle="No members match those filters"
          noResultDescription="Widen the role or status, or clear the search."
        />
      </Card>
    </div>
  );
}
