#!/usr/bin/env node

/**
 * Prints the fingerprint of a value, so it can be compared against what the
 * deployed process reports without either side revealing the value.
 *
 * The fingerprint is the first 12 hex characters of SHA-256 — 48 bits. Enough
 * to confirm two strings are identical, far too little to attack a bcrypt hash
 * with, and short enough to compare by eye between a terminal and a browser.
 *
 * The question it answers: "is the value the live process holds the same one I
 * pasted into the hosting panel?" Length and prefix cannot answer that — two
 * different 60-character hashes look alike in both. Fingerprints match or they
 * do not.
 *
 *   npm run fingerprint
 *
 * It prompts, with the terminal echo off, so the value never reaches your shell
 * history. Then compare the printed fingerprint with `passwordHash.fingerprint`
 * from POST /api/internal/super-admin-check.
 */

import { createHash } from 'node:crypto';
import { createInterface } from 'node:readline';

const rl = createInterface({ input: process.stdin, output: process.stdout });

// Suppress the echo so a pasted secret does not stay on screen.
const wasRaw = process.stdin.isTTY === true;
if (wasRaw) {
  rl.output.write('Paste the value (input hidden): ');
  rl._writeToOutput = () => {};
} else {
  rl.output.write('Reading value from stdin...\n');
}

rl.question('', (answer) => {
  rl.close();
  if (wasRaw) process.stdout.write('\n');

  const value = answer.replace(/\r?\n$/, '');

  if (value === '') {
    console.error('Nothing entered.');
    process.exit(1);
  }

  const digest = createHash('sha256').update(value, 'utf8').digest('hex');

  console.log('');
  console.log('  length      :', value.length);
  console.log('  prefix      :', JSON.stringify(value.slice(0, 7)));
  console.log('  backslashes :', value.includes('\\') ? 'YES — this is the bug' : 'none');
  console.log('  fingerprint :', digest.slice(0, 12));
  console.log('');
  console.log('  Compare the fingerprint with passwordHash.fingerprint from');
  console.log('  POST /api/internal/super-admin-check on the live host.');
  console.log('  Different fingerprints mean the process is NOT holding this value.');
  console.log('');
});
