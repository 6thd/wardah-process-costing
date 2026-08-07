/**
 * Minimal static file server for e2e tests that reproduces the response
 * headers vercel.json actually configures for the isolated
 * /reports-insights/* route vs. the rest of the app — the Vite dev server
 * used for the rest of the e2e suite does not send production headers at
 * all, so a test asserting on CSP/X-Frame-Options against it would prove
 * nothing.
 *
 * This intentionally does NOT reimplement Vercel's full path-to-regexp
 * router. It reads the actual header *values* out of vercel.json (so a
 * value edited there is what the test sees — no hand-copied duplicate to
 * drift out of sync), but decides which header block applies with a
 * simple prefix check equivalent to vercel.json's two mutually-exclusive
 * source patterns (`/reports-insights/(.*)` vs.
 * `/((?!reports-insights/).*)`).
 */
import { createServer, type Server } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../..');
const PUBLIC_DIR = path.join(REPO_ROOT, 'public');

interface VercelHeaderRule {
  source: string;
  headers: { key: string; value: string }[];
}

async function loadHeaderRules(): Promise<VercelHeaderRule[]> {
  const raw = await readFile(path.join(REPO_ROOT, 'vercel.json'), 'utf8');
  const config = JSON.parse(raw) as { headers?: VercelHeaderRule[] };
  return config.headers ?? [];
}

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.woff2': 'font/woff2',
  '.json': 'application/json; charset=utf-8',
};

export async function startLocalVercelHeadersServer(port: number): Promise<Server> {
  const rules = await loadHeaderRules();
  const isolatedRule = rules.find((r) => r.source === '/reports-insights/(.*)');
  const generalRule = rules.find((r) => r.source === '/((?!reports-insights/).*)');
  if (!isolatedRule || !generalRule) {
    throw new Error('local-vercel-headers-server: vercel.json header rules changed shape — update this test helper');
  }

  const server = createServer(async (req, res) => {
    const urlPath = (req.url ?? '/').split('?')[0];
    const isIsolated = urlPath.startsWith('/reports-insights/');
    const rule = isIsolated ? isolatedRule : generalRule;
    for (const h of rule.headers) {
      res.setHeader(h.key, h.value);
    }

    const filePath = path.join(PUBLIC_DIR, decodeURIComponent(urlPath));
    if (!filePath.startsWith(PUBLIC_DIR) || !existsSync(filePath)) {
      res.statusCode = 404;
      res.end('Not found');
      return;
    }
    const ext = path.extname(filePath);
    res.setHeader('Content-Type', CONTENT_TYPES[ext] ?? 'application/octet-stream');
    const body = await readFile(filePath);
    res.statusCode = 200;
    res.end(body);
  });

  await new Promise<void>((resolve) => server.listen(port, resolve));
  return server;
}
