// src/services/__tests__/e2e-prod-guard.test.ts
//
// The E2E safety rails, asserted directly.
//
// These guards are the only thing standing between a mistyped env var and
// writes against a live environment, so they are tested rather than trusted.
// They live under src/ so the normal vitest run picks them up — Playwright
// specs are not part of that run, but their guards should be.

import { describe, it, expect } from 'vitest';
import type { Page } from '@playwright/test';
import {
  assertRunAllowed,
  assertBackendAllowed,
  watchBackendHost,
  isProductionHost,
  isProductionSupabaseHost,
  makeTestRoleName,
  isOwnedByThisSuite,
  FixtureOwnership,
  ProdGuardError,
  PROD_HOST,
  PROD_SUPABASE_HOST,
  TEST_PREFIX,
} from '../../../e2e/fixtures/prod-guard';

const PROD = `https://${PROD_HOST}`;
const STAGING = 'https://staging.example.test';
const STAGING_SUPABASE_HOST = 'staging-project.supabase.co';

/** A minimal Page double exposing only what watchBackendHost calls: .on('request', cb). */
function fakePage(): { page: Page; fireRequest: (url: string) => void } {
  let handler: ((req: { url(): string }) => void) | undefined;
  const page = {
    on: (event: string, cb: (req: { url(): string }) => void) => {
      if (event === 'request') handler = cb;
    },
  };
  return {
    page: page as unknown as Page,
    fireRequest: (url: string) => handler?.({ url: () => url }),
  };
}

describe('assertRunAllowed', () => {
  it('refuses a production target without the explicit opt-in', () => {
    expect(() => assertRunAllowed({ baseURL: PROD, allowProdEnv: undefined }))
      .toThrow(ProdGuardError);
    expect(() => assertRunAllowed({ baseURL: PROD, allowProdEnv: 'false' }))
      .toThrow(/ALLOW_PROD_E2E=true/);
    // "1" and "yes" are not the opt-in. Only the exact string counts.
    expect(() => assertRunAllowed({ baseURL: PROD, allowProdEnv: '1' }))
      .toThrow(ProdGuardError);
  });

  it('allows production only with the exact opt-in', () => {
    const res = assertRunAllowed({ baseURL: PROD, allowProdEnv: 'true' });
    expect(res.targetsProduction).toBe(true);
    expect(res.host).toBe(PROD_HOST);
  });

  it('refuses the opt-in when the URL is NOT the production host', () => {
    // Guards against a stale ALLOW_PROD_E2E in a shell silently authorizing
    // whatever host is configured next.
    expect(() => assertRunAllowed({ baseURL: STAGING, allowProdEnv: 'true' }))
      .toThrow(/must name the host it authorizes/);
  });

  it('allows a non-production target with no opt-in at all', () => {
    const res = assertRunAllowed({ baseURL: STAGING, allowProdEnv: undefined });
    expect(res.targetsProduction).toBe(false);
  });

  it('requires a base URL and rejects a malformed one', () => {
    expect(() => assertRunAllowed({ baseURL: undefined, allowProdEnv: undefined }))
      .toThrow(/PLAYWRIGHT_BASE_URL is required/);
    expect(() => assertRunAllowed({ baseURL: 'not a url', allowProdEnv: undefined }))
      .toThrow(/not a valid URL/);
  });

  it('matches the production host exactly, not by substring', () => {
    // A look-alike host must not be treated as production and silently skip the
    // opt-in requirement — nor should it satisfy an opt-in meant for the real one.
    expect(isProductionHost(`https://evil-${PROD_HOST}`)).toBe(false);
    expect(isProductionHost(`https://${PROD_HOST}.attacker.test`)).toBe(false);
    expect(isProductionHost(`https://${PROD_HOST.toUpperCase()}`)).toBe(true);
    expect(isProductionHost(`https://${PROD_HOST}/org-admin/roles`)).toBe(true);
  });
});

