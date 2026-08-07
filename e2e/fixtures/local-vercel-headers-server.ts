/**
 * Minimal static file server for e2e tests that reproduces the response
 * headers vercel.json actually configures for the isolated
 * /reports-insights/* route vs. the rest of the app — the Vite dev server
 * used for the rest of the e2e suite does not send production headers at
 * all, so a test asserting on CSP/X-Frame-Options against it would prove
 * nothing.
 *
 * This intentionally does NOT reimplement Vercel's full path-to-regexp
 * router — each vercel.json rule's `source` is compiled to a real RegExp
 * here (they're already regex-shaped strings, e.g. `/reports-insights/(.*)`),
 * and every rule whose source matches the request path contributes its
 * headers, matching Vercel's own documented behavior for multiple
 * matching rules (e.g. their own `/service-worker.js` + `/(.*)` example).
 * Rule *values* always come straight from vercel.json, never a
 * hand-copied duplicate, so an edit there is what the test sees.
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
  if (rules.length === 0) {
    throw new Error('local-vercel-headers-server: vercel.json has no header rules — update this test helper');
  }
  const compiledRules = rules.map((r) => ({ ...r, regex: new RegExp(`^${r.source}$`) }));

  const server = createServer(async (req, res) => {
    const urlPath = (req.url ?? '/').split('?')[0];
    for (const rule of compiledRules) {
      if (!rule.regex.test(urlPath)) continue;
      for (const h of rule.headers) {
        res.setHeader(h.key, h.value);
      }
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
