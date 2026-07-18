/**
 * Extracts every href defined in the sidebar at test-time so the smoke test
 * doesn't drift when routes are added or removed.
 *
 * Reads src/components/layout/sidebar.tsx as text and pulls every
 *   href: '/some/path'
 * value out with a simple regex — no full parse needed.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..');
const SIDEBAR = join(ROOT, 'src', 'components', 'layout', 'sidebar.tsx');

/** Routes only accessible to org-admin / super-admin — tested in auth-roles.spec.ts */
const ADMIN_PREFIXES = ['/org-admin', '/super-admin'];

function isAdminRoute(path: string): boolean {
  return ADMIN_PREFIXES.some(p => path.startsWith(p));
}

export function extractSidebarRoutes(): string[] {
  const src = readFileSync(SIDEBAR, 'utf8');
  const routes = new Set<string>();

  // Matches: href: '/...'  or  href: "/..."
  for (const m of src.matchAll(/href:\s*['"]([^'"]+)['"]/g)) {
    const route = m[1];
    if (!isAdminRoute(route)) routes.add(route);
  }

  return [...routes].sort();
}

export function extractAdminSidebarRoutes(): string[] {
  const src = readFileSync(SIDEBAR, 'utf8');
  const routes = new Set<string>();
  for (const m of src.matchAll(/href:\s*['"]([^'"]+)['"]/g)) {
    const route = m[1];
    if (isAdminRoute(route)) routes.add(route);
  }
  return [...routes].sort();
}
