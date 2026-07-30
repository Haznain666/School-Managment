import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'School not found',
};

/**
 * Shown when the hostname (or `?school=`) resolves to no school, or to one
 * that is deactivated.
 *
 * Deliberately does not distinguish the two: whether a school exists is not
 * something an anonymous visitor needs to learn.
 */
export default function SchoolNotFoundPage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col justify-center px-6 text-center">
      <h1 className="text-3xl font-bold text-slate-900">School portal unavailable</h1>
      <p className="mt-3 text-slate-600">
        This address does not lead to an active school portal.
      </p>
      <p className="mt-6 text-sm text-slate-500">
        Check the link your school gave you, or contact your school
        administrator.
      </p>
    </main>
  );
}
