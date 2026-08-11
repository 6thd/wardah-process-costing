#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import ts from 'typescript';

const RBAC_TABLES = new Set(['roles', 'role_permissions', 'user_roles']);
const WRITE_METHODS = new Set(['insert', 'update', 'upsert', 'delete']);

function propertyName(expression) {
  if (ts.isPropertyAccessExpression(expression)) return expression.name.text;
  if (
    ts.isElementAccessExpression(expression)
    && expression.argumentExpression
    && ts.isStringLiteralLike(expression.argumentExpression)
  ) {
    return expression.argumentExpression.text;
  }
  return null;
}

function tableFromExpression(expression, aliases) {
  if (!expression) return null;
  if (ts.isIdentifier(expression)) return aliases.get(expression.text) ?? null;
  if (
    ts.isParenthesizedExpression(expression)
    || ts.isAwaitExpression(expression)
    || ts.isAsExpression(expression)
    || ts.isTypeAssertionExpression(expression)
    || ts.isNonNullExpression(expression)
  ) {
    return tableFromExpression(expression.expression, aliases);
  }
  if (ts.isPropertyAccessExpression(expression) || ts.isElementAccessExpression(expression)) {
    return tableFromExpression(expression.expression, aliases);
  }
  if (!ts.isCallExpression(expression)) return null;

  const calledName = propertyName(expression.expression);
  if (calledName === 'from') {
    const tableArg = expression.arguments[0];
    if (tableArg && ts.isStringLiteralLike(tableArg) && RBAC_TABLES.has(tableArg.text)) {
      return tableArg.text;
    }
  }
  return tableFromExpression(expression.expression, aliases);
}

function scanSource(sourceText, fileName) {
  const source = ts.createSourceFile(
    fileName,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    fileName.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  );
  const aliases = new Map();
  const violations = [];

  function visit(node) {
    if (
      ts.isVariableDeclaration(node)
      && ts.isIdentifier(node.name)
      && node.initializer
    ) {
      const table = tableFromExpression(node.initializer, aliases);
      if (table) aliases.set(node.name.text, table);
    }

    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
      if (ts.isIdentifier(node.left)) {
        const table = tableFromExpression(node.right, aliases);
        if (table) aliases.set(node.left.text, table);
      }
    }

    if (ts.isCallExpression(node)) {
      const method = propertyName(node.expression);
      if (method && WRITE_METHODS.has(method)) {
        const receiver = node.expression.expression;
        const table = tableFromExpression(receiver, aliases);
        if (table) {
          const location = source.getLineAndCharacterOfPosition(node.getStart(source));
          violations.push({
            file: fileName,
            line: location.line + 1,
            column: location.character + 1,
            table,
            method,
          });
        }
      }
    }
    ts.forEachChild(node, visit);
  }

  visit(source);
  return violations;
}

function runSelfTest() {
  const unsafe = scanSource(`
    client.from('roles').insert({ name: 'x' });
    client.from("role_permissions").delete().eq('role_id', 'r1');
    const assignments = client.from('user_roles');
    assignments.upsert([{ user_id: 'u1' }]);
    let roleQuery;
    roleQuery = client.from('roles').select('*');
    roleQuery.update({ name: 'changed' });
  `, 'self-test-unsafe.ts');
  if (unsafe.length !== 4) {
    throw new Error(`RBAC write gate self-test missed an unsafe path: ${JSON.stringify(unsafe)}`);
  }

  const safe = scanSource(`
    client.from('roles').select('*');
    client.from('role_permissions').select('role_id');
    client.from('user_roles').select('*');
    client.rpc('rpc_replace_user_roles', { p_payload: {} });
    client.rpc('rpc_remove_org_member', { p_payload: {} });
  `, 'self-test-safe.ts');
  if (safe.length !== 0) {
    throw new Error(`RBAC write gate rejected a safe read/RPC path: ${JSON.stringify(safe)}`);
  }
}

function sourceFiles(root) {
  const files = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const fullPath = path.join(root, entry.name);
    if (entry.isDirectory()) files.push(...sourceFiles(fullPath));
    else if (entry.isFile() && /\.tsx?$/.test(entry.name)) files.push(fullPath);
  }
  return files;
}

runSelfTest();

const root = path.resolve(process.cwd(), 'src');
const files = sourceFiles(root);
const violations = files.flatMap(file =>
  scanSource(fs.readFileSync(file, 'utf8'), path.relative(process.cwd(), file))
);

if (violations.length > 0) {
  console.error('RBAC_DIRECT_WRITE_GATE_FAIL: use the audited RBAC RPC surface:');
  for (const violation of violations) {
    console.error(
      `  ${violation.file}:${violation.line}:${violation.column}`
      + ` direct ${violation.method.toUpperCase()} on ${violation.table}`
    );
  }
  process.exit(1);
}

console.log(`RBAC_DIRECT_WRITE_GATE_PASS files=${files.length}`);
