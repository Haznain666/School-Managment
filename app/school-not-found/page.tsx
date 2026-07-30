import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'School not found',
};

/** Reached when a subdomain has no matching row in `school_subdomains`. */
export default async function SchoolNotFoundPage({
  searchParams,
}: {
  searchParams: Promise<{ subdomain?: string }>;
}) {
  const { subdomain } = await searchParams;

  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col justify-center px-6 text-center">
      <h1 className="text-3xl font-bold text-slate-900">School not found</h1>
      <p className="mt-3 text-slate-600">
        {subdomain === undefined || subdomain === ''
          ? 'That address does not belong to any school on this platform.'
          : `No school is registered at "${subdomain}".`}
      </p>
      <p className="mt-6 text-sm text-slate-500">
        Check the link your school gave you, or contact your school administrator.
      </p>
    </main>
  );
}
