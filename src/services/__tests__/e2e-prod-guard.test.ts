// src/services/__tests__/e2e-prod-guard.test.ts
//
// The E2E safety rails, asserted directly.
//
// These guards are the only thing standing between a mistyped env var and
// writes against a live environment, so they are tested rather than trusted.
// They live under src/ so the normal vitest run picks them up — Playwright
// specs are not part of that run, but their guards should be.

import { describe, it, expect } from 'vitest';
import {
  assertRunAllowed,
  isProductionHost,
  makeTestRoleName,
  isOwnedByThisSuite,
  FixtureOwnership,
  ProdGuardError,
  PROD_HOST,
  TEST_PREFIX,
} from '../../../e2e/fixtures/prod-guard';

const PROD = `https://${PROD_HOST}`;
const STAGING = 'https://staging.example.test';

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
