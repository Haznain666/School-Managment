import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { FlatCompat } from '@eslint/eslintrc';

const compat = new FlatCompat({
  baseDirectory: dirname(fileURLToPath(import.meta.url)),
});

const config = [
  {
    // Generated or separately-configured trees.
    ignores: [
      '.next/**',
      'node_modules/**',
      /*
       * Git worktrees live under `.claude/worktrees/`, and each is a full
       * checkout of this same repository. Without this, linting the main
       * checkout walks into every one of them and reports the same files
       * several times over — and once a worktree has installed its own
       * `node_modules`, tens of thousands of errors out of third-party code.
       *
       * A worktree lints itself, from inside itself. It was never this
       * checkout's job, and CI never saw it because CI checks out a clean tree
       * with no worktrees in it.
       */
      '.claude/**',
      'db/migrations/**',
      'functions/**',
      'next-env.d.ts',
      // The packed Hostinger artifact (§5). Built output, not source.
      'dist/**',
    ],
  },
  ...compat.extends('next/core-web-vitals', 'next/typescript'),
];

export default config;
