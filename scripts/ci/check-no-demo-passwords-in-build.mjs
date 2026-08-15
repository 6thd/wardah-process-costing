#!/usr/bin/env node

// Confirms the production build (dist/) never ships a demo-login password.
// A VITE_* value is inlined into the built browser bundle at compile time,
// so scanning the actual build output — not just the source — is what
// proves the fix, independent of how any future consumer sources a value.
// See src/config/demo-credentials.ts and its RED tests for the fix itself.
//
// The directory walk is intentionally contained: the root is canonicalized
// once via realpathSync, and every candidate entry is re-resolved and
// rejected unless it remains strictly inside that canonical root. This
// closes the symlink-escape and '..'/absolute-path cases a naive recursive
// walk would otherwise trust — verified below by runSelfTest() against a
// real temporary directory with an actual escaping symlink, on every run.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';

const FORBIDDEN_VALUES = ['admin123', 'manager123', 'employee123'];
const ALLOWED_EXTENSIONS = /\.(js|mjs|cjs|html|css|json)$/;

function isContainedIn(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function collectContainedFiles(root, dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    if (entry.isSymbolicLink()) continue;

    const candidate = path.resolve(dir, entry.name);
    if (!isContainedIn(root, candidate)) continue;

    if (entry.isDirectory()) {
      const resolvedDir = fs.realpathSync(candidate);
      if (!isContainedIn(root, resolvedDir)) continue;
      files.push(...collectContainedFiles(root, resolvedDir));
      continue;
    }

    if (!entry.isFile()) continue;
    if (!ALLOWED_EXTENSIONS.test(entry.name)) continue;

    const resolvedFile = fs.realpathSync(candidate);
    if (!isContainedIn(root, resolvedFile)) continue;

    files.push(resolvedFile);
  }

  return files;
}

function scanForForbiddenValues(files, relativeTo) {
  const violations = [];
  for (const file of files) {
    const content = fs.readFileSync(file, 'utf8');
    for (const value of FORBIDDEN_VALUES) {
      if (content.includes(value)) {
        violations.push({ file: path.relative(relativeTo, file), value });
      }
    }
  }
  return violations;
}

function runSelfTest() {
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'demo-password-gate-self-test-'));
  try {
    const trustedRoot = fs.realpathSync(fs.mkdtempSync(path.join(workDir, 'root-')));
    const outsideDir = path.join(workDir, 'outside');
    fs.mkdirSync(path.join(trustedRoot, 'assets'), { recursive: true });
    fs.mkdirSync(outsideDir, { recursive: true });

    fs.writeFileSync(path.join(trustedRoot, 'assets', 'safe.js'), "console.log('nothing forbidden here');");
    fs.writeFileSync(path.join(outsideDir, 'leak.js'), "console.log('manager123');");
    fs.symlinkSync(outsideDir, path.join(trustedRoot, 'assets', 'escape-dir'));
    fs.symlinkSync(
      path.join(outsideDir, 'leak.js'),
      path.join(trustedRoot, 'assets', 'escape-file.js')
    );

    const contained = collectContainedFiles(trustedRoot, trustedRoot);
    if (contained.length !== 1 || !contained[0].endsWith('safe.js')) {
      throw new Error(
        `Demo-password gate self-test: symlink containment failed — expected exactly` +
        ` [.../safe.js], got ${JSON.stringify(contained.map((f) => path.relative(workDir, f)))}`
      );
    }

    const violationsFromEscape = scanForForbiddenValues(contained, trustedRoot);
    if (violationsFromEscape.length !== 0) {
      throw new Error(
        'Demo-password gate self-test: a symlink-escaped file leaked into the scan: ' +
        JSON.stringify(violationsFromEscape)
      );
    }

    fs.writeFileSync(path.join(trustedRoot, 'assets', 'genuine-leak.js'), "console.log('manager123');");
    const containedAfterLeak = collectContainedFiles(trustedRoot, trustedRoot);
    const violations = scanForForbiddenValues(containedAfterLeak, trustedRoot);
    if (violations.length !== 1 || violations[0].value !== 'manager123') {
      throw new Error(
        'Demo-password gate self-test: a genuine in-root violation was not detected: ' +
        JSON.stringify(violations)
      );
    }
  } finally {
    fs.rmSync(workDir, { recursive: true, force: true });
  }
}

runSelfTest();

const distDirCandidate = path.resolve(process.cwd(), 'dist');

if (!fs.existsSync(distDirCandidate)) {
  console.error('DEMO_PASSWORD_BUILD_GATE_FAIL: dist/ does not exist — run `npm run build` first.');
  process.exit(1);
}

// The one and only trusted root for the real scan below.
const distRoot = fs.realpathSync(distDirCandidate);
const files = collectContainedFiles(distRoot, distRoot);
const violations = scanForForbiddenValues(files, process.cwd());

if (violations.length > 0) {
  console.error('DEMO_PASSWORD_BUILD_GATE_FAIL: forbidden demo password found in production build:');
  for (const violation of violations) {
    console.error(`  ${violation.file}: contains "${violation.value}"`);
  }
  process.exit(1);
}

console.log(`DEMO_PASSWORD_BUILD_GATE_PASS files=${files.length}`);
