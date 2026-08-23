#!/usr/bin/env node

import { promises as fs } from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';

const ROOT = process.cwd();
const inventoryPath = process.argv[2] || 'artifacts/security/rbac-mutation-candidates.json';
const baselinePath = process.argv[3] || 'scripts/ci/security/rbac-mutation-baseline.json';

const inventory = JSON.parse(await fs.readFile(path.resolve(ROOT, inventoryPath), 'utf8'));
const baseline = JSON.parse(await fs.readFile(path.resolve(ROOT, baselinePath), 'utf8'));

const counts = new Map();
for (const item of inventory.candidates || []) {
  const key = [item.file, item.kind, item.operation, item.target].join('|');
  counts.set(key, (counts.get(key) || 0) + 1);
}

const lines = [...counts.entries()]
  .sort(([a], [b]) => a.localeCompare(b))
  .map(([key, count]) => `${key}|${count}`);
const payload = `${lines.join('\n')}\n`;
const digest = crypto.createHash('sha256').update(payload).digest('hex');

const actual = {
  candidate_count: inventory.candidate_count,
  signature_count: counts.size,
  signature_sha256: digest,
};

const mismatches = Object.entries(actual).filter(([key, value]) => baseline[key] !== value);

console.log(`RBAC mutation baseline: candidates=${actual.candidate_count}, signatures=${actual.signature_count}`);
console.log(`RBAC mutation signature SHA-256: ${actual.signature_sha256}`);

if (mismatches.length > 0) {
  console.error('RBAC mutation inventory drift detected.');
  for (const [key, value] of mismatches) {
    console.error(`  ${key}: expected ${baseline[key]}, got ${value}`);
  }
  console.error('Review the generated artifact before updating the pinned baseline.');
  process.exit(1);
}

console.log('RBAC_MUTATION_BASELINE_PASS');
