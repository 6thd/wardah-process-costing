#!/usr/bin/env node

import { promises as fs } from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const SRC_ROOT = path.join(ROOT, 'src');
const outputArgIndex = process.argv.indexOf('--output');
const outputPath = outputArgIndex >= 0 ? process.argv[outputArgIndex + 1] : null;

function isProductionSource(filePath) {
  const normalized = filePath.split(path.sep).join('/');
  return (
    /\.(ts|tsx)$/.test(normalized) &&
    !normalized.includes('/__tests__/') &&
    !normalized.includes('/test/') &&
    !normalized.includes('/tests/') &&
    !/\.(test|spec)\.(ts|tsx)$/.test(normalized) &&
    !normalized.includes('/mocks/') &&
    !normalized.includes('/__mocks__/')
  );
}

async function walk(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await walk(fullPath)));
    } else if (isProductionSource(fullPath)) {
      files.push(fullPath);
    }
  }
  return files;
}

function lineForIndex(text, index) {
  return text.slice(0, index).split('\n').length;
}

function excerpt(text, index) {
  const start = Math.max(0, text.lastIndexOf('\n', index - 1) + 1);
  const endLine1 = text.indexOf('\n', index);
  const endLine2 = endLine1 < 0 ? -1 : text.indexOf('\n', endLine1 + 1);
  const end = endLine2 < 0 ? Math.min(text.length, index + 240) : endLine2;
  return text.slice(start, end).trim().replace(/\s+/g, ' ').slice(0, 300);
}

function scanTableMutations(text, relativePath) {
  const results = [];
  const fromRegex = /\.from\(\s*['"`]([^'"`]+)['"`]\s*\)/g;
  let match;

  while ((match = fromRegex.exec(text)) !== null) {
    const afterStart = match.index + match[0].length;
    const semicolon = text.indexOf(';', afterStart);
    const hardEnd = Math.min(text.length, afterStart + 1600);
    const end = semicolon >= 0 && semicolon < hardEnd ? semicolon : hardEnd;
    const chain = text.slice(afterStart, end);
    const mutationMatch = chain.match(/\.(insert|update|upsert|delete)\s*\(/);
    if (!mutationMatch) continue;

    const operationIndex = afterStart + mutationMatch.index;
    results.push({
      kind: 'direct_table_mutation',
      target: match[1],
      operation: mutationMatch[1],
      file: relativePath,
      line: lineForIndex(text, operationIndex),
      excerpt: excerpt(text, match.index),
    });
  }

  return results;
}

function scanNamedCalls(text, relativePath, regex, kind, operation) {
  const results = [];
  let match;
  while ((match = regex.exec(text)) !== null) {
    results.push({
      kind,
      target: match[1],
      operation,
      file: relativePath,
      line: lineForIndex(text, match.index),
      excerpt: excerpt(text, match.index),
    });
  }
  return results;
}

const files = await walk(SRC_ROOT);
const candidates = [];

for (const filePath of files) {
  const text = await fs.readFile(filePath, 'utf8');
  const relativePath = path.relative(ROOT, filePath).split(path.sep).join('/');

  candidates.push(...scanTableMutations(text, relativePath));
  candidates.push(
    ...scanNamedCalls(
      text,
      relativePath,
      /\.rpc\(\s*['"`]([^'"`]+)['"`]/g,
      'rpc_call',
      'rpc'
    )
  );
  candidates.push(
    ...scanNamedCalls(
      text,
      relativePath,
      /\.functions\.invoke\(\s*['"`]([^'"`]+)['"`]/g,
      'edge_function_call',
      'invoke'
    )
  );
}

candidates.sort((a, b) =>
  a.file.localeCompare(b.file) || a.line - b.line || a.kind.localeCompare(b.kind)
);

const byKind = candidates.reduce((acc, item) => {
  acc[item.kind] = (acc[item.kind] || 0) + 1;
  return acc;
}, {});

const report = {
  schema_version: 1,
  generated_from: 'src/**/*.ts(x) production sources',
  generated_at: new Date().toISOString(),
  source_file_count: files.length,
  candidate_count: candidates.length,
  counts_by_kind: byKind,
  candidates,
};

const json = `${JSON.stringify(report, null, 2)}\n`;
if (outputPath) {
  const absoluteOutput = path.resolve(ROOT, outputPath);
  await fs.mkdir(path.dirname(absoluteOutput), { recursive: true });
  await fs.writeFile(absoluteOutput, json, 'utf8');
  console.log(`RBAC mutation inventory written to ${path.relative(ROOT, absoluteOutput)}`);
}

console.log(`Scanned ${files.length} production TS/TSX files.`);
console.log(`Found ${candidates.length} mutation/RPC candidates.`);
for (const [kind, count] of Object.entries(byKind).sort()) {
  console.log(`  ${kind}: ${count}`);
}

if (!outputPath) {
  process.stdout.write(json);
}
