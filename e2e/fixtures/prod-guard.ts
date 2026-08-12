/**
 * Safety rails for suites that may be pointed at a live environment.
 *
 * Extracted from the spec so the rails themselves are unit-testable. A guard
 * that has never been executed is not a guard — these are the parts where a
 * mistake writes to real data, so they are asserted directly rather than only
 * exercised in passing by a browser run.
 *
 * Two independent checks, not one: PLAYWRIGHT_BASE_URL (assertRunAllowed)
 * only says which FRONTEND is under test, and VITE_SUPABASE_URL — baked into
 * that frontend's build — is what actually decides which DATABASE it talks
 * to. A preview deployment (Vercel/Netlify) can be built against the live
 * Supabase project while its own host is obviously not production; trusting
 * the frontend host alone would fail OPEN in exactly that case; the run
 * "looks" safe and still creates a real role and assignment in production.
 * assertBackendAllowed closes that gap by checking the backend the page
 * actually talked to, observed from its own network requests rather than
 * trusted from any env var or URL guess.
 */

import type { Page } from '@playwright/test';

/**
 * The host that counts as production.
 *
 * Overridable via E2E_PROD_HOST because getting this wrong fails OPEN: an
 * unrecognised production URL would be treated as non-production and skip the
 * opt-in requirement entirely. Confirm this value against the real deployment
 * before running anywhere near live data.
 */
export const PROD_HOST = process.env.E2E_PROD_HOST ?? 'wardah-process-costing.vercel.app';

/**
 * The Supabase project host that counts as production.
 *
 * Overridable via E2E_PROD_SUPABASE_HOST for the same reason PROD_HOST is:
 * getting this wrong fails OPEN. This is the `uutfztmqvajmsxnrqeiv` project
 * referenced throughout this repository's migration docs — confirm it
 * against the real project before running anywhere near live data.
 */
export const PROD_SUPABASE_HOST =
  process.env.E2E_PROD_SUPABASE_HOST ?? 'uutfztmqvajmsxnrqeiv.supabase.co';

/** Everything this suite creates carries this prefix, so it is always identifiable. */
export const TEST_PREFIX = 'ZZ_E2E174';

export class ProdGuardError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProdGuardError';
  }
}

export function normalizeHost(baseURL: string): string {
  try {
    return new URL(baseURL).host.toLowerCase();
  } catch {
    throw new ProdGuardError(`PLAYWRIGHT_BASE_URL is not a valid URL: ${baseURL}`);
  }
}

export function isProductionHost(baseURL: string, prodHost: string = PROD_HOST): boolean {
  return normalizeHost(baseURL) === prodHost.toLowerCase();
}

/**
 * Fail closed unless the operator has explicitly opted in to running against
 * production, AND the host is exactly the one they opted in for.
 *
 * Two separate conditions on purpose: an opt-in flag left set in a shell would
 * otherwise silently authorize a run against any host that happened to be
 * configured later, and a host check alone would let a stray production URL
 * through with no deliberate act behind it.
 */
export function assertRunAllowed(params: {
  baseURL: string | undefined;
  allowProdEnv: string | undefined;
  prodHost?: string;
}): { targetsProduction: boolean; host: string } {
  const { baseURL, allowProdEnv, prodHost = PROD_HOST } = params;

  if (!baseURL) {
    throw new ProdGuardError('PLAYWRIGHT_BASE_URL is required.');
  }

  const host = normalizeHost(baseURL);
  const targetsProduction = isProductionHost(baseURL, prodHost);
  const optedIn = allowProdEnv === 'true';

  if (targetsProduction && !optedIn) {
    throw new ProdGuardError(
      `Refusing to run against production host "${host}" without ALLOW_PROD_E2E=true. ` +
        'This suite creates, edits, assigns and deletes real rows.'
    );
  }

  if (optedIn && !targetsProduction) {
    throw new ProdGuardError(
      `ALLOW_PROD_E2E=true was set but PLAYWRIGHT_BASE_URL points at "${host}", not ` +
        `"${prodHost.toLowerCase()}". Refusing: the opt-in must name the host it authorizes.`
    );
  }

  return { targetsProduction, host };
}

export function isProductionSupabaseHost(
  host: string,
  prodSupabaseHost: string = PROD_SUPABASE_HOST
): boolean {
  return host.toLowerCase() === prodSupabaseHost.toLowerCase();
}

function isSupabaseApiRequestUrl(url: string): boolean {
  return url.includes('/auth/v1/') || url.includes('/rest/v1/');
}

