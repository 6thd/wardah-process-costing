#!/usr/bin/env node

// Generic guard: every production source file *added* in this diff must
// actually reach SonarCloud's coverage measurement — either it shows up as
// an `SF:` entry in coverage/lcov.info, or it is legitimately narrow-scoped
// out via sonar.coverage.exclusions (a deliberate, reviewed decision, not a
// stale wildcard).
//
// Root cause this replaces: sonar-project.properties carried a directory-wide
// `sonar.coverage.exclusions` glob (`**/src/features/accounting/journal-entries/components/**`)
// predating PR #140's extraction. The new, fully-tested `JournalEntrySections.tsx`
// landed inside that directory and inherited the exclusion silently — SonarCloud
// reported 0.0% coverage on new code even though the file was 100% covered in
// coverage/lcov.info. The previous gate only checked one hardcoded filename
// (EnhancedInsightsDashboard.tsx), so it could not have caught this. This gate
// discovers added files from the actual diff and checks all of them, generically,
// against the same sonar.coverage.exclusions globs Sonar itself evaluates —
// so a new file silently swallowed by a pre-existing broad exclusion fails CI
// instead of merging with an invisible coverage blind spot.
//
// Deliberately excluded files (e.g. large coordinator shells carrying an
// explicit, reviewed sonar.coverage.exclusions entry of their own) are not
// flagged — only files matched by a *pre-existing* glob they did not add
// themselves trip this gate, because isProductionSourceFile()/matchesAnyGlob()
// below evaluate the exclusions exactly as Sonar would.

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

// Pure, no I/O: parse a .properties-style file (comma-separated glob lists,
// continued across lines with a trailing backslash) into the three lists
// this gate cares about.
export function parseSonarProperties(text) {
  const props = {};
  let currentKey = null;
  let buffer = '';

  for (const rawLine of text.split(/\r?\n/)) {
    if (currentKey) {
      const continues = rawLine.endsWith('\\');
      buffer += continues ? rawLine.slice(0, -1) : rawLine;
      if (continues) continue;
      props[currentKey] = buffer;
      currentKey = null;
      buffer = '';
      continue;
    }

    const trimmed = rawLine.trim();
    if (trimmed === '' || trimmed.startsWith('#')) continue;

    const eq = rawLine.indexOf('=');
    if (eq === -1) continue;

    const key = rawLine.slice(0, eq).trim();
    let value = rawLine.slice(eq + 1);
    const continues = value.endsWith('\\');
    if (continues) value = value.slice(0, -1);

    if (continues) {
      currentKey = key;
      buffer = value;
    } else {
      props[key] = value;
    }
  }

  const toList = (value) => (value ?? '').split(',').map((entry) => entry.trim()).filter(Boolean);

  return {
    sources: toList(props['sonar.sources']),
    exclusions: toList(props['sonar.exclusions']),
    coverageExclusions: toList(props['sonar.coverage.exclusions']),
  };
}

// Pure, no I/O: Ant-style glob (`**`, `*`, `?`) to an anchored RegExp,
// matching the same semantics SonarCloud/sonar-scanner uses for
// sonar.exclusions / sonar.coverage.exclusions.
export function globToRegExp(glob) {
  let pattern = '';
  let i = 0;

  while (i < glob.length) {
    const char = glob[i];

    if (char === '*' && glob[i + 1] === '*') {
      if (glob[i + 2] === '/') {
        pattern += '(?:.*/)?';
        i += 3;
      } else {
        pattern += '.*';
        i += 2;
      }
      continue;
    }

    if (char === '*') {
      pattern += '[^/]*';
      i += 1;
      continue;
    }

    if (char === '?') {
      pattern += '[^/]';
      i += 1;
      continue;
    }

    if ('.+^${}()|[]\\'.includes(char)) {
      pattern += `\\${char}`;
      i += 1;
      continue;
    }

    pattern += char;
    i += 1;
  }

  return new RegExp(`^${pattern}$`);
}

// Pure, no I/O.
export function matchesAnyGlob(filePath, globs) {
  return globs.some((glob) => globToRegExp(glob).test(filePath));
}

// Pure, no I/O: is `filePath` in scope for Sonar analysis at all — under
// sonar.sources and not already dropped by the general sonar.exclusions list
// (node_modules, dist, test files, archives, ...)?
export function isProductionSourceFile(filePath, sonarConfig) {
  const underSources = sonarConfig.sources.some(
    (src) => filePath === src || filePath.startsWith(`${src}/`),
  );
  if (!underSources) return false;
  return !matchesAnyGlob(filePath, sonarConfig.exclusions);
}

