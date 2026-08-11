/**
 * Safety rails for suites that may be pointed at a live environment.
 *
 * Extracted from the spec so the rails themselves are unit-testable. A guard
 * that has never been executed is not a guard — these are the parts where a
 * mistake writes to real data, so they are asserted directly rather than only
 * exercised in passing by a browser run.
 */

/**
 * The host that counts as production.
 *
 * Overridable via E2E_PROD_HOST because getting this wrong fails OPEN: an
 * unrecognised production URL would be treated as non-production and skip the
 * opt-in requirement entirely. Confirm this value against the real deployment
 * before running anywhere near live data.
 */
export const PROD_HOST = process.env.E2E_PROD_HOST ?? 'wardah-process-costing.vercel.app';

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
