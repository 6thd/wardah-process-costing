#!/usr/bin/env node

// Confirms the production build (dist/) never ships a demo-login password.
// A VITE_* value is inlined into the built browser bundle at compile time,
// so scanning the actual build output — not just the source — is what
// proves the fix, independent of how any future consumer sources a value.
// See src/store/auth-store.ts and its RED tests for the source-level fix,
// and src/lib/env-guard.ts for the explicit VITE_* allowlist that keeps a
// leftover VITE_DEMO_*_PASSWORD out of the bundle at the source.
//
// Containment: dist/ is canonicalized once via realpathSync into `distRoot`
// below. The recursive walk never follows symlinks — a symlinked entry is
// skipped outright via Dirent.isSymbolicLink() — and every candidate path
// is reached only through path.join(dir, entry.name) starting from that
// canonical root, never through a dereferenced symlink or externally
// supplied input, so no candidate can leave distRoot. isWithinRoot() below
// re-asserts that invariant as a second, independently unit-tested guard —
// see tests/ci/check-no-demo-passwords-in-build.test.ts for pure
// string-path cases (contained file, `..` escape, sibling directory, and a
// simulated post-realpath symlink target outside the root).

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const FORBIDDEN_VALUES = ['admin123', 'manager123', 'employee123'];
const ALLOWED_EXTENSIONS = /\.(js|mjs|cjs|html|css|json)$/;

// Pure, no I/O: given two already-resolved absolute paths, decide whether
// `candidate` is `root` itself or strictly nested inside it.
export function isWithinRoot(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function collectContainedFiles(root, dir) {
  const files = [];
  // `dir` is never external input: the initial call passes `root` itself
  // (realpathSync'd below from a fixed 'dist' segment), and every recursive
  // call passes path.join(dir, entry.name) for a Dirent that is neither a
  // symlink nor rejected by isWithinRoot() against that same canonical
  // `root` — so `dir` can never resolve outside it.
  // nosemgrep: Semgrep_javascript_pathtraversal_rule-non-literal-fs-filename
  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    if (entry.isSymbolicLink()) continue;

    const candidate = path.join(dir, entry.name);
    if (!isWithinRoot(root, candidate)) continue;

    if (entry.isDirectory()) {
      files.push(...collectContainedFiles(root, candidate));
      continue;
    }

    if (!entry.isFile()) continue;
    if (!ALLOWED_EXTENSIONS.test(entry.name)) continue;

    files.push(candidate);
  }

  return files;
}

function scanForForbiddenValues(files, relativeTo) {
  const violations = [];
  for (const file of files) {
    // `file` is drawn exclusively from collectContainedFiles()'s return
    // value above: every entry already passed isWithinRoot() against the
    // canonical `distRoot`, was reached without following a symlink, and
    // nothing here accepts an external or user-supplied path.
    // nosemgrep: Semgrep_javascript_pathtraversal_rule-non-literal-fs-filename
    const content = fs.readFileSync(file, 'utf8');
    for (const value of FORBIDDEN_VALUES) {
      if (content.includes(value)) {
        violations.push({ file: path.relative(relativeTo, file), value });
      }
    }
  }
  return violations;
}

function main() {
  const distDirCandidate = path.resolve(process.cwd(), 'dist');

  let distRoot;
  try {
    // `distDirCandidate` is process.cwd() joined with the fixed literal
    // segment 'dist' — never external input. Canonicalizing it here, once,
    // is what makes every isWithinRoot() check downstream meaningful: it is
    // the one and only trusted root for the whole scan below.
    // nosemgrep: Semgrep_javascript_pathtraversal_rule-non-literal-fs-filename
    distRoot = fs.realpathSync(distDirCandidate);
  } catch (err) {
    if (err.code === 'ENOENT') {
      console.error('DEMO_PASSWORD_BUILD_GATE_FAIL: dist/ does not exist — run `npm run build` first.');
      process.exit(1);
    }
    throw err;
  }

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
}

// Only scan when this file is run directly (`node check-no-demo-passwords-in-build.mjs`
// or `npm run check:no-demo-passwords`), not when isWithinRoot() is imported by
// its Vitest unit tests — importing must never risk exiting the test process
// or depend on dist/ existing yet.
const isMainModule = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMainModule) {
  main();
}
