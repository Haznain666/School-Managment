import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Portal unavailable',
};

const REASON_MESSAGES: Record<string, string> = {
  suspended:
    'This school portal is temporarily suspended. Please contact your school administrator.',
  inactive: 'This school portal is not currently active.',
  lookup:
    'We could not reach the directory service. Please try again in a few moments.',
};

/** Reached when a school exists but is not `active`, or lookup failed. */
export default async function SchoolUnavailablePage({
  searchParams,
}: {
  searchParams: Promise<{ reason?: string; school?: string }>;
}) {
  const { reason, school } = await searchParams;
  const message =
    (reason === undefined ? undefined : REASON_MESSAGES[reason]) ??
    'This school portal is unavailable right now.';

  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col justify-center px-6 text-center">
      <h1 className="text-3xl font-bold text-slate-900">
        {school === undefined || school === '' ? 'Portal unavailable' : school}
      </h1>
      <p className="mt-3 text-slate-600">{message}</p>
    </main>
  );
}
