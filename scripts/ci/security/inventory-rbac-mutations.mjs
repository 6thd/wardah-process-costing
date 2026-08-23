#!/usr/bin/env node

import { promises as fs } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

const ROOT = process.cwd();
const SRC_ROOT = path.join(ROOT, 'src');
const outputArgIndex = process.argv.indexOf('--output');
const outputPath = outputArgIndex >= 0 ? process.argv[outputArgIndex + 1] : null;
const TABLE_MUTATIONS = new Set(['insert', 'update', 'upsert', 'delete']);

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

function stringArg(call, index = 0) {
  const arg = call.arguments[index];
  if (!arg) return null;
  if (ts.isStringLiteral(arg) || ts.isNoSubstitutionTemplateLiteral(arg)) {
    return arg.text;
  }
  return null;
}

function findFromTarget(node) {
  if (!node) return null;

  if (ts.isCallExpression(node)) {
    if (ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === 'from') {
      return stringArg(node);
    }
    return findFromTarget(node.expression);
  }

  if (ts.isPropertyAccessExpression(node)) {
    return findFromTarget(node.expression);
  }

  if (ts.isElementAccessExpression(node)) {
    return findFromTarget(node.expression);
  }

  if (ts.isParenthesizedExpression(node)) {
    return findFromTarget(node.expression);
  }

  return null;
}

function lineForNode(sourceFile, node) {
  return sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
}

function excerptForNode(sourceFile, node) {
  const text = sourceFile.text;
  const index = node.getStart(sourceFile);
  const start = Math.max(0, text.lastIndexOf('\n', index - 1) + 1);
  const firstEnd = text.indexOf('\n', index);
  const secondEnd = firstEnd < 0 ? -1 : text.indexOf('\n', firstEnd + 1);
  const end = secondEnd < 0 ? Math.min(text.length, index + 240) : secondEnd;
  return text.slice(start, end).trim().replace(/\s+/g, ' ').slice(0, 300);
}

function scanSource(sourceFile, relativePath) {
  const results = [];

  function visit(node) {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const property = node.expression.name.text;

      if (TABLE_MUTATIONS.has(property)) {
        const target = findFromTarget(node.expression.expression);
        if (target) {
          results.push({
            kind: 'direct_table_mutation',
            target,
            operation: property,
            file: relativePath,
            line: lineForNode(sourceFile, node),
            excerpt: excerptForNode(sourceFile, node),
          });
        }
      } else if (property === 'rpc') {
        const target = stringArg(node);
        if (target) {
          results.push({
            kind: 'rpc_call',
            target,
            operation: 'rpc',
            file: relativePath,
            line: lineForNode(sourceFile, node),
            excerpt: excerptForNode(sourceFile, node),
          });
        }
      } else if (
        property === 'invoke' &&
        ts.isPropertyAccessExpression(node.expression.expression) &&
        node.expression.expression.name.text === 'functions'
      ) {
        const target = stringArg(node);
        if (target) {
          results.push({
            kind: 'edge_function_call',
            target,
            operation: 'invoke',
            file: relativePath,
            line: lineForNode(sourceFile, node),
            excerpt: excerptForNode(sourceFile, node),
          });
        }
      }
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return results;
}

const files = await walk(SRC_ROOT);
const candidates = [];

for (const filePath of files) {
  const text = await fs.readFile(filePath, 'utf8');
  const relativePath = path.relative(ROOT, filePath).split(path.sep).join('/');
  const scriptKind = filePath.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const sourceFile = ts.createSourceFile(relativePath, text, ts.ScriptTarget.Latest, true, scriptKind);
  candidates.push(...scanSource(sourceFile, relativePath));
}

candidates.sort((a, b) =>
  a.file.localeCompare(b.file) || a.line - b.line || a.kind.localeCompare(b.kind)
);

const byKind = candidates.reduce((acc, item) => {
  acc[item.kind] = (acc[item.kind] || 0) + 1;
  return acc;
}, {});

const report = {
  schema_version: 2,
  scanner: 'typescript-ast',
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
