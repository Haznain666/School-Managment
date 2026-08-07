/**
 * The Supabase project hostname, so `next/image` will serve school logos.
 * Derived from SUPABASE_URL rather than hard-coded, because the project ref
 * differs between environments. Falls back to a wildcard suffix match when the
 * variable is absent at build time.
 */
const supabaseHostname = (() => {
  const raw = process.env.SUPABASE_URL;
  if (raw === undefined || raw.trim() === '') return '*.supabase.co';
  try {
    return new URL(raw.trim()).hostname;
  } catch {
    return '*.supabase.co';
  }
})();

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,

  /**
   * Hostinger runs the app as a plain Node process, not on a platform that
   * installs dependencies for us. `standalone` emits `.next/standalone` with a
   * self-contained `server.js` and only the node_modules actually reached, so
   * the deploy artifact is small and `npm ci --omit=dev` is not needed on the
   * host. Remember to copy `public/` and `.next/static` alongside it — Next
   * does not place them inside `standalone`.
   */
  output: 'standalone',

  // This app lives in a subdirectory of a repo that has its own lockfile at the
  // root; pin tracing here so Next.js does not guess the wrong workspace root.
  outputFileTracingRoot: import.meta.dirname,

  // firebase-admin pulls in optional native/gRPC deps that must not be bundled
  // by the Next.js server compiler — keep them as runtime `require`s.
  // TODO: drop once Supabase Auth replaces Firebase (Stage 2, see STATE.md).
  serverExternalPackages: ['firebase-admin'],

  typescript: {
    // Never ship a build that does not typecheck.
    ignoreBuildErrors: false,
  },

  images: {
    remotePatterns: [
      // School logos live in Supabase Storage under /{locationId}/...
      { protocol: 'https', hostname: supabaseHostname },
    ],
  },
};

export default nextConfig;
