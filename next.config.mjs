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

  /**
   * Brotli/gzip on the Node response.
   *
   * Explicit rather than relying on the default, because the default is the
   * kind of thing that changes between majors and this deployment cannot
   * afford it silently turning off: Hostinger's CDN sits in front of the
   * origin but does not compress an already-uncompressed origin response for
   * every content type, and "enable text compression" is one of the two things
   * their own diagnostics panel scores this site 0 on.
   */
  compress: true,

  /** Nothing needs to know the server is Next.js; one header per response. */
  poweredByHeader: false,

  /**
   * Source maps are ~2-4x the size of the bundles they describe and are
   * fetched by anyone who opens devtools on the live site. Off in production.
   */
  productionBrowserSourceMaps: false,

  experimental: {
    /**
     * Barrel-file imports (`import { Plus } from 'lucide-react'`) pull the
     * whole index module into the graph before tree-shaking gets a chance.
     * 17 files in this app import from `lucide-react` that way. Next ships a
     * default list that already covers it, but naming it here keeps the
     * behaviour if that default ever changes.
     */
    optimizePackageImports: ['lucide-react'],
  },

  /**
   * Cache headers.
   *
   * ── Why this is worth doing by hand ──────────────────────────────────────
   * Measured against the live origin on 2026-08-19: a response the CDN could
   * serve from its edge came back in ~85ms, and one that had to reach the
   * origin took ~1.0s. The gap is the edge -> origin hop, and the only lever
   * the application has over it is telling the CDN what it is allowed to keep.
   *
   * Authenticated portal HTML is deliberately absent from this list. It is
   * per-tenant and per-session and must never be stored at an edge; Next
   * already marks it `no-store` and that is correct.
   */
  async headers() {
    return [
      {
        // Hashed filenames — the content cannot change without the URL
        // changing, so this is safe at any duration.
        source: '/_next/static/:path*',
        headers: [
          { key: 'Cache-Control', value: 'public, max-age=31536000, immutable' },
        ],
      },
      {
        source: '/icon/:size',
        headers: [
          { key: 'Cache-Control', value: 'public, max-age=86400, stale-while-revalidate=604800' },
        ],
      },
    ];
  },
};

export default nextConfig;
