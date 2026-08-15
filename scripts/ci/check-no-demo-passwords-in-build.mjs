#!/usr/bin/env node

// Confirms the production build (dist/) never ships a demo-login password.
// A VITE_* value is inlined into the built browser bundle at compile time,
// so scanning the actual build output — not just the source — is what
// proves the fix, independent of how any future consumer sources a value.
// See src/config/demo-credentials.ts and its RED tests for the fix itself.

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const FORBIDDEN_VALUES = ['admin123', 'manager123', 'employee123'];
const DIST_DIR = path.resolve(process.cwd(), 'dist');

function distFiles(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  return entries.flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return distFiles(full);
    if (/\.(js|mjs|cjs|html|css|json)$/.test(entry.name)) return [full];
    return [];
  });
}

if (!fs.existsSync(DIST_DIR)) {
  console.error('DEMO_PASSWORD_BUILD_GATE_FAIL: dist/ does not exist — run `npm run build` first.');
  process.exit(1);
}

const files = distFiles(DIST_DIR);
const violations = [];

for (const file of files) {
  const content = fs.readFileSync(file, 'utf8');
  for (const value of FORBIDDEN_VALUES) {
    if (content.includes(value)) {
      violations.push({ file: path.relative(process.cwd(), file), value });
    }
  }
}

if (violations.length > 0) {
  console.error('DEMO_PASSWORD_BUILD_GATE_FAIL: forbidden demo password found in production build:');
  for (const violation of violations) {
    console.error(`  ${violation.file}: contains "${violation.value}"`);
  }
  process.exit(1);
}

console.log(`DEMO_PASSWORD_BUILD_GATE_PASS files=${files.length}`);
