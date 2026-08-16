/**
 * Minimal static file server for e2e tests that reproduces vercel.json's
 * actual header AND rewrite behavior for the isolated /reports-insights/*
 * route vs. the rest of the app — the Vite dev server used for the rest of
 * the e2e suite does not send production headers or apply the SPA rewrite
 * at all, so a test asserting on either against it would prove nothing.
 *
 * This intentionally does NOT reimplement Vercel's full path-to-regexp
 * router — each vercel.json rule's `source` is compiled to a real RegExp
 * here (they're already regex-shaped strings, e.g. `/reports-insights/(.*)`),
 * and every rule whose source matches the request path contributes its
 * headers, matching Vercel's own documented behavior for multiple
 * matching rules (e.g. their own `/service-worker.js` + `/(.*)` example).
 * Rewrites are applied the same way Vercel's static hosting does: a
 * request first tries to resolve to a real file, and only falls through to
 * a matching rewrite's destination when no file exists — so a route
 * deliberately excluded from the SPA rewrite genuinely 404s here too,
 * instead of this fixture 404ing regardless of the rewrite config and
 * silently passing a rewrite regression either way. Rule *values* always
 * come straight from vercel.json, never a hand-copied duplicate, so an
 * edit there is what the test sees.
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

interface VercelRewriteRule {
  source: string;
  destination: string;
}

interface VercelConfig {
  headers?: VercelHeaderRule[];
  rewrites?: VercelRewriteRule[];
}

async function loadVercelConfig(): Promise<VercelConfig> {
  const raw = await readFile(path.join(REPO_ROOT, 'vercel.json'), 'utf8');
  return JSON.parse(raw) as VercelConfig;
}

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.woff2': 'font/woff2',
  '.json': 'application/json; charset=utf-8',
};

// A requested path can resolve against either public/ (static assets
// Vercel copies into the build output as-is) or the repo root (index.html
// lives there pre-build for a Vite project, not under public/) — checked
// in that order, matching where each actually lives in this repo.
function resolveExistingFile(urlPath: string): string | null {
  for (const base of [PUBLIC_DIR, REPO_ROOT]) {
    const filePath = path.join(base, decodeURIComponent(urlPath));
    if (filePath.startsWith(base) && existsSync(filePath)) return filePath;
  }
  return null;
}

export async function startLocalVercelHeadersServer(port: number): Promise<Server> {
  const config = await loadVercelConfig();
  const headerRules = config.headers ?? [];
  const rewriteRules = config.rewrites ?? [];
  if (headerRules.length === 0) {
    throw new Error('local-vercel-headers-server: vercel.json has no header rules — update this test helper');
  }
  const compiledHeaderRules = headerRules.map((r) => ({ ...r, regex: new RegExp(`^${r.source}$`) }));
  const compiledRewriteRules = rewriteRules.map((r) => ({ ...r, regex: new RegExp(`^${r.source}$`) }));

  const server = createServer(async (req, res) => {
    const urlPath = (req.url ?? '/').split('?')[0];
    for (const rule of compiledHeaderRules) {
      if (!rule.regex.test(urlPath)) continue;
      for (const h of rule.headers) {
        res.setHeader(h.key, h.value);
      }
    }

    let filePath = resolveExistingFile(urlPath);
    if (!filePath) {
      for (const rule of compiledRewriteRules) {
        if (!rule.regex.test(urlPath)) continue;
        filePath = resolveExistingFile(rule.destination);
        break;
      }
    }

    if (!filePath) {
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
