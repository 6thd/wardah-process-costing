#!/usr/bin/env node

// Generic guard: every production source file *added* in this diff, that is
// actually eligible for LCOV coverage in the first place, must reach
// SonarCloud's coverage measurement — either it shows up as an `SF:` entry
// in coverage/lcov.info, or it is excluded only by a glob this very diff
// introduced (a deliberate, reviewed decision, not a stale wildcard).
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
// Two review findings on the first version of this gate, both fixed here:
// - it must only apply to files the coverage runner can actually instrument
//   (vitest.config.ts only emits LCOV for src/**/*.{ts,tsx,js,jsx}) — a new
//   SQL migration or a non-code asset under src/ can never appear in
//   coverage/lcov.info and must not be treated as a gap; see
//   isLcovInstrumentedFile()/isCoverageEligible() below.
// - it must not reject a coverage-exclusions entry the *same diff* adds on
//   purpose (e.g. a newly extracted coordinator file paired with its own
//   narrow, reviewed exclusion) — only a glob that already existed on the
//   base branch counts as "stale"; see getNewlyAddedCoverageExclusions()/
//   the newlyAddedCoverageExclusionGlobs parameter below.

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

// Pure, no I/O: collapses runs of consecutive `**` segments (`**/**/`,
// `**/**`, `****`, ...) into a single `**` before translation. Two adjacent
// unbounded-star groups in a compiled regex is the classic catastrophic-
// backtracking (ReDoS) shape; well-formed glob lists never need more than
// one `**` in a row, so collapsing them removes that shape without changing
// what the glob matches.
export function normalizeGlob(glob) {
  let previous;
  let normalized = glob;
  do {
    previous = normalized;
    normalized = normalized.replace(/\*\*\/\*\*/g, '**').replace(/\*{3,}/g, '**');
  } while (normalized !== previous);
  return normalized;
}

