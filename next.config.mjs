/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,

  // This app lives in a subdirectory of a repo that has its own lockfile at the
  // root; pin tracing here so Next.js does not guess the wrong workspace root.
  outputFileTracingRoot: import.meta.dirname,

  // firebase-admin pulls in optional native/gRPC deps that must not be bundled
  // by the Next.js server compiler — keep them as runtime `require`s.
  serverExternalPackages: ['firebase-admin'],

  typescript: {
    // Never ship a build that does not typecheck.
    ignoreBuildErrors: false,
  },

  images: {
    remotePatterns: [
      // School logos live in Firebase Storage under /{locationId}/...
      { protocol: 'https', hostname: 'firebasestorage.googleapis.com' },
      { protocol: 'https', hostname: 'storage.googleapis.com' },
    ],
  },
};

export default nextConfig;