/**
 * Observes the backend a page actually talks to, from its own network
 * requests — not from PLAYWRIGHT_BASE_URL, and not from a client-baked env
 * var this test process cannot read from a build it did not produce.
 *
 * Records only the FIRST auth/v1 or rest/v1 request's host. A login always
 * sends one (the token exchange), so calling this before loginAs() and
 * reading it back afterward is enough to know the backend before any write
 * this suite performs.
 */
export function watchBackendHost(page: Page): { get(): string | undefined } {
  let host: string | undefined;
  page.on('request', req => {
    if (host) return;
    const url = req.url();
    if (!isSupabaseApiRequestUrl(url)) return;
    try {
      host = new URL(url).host.toLowerCase();
    } catch {
      // A malformed URL here is a network anomaly, not a real answer — leave
      // host unset so assertBackendAllowed's "never observed a backend"
      // guard fires instead of silently trusting a bad parse.
    }
  });
  return { get: () => host };
}

/**
 * Fail closed on the backend a run ACTUALLY talked to — independent of
 * assertRunAllowed's frontend-host check, and required in addition to it.
 * See the module doc comment for why the two cannot substitute for each
 * other: a preview frontend can be wired to the live Supabase project.
 *
 * An optional expectedSupabaseHost pins the run to one specific backend
 * (typically a staging project or an isolated branch). A mismatch is refused
 * even when neither host is production — an unexpected backend was not
 * authorized for this run either way, and silently proceeding against
 * whatever the frontend happened to be built against defeats the point of
 * pinning one.
 */
export function assertBackendAllowed(params: {
  backendHost: string | undefined;
  allowProdEnv: string | undefined;
  prodSupabaseHost?: string;
  expectedSupabaseHost?: string;
}): { targetsProduction: boolean; host: string } {
  const {
    backendHost,
    allowProdEnv,
    prodSupabaseHost = PROD_SUPABASE_HOST,
    expectedSupabaseHost,
  } = params;

  if (!backendHost) {
    throw new ProdGuardError(
      'Could not observe a Supabase request (auth/v1 or rest/v1) before the first write. ' +
        'Refusing to proceed without knowing which backend this run actually targets.'
    );
  }

  const host = backendHost.toLowerCase();
  const targetsProduction = isProductionSupabaseHost(host, prodSupabaseHost);
  const optedIn = allowProdEnv === 'true';

  if (targetsProduction && !optedIn) {
    throw new ProdGuardError(
      `Refusing to run against the production Supabase backend "${host}" without ` +
        'ALLOW_PROD_E2E=true. The frontend host alone is not a reliable signal: a preview ' +
        'deployment can still be wired to the live database.'
    );
  }

  if (expectedSupabaseHost && host !== expectedSupabaseHost.toLowerCase()) {
    throw new ProdGuardError(
      `Backend Supabase host "${host}" does not match the expected host ` +
        `"${expectedSupabaseHost.toLowerCase()}". Refusing: an unexpected backend, production ` +
        'or not, was not authorized for this run.'
    );
  }

  return { targetsProduction, host };
}

/** A unique, greppable name for one run's fixtures. */
export function makeTestRoleName(now: number = Date.now()): string {
  return `${TEST_PREFIX}_${now}`;
}

export function isOwnedByThisSuite(name: string, prefix: string = TEST_PREFIX): boolean {
  return typeof name === 'string' && name.startsWith(prefix);
}

/**
 * Tracks only what this run created, and refuses to hand back anything it did
 * not create. Cleanup consults this — never a page listing — so a fixture that
 * was never created here can never be selected for deletion.
 */
export class FixtureOwnership {
  private readonly created = new Set<string>();
  private readonly assignments = new Set<string>();

  claimRole(name: string): void {
    if (!isOwnedByThisSuite(name)) {
      throw new ProdGuardError(
        `Refusing to track "${name}": it does not carry the ${TEST_PREFIX} prefix, ` +
          'so it was not created by this suite.'
      );
    }
    this.created.add(name);
  }

  claimAssignment(userEmail: string, roleName: string): void {
    if (!this.created.has(roleName)) {
      throw new ProdGuardError(
        `Refusing to track an assignment of "${roleName}": this suite did not create that role.`
      );
    }
    this.assignments.add(`${userEmail}::${roleName}`);
  }

  assertDeletable(name: string): void {
    if (!this.created.has(name)) {
      throw new ProdGuardError(
        `Refusing to delete "${name}": not created by this run. Pre-existing roles, ` +
          'assignments, users and vouchers are strictly out of scope.'
      );
    }
  }

  ownedRoles(): string[] {
    return [...this.created];
  }

  ownedAssignments(): string[] {
    return [...this.assignments];
  }
}
