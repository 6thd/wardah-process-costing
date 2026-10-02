// Exact frozen inputs and deterministic source union; no target connections.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

const CLIENT = '0e462611e49f50d30f888323837d351b03f3acab';
const QUALITY = '1781c981468b615777bf6672e80ce3498ca1ff1d';
const REPAIR = 'e29b4e5aa96556165f97b278f55591dc61c8044e';
const MAIN = '3acea30d83e182a2651b60b8696a658137bc0c92';
const conflicts = [
  'scripts/ci/security/rbac-mutation-baseline.json',
  'src/features/manufacturing/index.tsx',
  'src/locales/ar/translation.json',
  'src/locales/en/translation.json',
];
function git(args, allowConflict = false) {
  try { return execFileSync('/usr/bin/git', ['-c', 'core.fsmonitor=false', ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 4 * 1024 * 1024 }); }
  catch (error) {
    if (allowConflict && error.status === 1) return error.stdout;
    throw error;
  }
}
const expectedTrees = {
  [CLIENT]: 'd73fc628ce9ac1addd3cb844bac51c4f4dd747c2',
  [QUALITY]: '71b1c51567b3184e5a2e3aeba42091ef8eb48a1a',
  [REPAIR]: '67f7ec6e3da1fba3f8aaef28641a23e408733335',
  [MAIN]: '60f5aecb7275660ef8741c3fa18d9f2be48b6b1d',
};
for (const [head, tree] of Object.entries(expectedTrees)) assert.equal(git(['rev-parse', `${head}^{tree}`]).trim(), tree);
const merge = git(['merge-tree', '--write-tree', CLIENT, QUALITY], true);
const tree = merge.split('\n')[0];
assert.match(tree, /^[a-f0-9]{40}$/);
const foundConflicts = [...merge.matchAll(/CONFLICT \(content\): Merge conflict in (.+)/g)].map(x => x[1]).sort();
assert.deepEqual(foundConflicts, [...conflicts].sort());
const sourcePaths = git(['ls-tree', '-r', '--name-only', tree, '--', 'src']).trim().split('\n');
const actualPaths = [...new Set(git(['ls-files', 'src']).trim().split('\n'))];
assert.deepEqual(actualPaths.sort(), [...sourcePaths].sort());
for (const path of sourcePaths) {
  if (conflicts.includes(path)) continue;
  if (path === 'src/features/settings/__tests__/SettingsOverview.test.tsx') {
    const before = git(['show', `${tree}:${path}`]);
    const decorativeMock = "// Decorative SVGs are outside this route/permission/localization contract.\n// Keep every heading, link and visibility assertion; avoid cold jsdom SVG style work.\nvi.mock('lucide-react', () => ({\n  Settings: () => null, Building: () => null, Users: () => null,\n  Shield: () => null, Cog: () => null, Database: () => null, ClipboardCheck: () => null,\n}))\n\n";
    const after = before.replace("vi.mock('@/components/ui/page-header'", decorativeMock + "vi.mock('@/components/ui/page-header'");
    assert.notEqual(before, after);
    assert.equal(fs.readFileSync('src/features/settings/__tests__/SettingsOverview.test.tsx', 'utf8'), after, 'settings fixture drift');
    continue;
  }
  if (path === 'src/hooks/manufacturing/useQuality.ts') {
    // Only three explicit promise-handling repairs to the frozen hook are allowed.
    const before = git(['show', `${tree}:${path}`]);
    const after = before.replace(
      "      queryClient.invalidateQueries({ queryKey: [...qualityKeys.all, 'mo-status'] })",
      "      return queryClient.invalidateQueries({ queryKey: [...qualityKeys.all, 'mo-status'] })",
    ).replace(
      "  return () => {\n    queryClient.invalidateQueries({ queryKey: qualityKeys.all })\n    queryClient.invalidateQueries({ queryKey: ['manufacturing-quality-queue'] })\n  }",
      "  return () => Promise.all([\n    queryClient.invalidateQueries({ queryKey: qualityKeys.all }),\n    queryClient.invalidateQueries({ queryKey: ['manufacturing-quality-queue'] }),\n  ])",
    );
    assert.notEqual(after, before);
    assert.equal(fs.readFileSync('src/hooks/manufacturing/useQuality.ts', 'utf8'), after, `quality promise repair drift: ${path}`);
    continue;
  }
  assert.equal(git(['hash-object', '--no-filters', '--', path]).trim(), git(['rev-parse', `${tree}:${path}`]).trim(), `automatic source union drift: ${path}`);
}
const index = 'src/features/manufacturing/index.tsx';
const resolvedIndex = git(['show', `${tree}:${index}`]).split('\n')
  .filter(line => !/^(<<<<<<<|=======|>>>>>>>)/.test(line)).join('\n');
assert.equal(fs.readFileSync('src/features/manufacturing/index.tsx', 'utf8'), resolvedIndex.trimEnd() + '\n');
for (const language of ['ar', 'en']) {
  const path = `src/locales/${language}/translation.json`;
  const client = JSON.parse(git(['show', `${CLIENT}:${path}`]));
  const quality = JSON.parse(git(['show', `${QUALITY}:${path}`]));
  const actual = JSON.parse(language === 'ar'
    ? fs.readFileSync('src/locales/ar/translation.json', 'utf8')
    : fs.readFileSync('src/locales/en/translation.json', 'utf8'));
  assert.deepEqual(actual, { ...client, quality: quality.quality });
}
assert.equal(git(['diff', '--name-only', MAIN, '--', 'sql/baseline']).trim(), '');
for (const path of git(['ls-tree', '-r', '-z', '--name-only', MAIN, '--', 'sql']).split('\0').filter(Boolean)) {
  if (path === 'sql/migrations/MANIFEST.md') continue;
  assert.equal(git(['hash-object', '--', path]).trim(), git(['rev-parse', `${MAIN}:${path}`]).trim(), `existing SQL drift: ${path}`);
}
const migration = 'sql/migrations/199_manufacturing_quality_control.sql';
assert.equal(git(['hash-object', '--no-filters', '--', migration]).trim(), git(['rev-parse', `${REPAIR}:${migration}`]).trim());
for (const path of ['acceptance.sql', 'red.sql', 'concurrency.py']) {
  const full = `docs/db/quality-control-199/${path}`;
  assert.equal(git(['hash-object', '--no-filters', '--', full]).trim(), git(['rev-parse', `${QUALITY}:${full}`]).trim());
}
console.log(`QC_MATERIAL_SOURCE_UNION_PASS files=${sourcePaths.length} conflicts=4 canonical=unchanged M199=reviewed`);