// Pure, no I/O: extract the set of paths SonarCloud will actually receive
// coverage numbers for, from an lcov.info report.
export function parseLcovSourceFiles(lcovContent) {
  const files = new Set();
  for (const line of lcovContent.split(/\r?\n/)) {
    if (line.startsWith('SF:')) {
      files.add(line.slice(3).trim().replace(/^\.\//, ''));
    }
  }
  return files;
}

// Pure, no I/O: the actual gate. For every added production file, fail it
// if a sonar.coverage.exclusions glob hides it from Sonar, or if it never
// made it into the coverage report in the first place.
export function findNewSourceCoverageGaps({ addedFiles, sonarConfig, lcovSourceFiles }) {
  const checked = [];
  const errors = [];

  for (const file of addedFiles) {
    if (!isProductionSourceFile(file, sonarConfig)) continue;
    checked.push(file);

    if (matchesAnyGlob(file, sonarConfig.coverageExclusions)) {
      errors.push({
        file,
        reason: 'excluded-by-coverage-glob',
        detail: 'matched by a sonar.coverage.exclusions glob — narrow that glob so this new file is measured, or add a deliberate, reviewed exclusion for it specifically',
      });
      continue;
    }

    if (!lcovSourceFiles.has(file)) {
      errors.push({
        file,
        reason: 'missing-from-lcov',
        detail: 'missing from coverage/lcov.info — add focused tests so this file is exercised by the coverage run',
      });
    }
  }

  return { checked, errors };
}

function isZeroSha(sha) {
  return /^0+$/.test(sha ?? '');
}

// Resolves the ref to diff against, trying (in order): an explicit override,
// the PR base branch, the pre-push SHA, and finally the previous commit —
// each candidate is verified to actually resolve before use, so an
// unreachable ref is skipped rather than crashing the gate.
export function resolveBaseRef({ env, execGit }) {
  const candidates = [];
  if (env.SONAR_GUARD_BASE_REF) candidates.push(env.SONAR_GUARD_BASE_REF);
  if (env.GITHUB_BASE_REF) candidates.push(`origin/${env.GITHUB_BASE_REF}`);
  if (env.GITHUB_EVENT_BEFORE && !isZeroSha(env.GITHUB_EVENT_BEFORE)) {
    candidates.push(env.GITHUB_EVENT_BEFORE);
  }
  candidates.push('HEAD^');

  for (const candidate of candidates) {
    try {
      execGit(['rev-parse', '--verify', `${candidate}^{commit}`]);
      return candidate;
    } catch {
      // try the next candidate
    }
  }

  return null;
}

function main() {
  const repoRoot = process.cwd();
  const propsPath = path.join(repoRoot, 'sonar-project.properties');
  const lcovPath = path.join(repoRoot, 'coverage', 'lcov.info');

  if (!fs.existsSync(propsPath)) {
    console.error('NEW_SOURCE_COVERAGE_GATE_FAIL: sonar-project.properties was not found');
    process.exit(1);
  }
  if (!fs.existsSync(lcovPath)) {
    console.error('NEW_SOURCE_COVERAGE_GATE_FAIL: coverage/lcov.info was not generated by npm run test:coverage');
    process.exit(1);
  }

  const sonarConfig = parseSonarProperties(fs.readFileSync(propsPath, 'utf8'));
  const lcovSourceFiles = parseLcovSourceFiles(fs.readFileSync(lcovPath, 'utf8'));

  const execGit = (args) => execFileSync('git', args, { cwd: repoRoot, stdio: ['ignore', 'pipe', 'ignore'] }).toString();

  const baseRef = resolveBaseRef({ env: process.env, execGit });
  if (!baseRef) {
    console.log('::notice::NEW_SOURCE_COVERAGE_GATE_SKIP: no comparable base ref found; nothing to check');
    return;
  }

  const headRef = process.env.SONAR_GUARD_HEAD_REF || 'HEAD';
  const diffOutput = execGit(['diff', '--name-only', '--diff-filter=A', `${baseRef}...${headRef}`]);
  const addedFiles = diffOutput.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);

  const { checked, errors } = findNewSourceCoverageGaps({ addedFiles, sonarConfig, lcovSourceFiles });

  if (errors.length > 0) {
    console.error('NEW_SOURCE_COVERAGE_GATE_FAIL: new production file(s) are hidden from Sonar coverage:');
    for (const error of errors) {
      console.error(`  ${error.file}: ${error.detail}`);
    }
    process.exit(1);
  }

  console.log(`NEW_SOURCE_COVERAGE_GATE_PASS files=${checked.length}`);
}

const isMainModule = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMainModule) {
  main();
}
