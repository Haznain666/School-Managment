import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'SMS Platform',
};

/**
 * Public landing page, served on the apex domain.
 * Schools reach their own portal at `<school>.<NEXT_PUBLIC_APP_DOMAIN>`.
 */
export default function LandingPage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col justify-center px-6 py-16">
      <p className="text-sm font-semibold uppercase tracking-wide text-brand-primary">
        SMS Platform
      </p>
      <h1 className="mt-3 text-4xl font-bold tracking-tight text-slate-900">
        School management, built for Pakistani schools.
      </h1>
      <p className="mt-4 text-lg text-slate-600">
        Admissions, branches, staff and students — one system per school, on your
        own subdomain.
      </p>

      <div className="mt-10 rounded-card border border-slate-200 bg-slate-50 p-6">
        <h2 className="text-base font-semibold text-slate-900">
          Looking for your school portal?
        </h2>
        <p className="mt-2 text-sm text-slate-600">
          Each school has its own address, for example{' '}
          <code className="rounded bg-white px-1.5 py-0.5 text-slate-800">
            yourschool.{process.env.NEXT_PUBLIC_APP_DOMAIN ?? 'platform.com'}
          </code>
          . Use the link your school gave you to sign in.
        </p>
      </div>
    </main>
  );
}