describe('watchBackendHost', () => {
  it('ignores non-Supabase requests and captures the host of the first auth/v1 or rest/v1 one', () => {
    const { page, fireRequest } = fakePage();
    const backend = watchBackendHost(page);

    fireRequest('https://cdn.example.test/app.js');
    expect(backend.get()).toBeUndefined();

    fireRequest(`https://${STAGING_SUPABASE_HOST}/auth/v1/token?grant_type=password`);
    expect(backend.get()).toBe(STAGING_SUPABASE_HOST);
  });

  it('keeps the first observed host even if a later request targets a different one', () => {
    const { page, fireRequest } = fakePage();
    const backend = watchBackendHost(page);

    fireRequest(`https://${STAGING_SUPABASE_HOST}/auth/v1/token`);
    fireRequest(`https://${PROD_SUPABASE_HOST}/rest/v1/roles`);

    expect(backend.get()).toBe(STAGING_SUPABASE_HOST);
  });

  it('never observed anything when no Supabase request fired', () => {
    const { page } = fakePage();
    const backend = watchBackendHost(page);
    expect(backend.get()).toBeUndefined();
  });
});

describe('assertBackendAllowed — the gap a frontend-only check misses', () => {
  it('refuses to proceed if no backend request was ever observed', () => {
    expect(() => assertBackendAllowed({ backendHost: undefined, allowProdEnv: undefined }))
      .toThrow(/Could not observe a Supabase request/);
  });

  it('allows a non-production backend with no opt-in', () => {
    const res = assertBackendAllowed({ backendHost: STAGING_SUPABASE_HOST, allowProdEnv: undefined });
    expect(res.targetsProduction).toBe(false);
    expect(res.host).toBe(STAGING_SUPABASE_HOST);
  });

  it('refuses the production Supabase backend without the opt-in — even behind a non-production frontend', () => {
    // This is the exact fail-open scenario the guard exists for: a preview
    // deployment (an obviously non-production frontend host) can still be
    // built against the live database.
    expect(() => assertBackendAllowed({ backendHost: PROD_SUPABASE_HOST, allowProdEnv: undefined }))
      .toThrow(/ALLOW_PROD_E2E=true/);
    expect(() => assertBackendAllowed({ backendHost: PROD_SUPABASE_HOST, allowProdEnv: 'false' }))
      .toThrow(ProdGuardError);
  });

  it('allows the production Supabase backend only with the exact opt-in', () => {
    const res = assertBackendAllowed({ backendHost: PROD_SUPABASE_HOST, allowProdEnv: 'true' });
    expect(res.targetsProduction).toBe(true);
  });

  it('matches the production Supabase host exactly, not by substring', () => {
    expect(isProductionSupabaseHost(`evil-${PROD_SUPABASE_HOST}`)).toBe(false);
    expect(isProductionSupabaseHost(`${PROD_SUPABASE_HOST}.attacker.test`)).toBe(false);
    expect(isProductionSupabaseHost(PROD_SUPABASE_HOST.toUpperCase())).toBe(true);
  });

  it('refuses a backend that does not match an explicitly expected one, even when neither is production', () => {
    expect(() =>
      assertBackendAllowed({
        backendHost: 'unexpected-project.supabase.co',
        allowProdEnv: undefined,
        expectedSupabaseHost: STAGING_SUPABASE_HOST,
      })
    ).toThrow(/does not match the expected host/);
  });

  it('allows a backend that matches the explicitly expected one', () => {
    const res = assertBackendAllowed({
      backendHost: STAGING_SUPABASE_HOST,
      allowProdEnv: undefined,
      expectedSupabaseHost: STAGING_SUPABASE_HOST,
    });
    expect(res.targetsProduction).toBe(false);
  });

  it('checks the expected-host pin case-insensitively', () => {
    expect(() =>
      assertBackendAllowed({
        backendHost: STAGING_SUPABASE_HOST,
        allowProdEnv: undefined,
        expectedSupabaseHost: STAGING_SUPABASE_HOST.toUpperCase(),
      })
    ).not.toThrow();
  });
});

