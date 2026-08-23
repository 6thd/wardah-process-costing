#!/usr/bin/env node

import { promises as fs } from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const inventoryPath = process.argv[2] || 'artifacts/security/rbac-mutation-candidates.json';
const rulesPath = process.argv[3] || 'scripts/ci/security/rbac-mutation-classification-rules.json';
const outputPath = process.argv[4] || 'artifacts/security/rbac-mutation-matrix.json';
const reviewedRulesPath = 'scripts/ci/security/rbac-mutation-classification-reviewed.json';

const inventory = JSON.parse(await fs.readFile(path.resolve(ROOT, inventoryPath), 'utf8'));
const config = JSON.parse(await fs.readFile(path.resolve(ROOT, rulesPath), 'utf8'));

let reviewedConfig = { rules: [] };
try {
  reviewedConfig = JSON.parse(await fs.readFile(path.resolve(ROOT, reviewedRulesPath), 'utf8'));
} catch (error) {
  if (error?.code !== 'ENOENT') throw error;
}

const allRules = [...config.rules, ...(reviewedConfig.rules || [])];

function matches(rule, item) {
  if (rule.target && item.target !== rule.target) return false;
  if (rule.targets && !rule.targets.includes(item.target)) return false;
  if (rule.file_prefix && !item.file.startsWith(rule.file_prefix)) return false;
  if (rule.file_prefixes && !rule.file_prefixes.some(prefix => item.file.startsWith(prefix))) return false;
  if (rule.kind && item.kind !== rule.kind) return false;
  if (rule.operation && item.operation !== rule.operation) return false;
  return true;
}

function specificity(rule) {
  let score = Number(rule.priority || 0) * 1000;
  if (rule.target) score += 100;
  if (rule.targets) score += 90;
  if (rule.file_prefix) score += 40;
  if (rule.file_prefixes) score += 30;
  if (rule.kind) score += 10;
  if (rule.operation) score += 10;
  return score;
}

function selectMostSpecificRule(item) {
  let best = null;
  let bestScore = -1;

  for (const rule of allRules) {
    if (!matches(rule, item)) continue;
    const score = specificity(rule);
    if (score > bestScore) {
      best = rule;
      bestScore = score;
    }
  }

  return best;
}

const rows = (inventory.candidates || []).map((item) => {
  const matched = selectMostSpecificRule(item);
  const classification = matched || config.default;
  return {
    file: item.file,
    line: item.line,
    kind: item.kind,
    operation: item.operation,
    target: item.target,
    verdict: classification.verdict,
    tracking_issue: classification.issue,
    rule_id: matched?.id || 'default-pending',
    note: classification.note,
    excerpt: item.excerpt,
  };
});

const countsByVerdict = rows.reduce((acc, row) => {
  acc[row.verdict] = (acc[row.verdict] || 0) + 1;
  return acc;
}, {});
const countsByIssue = rows.reduce((acc, row) => {
  const key = String(row.tracking_issue);
  acc[key] = (acc[key] || 0) + 1;
  return acc;
}, {});

const report = {
  schema_version: 1,
  inventory_schema_version: inventory.schema_version,
  source_candidate_count: inventory.candidate_count,
  matrix_row_count: rows.length,
  counts_by_verdict: countsByVerdict,
  counts_by_tracking_issue: countsByIssue,
  rows,
};

if (report.matrix_row_count !== inventory.candidate_count) {
  throw new Error(`Matrix row mismatch: inventory=${inventory.candidate_count}, matrix=${report.matrix_row_count}`);
}

const absoluteOutput = path.resolve(ROOT, outputPath);
await fs.mkdir(path.dirname(absoluteOutput), { recursive: true });
await fs.writeFile(absoluteOutput, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

console.log(`RBAC mutation matrix written to ${path.relative(ROOT, absoluteOutput)}`);
console.log(`Matrix rows: ${report.matrix_row_count}`);
for (const [verdict, count] of Object.entries(countsByVerdict).sort()) {
  console.log(`  ${verdict}: ${count}`);
}
console.log('RBAC_MUTATION_MATRIX_COMPLETE');