// Pure, no I/O: Ant-style glob (`**`, `*`, `?`) to an anchored RegExp,
// matching the same semantics SonarCloud/sonar-scanner uses for
// sonar.exclusions / sonar.coverage.exclusions. Both inputs this gate ever
// compiles are trusted, repo-internal, bounded-size strings — glob patterns
// come from sonar-project.properties in this same repo, never from PR/user
// content — so the modest backtracking headroom left by `.*`/`[^/]*` is not
// an externally reachable attack surface; normalizeGlob() above and the
// length cap in matchesAnyGlob() below are defense-in-depth on top of that.
export function globToRegExp(glob) {
  const source = normalizeGlob(glob);
  let pattern = '';
  let i = 0;

  while (i < source.length) {
    const char = source[i];

    if (char === '*' && source[i + 1] === '*') {
      if (source[i + 2] === '/') {
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

const MAX_MATCHABLE_PATH_LENGTH = 4096;

// Pure, no I/O. Bounds worst-case regex evaluation cost independently of
// pattern shape: no path in this repo's working tree is remotely close to
// this length, so the cap never rejects a real file.
export function matchesAnyGlob(filePath, globs) {
  if (filePath.length > MAX_MATCHABLE_PATH_LENGTH) return false;
  return globs.some((glob) => globToRegExp(glob).test(filePath));
}

// Pure, no I/O: is `filePath` in scope for Sonar analysis at all — under
// sonar.sources and not already dropped by the general sonar.exclusions list
// (node_modules, dist, test files, archives, ...)? This intentionally does
// NOT decide coverage-eligibility on its own (sonar.sources includes `sql`,
// which Sonar analyzes for bugs/security but which vitest never instruments)
// — see isCoverageEligible() below for the narrower check this gate actually
// applies.
export function isProductionSourceFile(filePath, sonarConfig) {
  const underSources = sonarConfig.sources.some(
    (src) => filePath === src || filePath.startsWith(`${src}/`),
  );
  if (!underSources) return false;
  return !matchesAnyGlob(filePath, sonarConfig.exclusions);
}

// The coverage runner's own scope (vitest.config.ts: `coverage.include:
// ['src/**/*.{ts,tsx,js,jsx}']`). A file outside this set can never produce
// an `SF:` entry no matter how well it's tested, so the gate must not judge
// it against coverage/lcov.info at all.
const LCOV_INSTRUMENTED_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx']);

// Pure, no I/O.
export function isLcovInstrumentedFile(filePath) {
  if (!filePath.startsWith('src/')) return false;
  if (filePath.endsWith('.d.ts')) return false;
  return LCOV_INSTRUMENTED_EXTENSIONS.has(path.extname(filePath));
}

// Pure, no I/O: the actual population this gate evaluates — a Sonar-scoped
// production file that the coverage runner can also actually instrument.
export function isCoverageEligible(filePath, sonarConfig) {
  return isProductionSourceFile(filePath, sonarConfig) && isLcovInstrumentedFile(filePath);
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

// Pure, no I/O: the actual gate. For every added, coverage-eligible file,
// fail it if a *pre-existing* sonar.coverage.exclusions glob hides it from
// Sonar, or if it never made it into the coverage report in the first
// place. A glob this same diff introduces (newlyAddedCoverageExclusionGlobs)
// is a deliberate, reviewed decision and does not trip the gate.
export function findNewSourceCoverageGaps({
  addedFiles,
  sonarConfig,
  lcovSourceFiles,
  newlyAddedCoverageExclusionGlobs = new Set(),
}) {
  const checked = [];
  const errors = [];

  for (const file of addedFiles) {
    if (!isCoverageEligible(file, sonarConfig)) continue;
    checked.push(file);

    const matchedGlobs = sonarConfig.coverageExclusions.filter((glob) => matchesAnyGlob(file, [glob]));
    const staleGlobs = matchedGlobs.filter((glob) => !newlyAddedCoverageExclusionGlobs.has(glob));

    if (staleGlobs.length > 0) {
      errors.push({
        file,
        reason: 'excluded-by-coverage-glob',
        detail: `matched by pre-existing sonar.coverage.exclusions glob(s): ${staleGlobs.join(', ')} — narrow or remove them so this new file is measured`,
      });
      continue;
    }

    if (matchedGlobs.length > 0) {
      // Excluded solely by a glob this diff itself added — a deliberate,
      // reviewed decision (e.g. a new coordinator shell paired with its own
      // narrow exclusion). Sonar won't measure it either way, so don't also
      // demand an lcov entry for it.
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

// Guards every ref string before it reaches a `git` subprocess argument.
// execFileSync (used throughout this file) passes arguments directly to the
// `git` binary, never through a shell, so classic shell metacharacter
// injection isn't possible here — but a value starting with `-` is still a
// real argument-injection vector: git itself would parse it as an option
// (e.g. `--upload-pack=...`) rather than a revision. Rejecting a leading
// `-`, plus restricting to the character set real ref names, SHAs, and
// revision expressions (`HEAD^`, `HEAD~1`, `HEAD^{commit}`) actually use, is
// the concrete fix; the length cap is defense-in-depth.
const UNSAFE_LEADING_DASH = /^-/;
const SAFE_REF_CHARS = /^[A-Za-z0-9._/^~{}-]+$/;

// Pure, no I/O.
export function isSafeGitRef(ref) {
  if (typeof ref !== 'string' || ref.length === 0 || ref.length > 200) return false;
  if (UNSAFE_LEADING_DASH.test(ref)) return false;
  return SAFE_REF_CHARS.test(ref);
}

// Resolves the ref to diff against, trying (in order): an explicit override,
// the PR base branch, the pre-push SHA, and finally the previous commit —
// each candidate is checked with isSafeGitRef() before ever reaching `git`,
// then verified to actually resolve, so neither an unsafe nor an
// unreachable ref is used.
export function resolveBaseRef({ env, execGit }) {
  const candidates = [];
  if (isSafeGitRef(env.SONAR_GUARD_BASE_REF)) candidates.push(env.SONAR_GUARD_BASE_REF);
  if (isSafeGitRef(env.GITHUB_BASE_REF)) candidates.push(`origin/${env.GITHUB_BASE_REF}`);
  if (env.GITHUB_EVENT_BEFORE && !isZeroSha(env.GITHUB_EVENT_BEFORE) && isSafeGitRef(env.GITHUB_EVENT_BEFORE)) {
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

// I/O: diffs `sonar-project.properties` at baseRef against the working copy
// to find coverage-exclusion globs this diff itself introduced. Fails safe
// (returns an empty set, i.e. "treat every match as stale") if the base
// revision's file can't be read for any reason.
function getNewlyAddedCoverageExclusions({ execGit, baseRef, currentConfig }) {
  try {
    const baseText = execGit(['show', `${baseRef}:sonar-project.properties`]);
    const baseCoverageExclusions = new Set(parseSonarProperties(baseText).coverageExclusions);
    return new Set(currentConfig.coverageExclusions.filter((glob) => !baseCoverageExclusions.has(glob)));
  } catch {
    return new Set();
  }
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

  const headRefCandidate = process.env.SONAR_GUARD_HEAD_REF;
  const headRef = isSafeGitRef(headRefCandidate) ? headRefCandidate : 'HEAD';

  const diffOutput = execGit(['diff', '--name-only', '--diff-filter=A', `${baseRef}...${headRef}`]);
  const addedFiles = diffOutput.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);

  const newlyAddedCoverageExclusionGlobs = getNewlyAddedCoverageExclusions({ execGit, baseRef, currentConfig: sonarConfig });

  const { checked, errors } = findNewSourceCoverageGaps({
    addedFiles,
    sonarConfig,
    lcovSourceFiles,
    newlyAddedCoverageExclusionGlobs,
  });

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