describe('combined frontend + backend targeting — the four scenarios that matter', () => {
  it('preview frontend + staging backend: allowed with no opt-in', () => {
    expect(() => assertRunAllowed({ baseURL: STAGING, allowProdEnv: undefined })).not.toThrow();
    expect(() =>
      assertBackendAllowed({ backendHost: STAGING_SUPABASE_HOST, allowProdEnv: undefined })
    ).not.toThrow();
  });

  it('preview frontend + production backend: refused without opt-in — the fail-open gap this guard closes', () => {
    // The frontend check alone would pass here (STAGING is not PROD_HOST) —
    // it is the backend check that must independently refuse this run.
    expect(() => assertRunAllowed({ baseURL: STAGING, allowProdEnv: undefined })).not.toThrow();
    expect(() =>
      assertBackendAllowed({ backendHost: PROD_SUPABASE_HOST, allowProdEnv: undefined })
    ).toThrow(ProdGuardError);
  });

  it('production frontend + production backend: refused without opt-in', () => {
    expect(() => assertRunAllowed({ baseURL: PROD, allowProdEnv: undefined })).toThrow(ProdGuardError);
    expect(() =>
      assertBackendAllowed({ backendHost: PROD_SUPABASE_HOST, allowProdEnv: undefined })
    ).toThrow(ProdGuardError);
  });

  it('actual backend differs from the pinned expected host: refused regardless of production status', () => {
    expect(() =>
      assertBackendAllowed({
        backendHost: 'some-other-project.supabase.co',
        allowProdEnv: undefined,
        expectedSupabaseHost: STAGING_SUPABASE_HOST,
      })
    ).toThrow(ProdGuardError);
  });
});

describe('test-data naming', () => {
  it('produces a unique, prefixed role name per run', () => {
    const a = makeTestRoleName(1000);
    const b = makeTestRoleName(2000);
    expect(a.startsWith(TEST_PREFIX)).toBe(true);
    expect(a).not.toBe(b);
  });

  it('recognises only its own fixtures', () => {
    expect(isOwnedByThisSuite(makeTestRoleName())).toBe(true);
    expect(isOwnedByThisSuite('Financial Controller')).toBe(false);
    expect(isOwnedByThisSuite('Full Access')).toBe(false);
    expect(isOwnedByThisSuite('')).toBe(false);
  });
});

describe('FixtureOwnership', () => {
  it('refuses to track anything without the suite prefix', () => {
    const own = new FixtureOwnership();
    expect(() => own.claimRole('Financial Controller')).toThrow(ProdGuardError);
    expect(own.ownedRoles()).toEqual([]);
  });

  it('refuses to delete a role it did not create — the core safety property', () => {
    const own = new FixtureOwnership();
    const mine = makeTestRoleName();
    own.claimRole(mine);

    expect(() => own.assertDeletable(mine)).not.toThrow();
    expect(() => own.assertDeletable('Financial Controller')).toThrow(/not created by this run/);
    // Even a correctly-prefixed name this run did not create is refused.
    expect(() => own.assertDeletable(`${TEST_PREFIX}_someone_else`)).toThrow(/not created by this run/);
  });

  it('will not track an assignment for a role it does not own', () => {
    const own = new FixtureOwnership();
    expect(() => own.claimAssignment('user@test', `${TEST_PREFIX}_unknown`))
      .toThrow(/did not create that role/);
  });

  it('tracks assignments for roles it does own', () => {
    const own = new FixtureOwnership();
    const mine = makeTestRoleName();
    own.claimRole(mine);
    own.claimAssignment('user@test', mine);
    expect(own.ownedAssignments()).toEqual([`user@test::${mine}`]);
  });
});
