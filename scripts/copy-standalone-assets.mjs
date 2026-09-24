#!/usr/bin/env node

/**
 * postbuild: put `public/` and `.next/static` inside `.next/standalone`.
 *
 * `output: 'standalone'` emits a `server.js` that serves only what sits beside
 * it, and Next deliberately does not copy either directory there (DEPLOYMENT.md
 * §1). Until Sprint 35 the repository had no `public/`, so only `.next/static`
 * mattered. Sprint 35 adds `public/brand/*.png`, drawn by the apex, the
 * operator sign-in and the panel sidebar — a 404 on every one of them if the
 * host runs `server.js` without this copy (PENDING L8).
 *
 * Hostinger builds from git and its start command is not visible from the
 * repository, so this runs on every `npm run build`: under `next start` the
 * copy is simply unused, and under `node .next/standalone/server.js` it is what
 * makes the logo load. Idempotent, and a no-op when there is no standalone
 * output (a failed or non-standalone build).
 */

import { cpSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const standalone = join(root, '.next', 'standalone');

if (!existsSync(standalone)) {
  console.log('postbuild: no .next/standalone — nothing to copy');
  process.exit(0);
}

for (const [from, to] of [
  [join(root, 'public'), join(standalone, 'public')],
  [join(root, '.next', 'static'), join(standalone, '.next', 'static')],
]) {
  if (!existsSync(from)) {
    console.log(`postbuild: ${from} absent — skipped`);
    continue;
  }
  cpSync(from, to, { recursive: true, force: true });
  console.log(`postbuild: copied ${from} -> ${to}`);
}
