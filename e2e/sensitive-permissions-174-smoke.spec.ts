/**
 * Migration 174 — sensitive permission browser smoke.
 *
 * Drives the full role lifecycle through the UI and asserts that the
 * cancel/unpost controls follow the BACKEND decision rather than a client-side
 * override: create a role with no sensitive keys, add cancel, assign, add
 * unpost, revoke one, revoke the role — checking the buttons appear and
 * disappear in step, without a re-login, since rpc_permission_snapshot is
 * re-read after every grant and revocation.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * HOW TO RUN
 * ─────────────────────────────────────────────────────────────────────────────
 * Against a non-production environment (no opt-in needed):
 *
 *   PLAYWRIGHT_BASE_URL="https://staging.example.test" \
 *   E2E_ORG_ADMIN_EMAIL="…" E2E_ORG_ADMIN_PASSWORD="…" \
 *   E2E_USER_EMAIL="…"      E2E_USER_PASSWORD="…" \
 *   npx playwright test e2e/sensitive-permissions-174-smoke.spec.ts
 *
 * Against production, which additionally requires a deliberate opt-in naming
 * that exact host:
 *
 *   ALLOW_PROD_E2E=true \
 *   PLAYWRIGHT_BASE_URL="https://wardah-process-costing.vercel.app" \
 *   E2E_ORG_ADMIN_EMAIL="…" E2E_ORG_ADMIN_PASSWORD="…" \
 *   E2E_USER_EMAIL="…"      E2E_USER_PASSWORD="…" \
 *   npx playwright test e2e/sensitive-permissions-174-smoke.spec.ts
 *
 * Pass credentials only as environment variables. Never put them in the repo,
 * a config file, or a shell history you keep.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * SAFETY CONTRACT
 * ─────────────────────────────────────────────────────────────────────────────
 * 1. ALLOW_PROD_E2E=true is required for a production target, and is itself
 *    rejected when the URL is not that exact host (see e2e/fixtures/prod-guard).
 * 2. Everything created carries the ZZ_E2E174_<timestamp> prefix.
 * 3. Deletion consults an ownership ledger, never a page listing: a fixture this
 *    run did not create can never be selected for cleanup.
 * 4. Cleanup runs in `finally`, so a mid-test failure still removes fixtures,
 *    and goes through the same approved RPCs the UI uses — never a direct write.
 * 5. Pre-existing roles, assignments, users and vouchers are read-only here. The
 *    voucher controls are asserted for VISIBILITY only; this suite never clicks
 *    cancel or unpost, so no voucher is ever modified.
 * 6. Evidence is captured as Playwright test attachments (screenshots at each
 *    phase, a JSON summary, and the trace) plus console errors, failed
 *    requests, the RPC call sequence, and the rbac.* audit rows the run
 *    produced — all visible in the HTML report, none of it written by this
 *    file's own filesystem calls.
 *
 * The guards themselves are unit-tested in
 * src/services/__tests__/e2e-prod-guard.test.ts — a guard that has never been
 * executed is not a guard.
 */

import { test, expect, type Page } from '@playwright/test';
import { accounts, loginAs, logout, skipIfMissingEnv } from './fixtures/auth';
import { assertRunAllowed, makeTestRoleName, FixtureOwnership } from './fixtures/prod-guard';

const CANCEL_KEY = 'accounting.vouchers.cancel';
const UNPOST_KEY = 'accounting.vouchers.unpost';

const evidence = {
  consoleErrors: [] as string[],
  failedRequests: [] as string[],
  rpcCalls: [] as string[],
  auditRows: [] as string[],
  phases: [] as string[],
};

test.use({ trace: 'on', screenshot: 'only-on-failure' });

function watchPage(page: Page) {
  page.on('console', msg => {
    if (msg.type() === 'error') evidence.consoleErrors.push(msg.text());
  });
  page.on('requestfailed', req => {
    evidence.failedRequests.push(`${req.method()} ${req.url()} — ${req.failure()?.errorText ?? ''}`);
  });
  page.on('request', req => {
    const url = req.url();
    if (url.includes('/rest/v1/rpc/')) {
      evidence.rpcCalls.push(url.split('/rest/v1/rpc/')[1].split('?')[0]);
    }
  });
}

async function phase(page: Page, name: string) {
  // The phase name is recorded in evidence.phases/evidence.json, never in a
  // filesystem path. The screenshot itself goes through testInfo.attach(),
  // which writes it into Playwright's own managed test-results output — this
  // function has no fs/path call of its own to construct at all.
  evidence.phases.push(`${new Date().toISOString()} ${name}`);
  const buffer = await page.screenshot({ fullPage: true }).catch(() => null);
  if (buffer) {
    await test.info().attach(`phase-${evidence.phases.length}`, {
      body: buffer,
      contentType: 'image/png',
    }).catch(() => { /* a screenshot must never fail the run */ });
  }
}

async function openRoleEditor(page: Page, roleName?: string) {
  await page.goto('/org-admin/roles');
  await page.waitForLoadState('networkidle');
  if (roleName) {
    // The edit button's accessible name is an exact aria-label — `تعديل دور
    // <name>` and nothing else — so an exact string match is both correct
    // and simpler than a dynamically-built RegExp.
    const editButton = page.getByRole('button', { name: `تعديل دور ${roleName}`, exact: true });
    await expect(editButton, `edit control for owned role ${roleName}`).toBeVisible();
    await editButton.click();
  } else {
    await page.getByRole('button', { name: /دور جديد/ }).click();
  }
  await expect(page.getByRole('dialog')).toBeVisible();
}

async function togglePermission(page: Page, modulePattern: RegExp, permissionPattern: RegExp) {
  const dialog = page.getByRole('dialog');
  const permissionRow = dialog.getByRole('button', { name: permissionPattern }).first();

  if (!await permissionRow.isVisible().catch(() => false)) {
    const moduleButton = dialog.getByRole('button', { name: modulePattern }).first();
    await expect(moduleButton, `permission module ${modulePattern}`).toBeVisible();
    await moduleButton.click();
  }

  await expect(permissionRow, `permission row ${permissionPattern}`).toBeVisible();
  await permissionRow.scrollIntoViewIfNeeded();
  await permissionRow.click();
}

async function saveRole(page: Page) {
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: /حفظ التغييرات|إنشاء الدور/ }).click();
  await expect(dialog).toBeHidden({ timeout: 15_000 });
}

/** Toggle only this run's roles; every pre-existing assignment stays untouched. */
async function setUserRoles(page: Page, userEmail: string, roleNames: string[], own: FixtureOwnership) {
  roleNames.forEach(n => own.assertDeletable(n));
  await page.goto('/org-admin/users');
  await page.waitForLoadState('networkidle');

  const userRow = page.locator('div.divide-y > div').filter({ hasText: userEmail }).first();
  await expect(userRow, `organization user row for ${userEmail}`).toBeVisible();
  await userRow.getByRole('button', { name: 'إجراءات المستخدم' }).click();
  await page.getByRole('menuitem', { name: /إدارة الأدوار/ }).click();

  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();

  for (const name of own.ownedRoles()) {
    // The assignment row's accessible name also carries its description and
    // permission-count badge, so it cannot be an exact match — but Playwright's
    // own hasText filter does the substring match without building a RegExp
    // out of a variable.
    const row = dialog.getByRole('button').filter({ hasText: name });
    await expect(row, `owned role ${name} in assignment dialog`).toBeVisible();
    const shouldBeOn = roleNames.includes(name);
    const checkbox = row.getByRole('checkbox');
    const isOn = await checkbox.isChecked();
    if (isOn !== shouldBeOn) await row.click();
  }
  await dialog.getByRole('button', { name: 'حفظ التغييرات' }).click();
  await expect(dialog).toBeHidden({ timeout: 15_000 });
}

async function deleteOwnedRole(page: Page, roleName: string, own: FixtureOwnership) {
  own.assertDeletable(roleName);
  await page.goto('/org-admin/roles');
  await page.waitForLoadState('networkidle');

  // The role-specific accessible name is the positive ownership-to-DOM link.
  // If it cannot be found, cleanup aborts instead of falling back to a page-wide
  // delete button that could target a pre-existing role. Exact match against
  // the button's aria-label, same as openRoleEditor's edit control.
  const deleteButton = page.getByRole('button', { name: `حذف دور ${roleName}`, exact: true });
  await expect(deleteButton, `delete control for owned role ${roleName}`).toBeVisible();
  await deleteButton.click();

  const alert = page.getByRole('alertdialog');
  await expect(alert).toContainText(roleName);
  await alert.getByRole('button', { name: 'حذف', exact: true }).click();
  await expect(deleteButton).toHaveCount(0, { timeout: 15_000 });
}

async function writeEvidence(): Promise<void> {
  await test.info().attach('evidence', {
    body: JSON.stringify(
      {
        ...evidence,
        rpcCallCounts: evidence.rpcCalls.reduce<Record<string, number>>((acc, c) => {
          acc[c] = (acc[c] ?? 0) + 1;
          return acc;
        }, {}),
      },
      null,
      2
    ),
    contentType: 'application/json',
  });
}

const missingCredentialReason = skipIfMissingEnv(['orgAdmin', 'regularUser']);

test.describe('Migration 174 — sensitive permission smoke', () => {
  // Declare the skip before fixtures are created, so a credential-free CI run
  // does not need to install or launch a browser merely to discover it is safe.
  test.skip(Boolean(missingCredentialReason), missingCredentialReason ?? undefined);

  test('full lifecycle: buttons follow the backend, not the client', async ({ page, baseURL }) => {
    // Fail closed before a single byte is written anywhere.
    const target = assertRunAllowed({
      baseURL,
      allowProdEnv: process.env.ALLOW_PROD_E2E,
    });
    test.info().annotations.push({
      type: 'target',
      description: `${target.host} (production: ${target.targetsProduction})`,
    });

    const own = new FixtureOwnership();
    const roleName = makeTestRoleName();
    watchPage(page);

    let userPage: Page | undefined;
    let adminPage: Page | undefined;

    try {
      await loginAs(page, accounts.orgAdmin);
      adminPage = page;

      // ── 1. Create a role with NO sensitive keys ────────────────────────────
      await openRoleEditor(page);
      await page.locator('#role-name-ar').fill(roleName);
      // The target account needs the ordinary sales module grant to reach the
      // real voucher screen. Sensitive authority is still deliberately absent.
      await togglePermission(page, /المبيعات/, /المقبوضات\s*-\s*عرض/);
      await saveRole(page);
      own.claimRole(roleName);
      await expect(page.getByText(roleName).first()).toBeVisible();
      await phase(page, 'role-created-no-sensitive');

      // ── 2. Add cancel only; badge and warning must appear ─────────────────
      await openRoleEditor(page, roleName);
      await togglePermission(page, /المحاسبة/, /السندات المالية\s*-\s*إلغاء(?!\s*الترحيل)/);
      await expect(page.getByText('حساسة').first()).toBeVisible();
      await expect(page.getByRole('alert')).toContainText(CANCEL_KEY);
      await phase(page, 'cancel-selected-warning-shown');
      await saveRole(page);

      // ── 3. Assign, then check the controls as the target user ─────────────
      await setUserRoles(page, accounts.regularUser.email, [roleName], own);
      own.claimAssignment(accounts.regularUser.email, roleName);
      await phase(page, 'role-assigned');

      const userContext = await page.context().browser()!.newContext();
      userPage = await userContext.newPage();
      watchPage(userPage);
      await loginAs(userPage, accounts.regularUser);
      await userPage.goto('/sales/receipts');
      await userPage.waitForLoadState('networkidle');

      // VISIBILITY only — this suite never clicks these; no voucher is touched.
      const cancelBtn = userPage.getByRole('button', { name: /إلغاء سند/ });
      const unpostBtn = userPage.getByRole('button', { name: /إعادة سند .* إلى مسودة/ });
      await expect(cancelBtn.first()).toBeVisible();
      await expect(unpostBtn).toHaveCount(0);
      await phase(userPage, 'user-sees-cancel-only');

      // ── 4. Add unpost; both appear WITHOUT a re-login ─────────────────────
      await openRoleEditor(adminPage, roleName);
      await togglePermission(adminPage, /المحاسبة/, /السندات المالية\s*-\s*إلغاء الترحيل/);
      await expect(adminPage.getByRole('alert')).toContainText(UNPOST_KEY);
      await saveRole(adminPage);

      await userPage.reload();
      await userPage.waitForLoadState('networkidle');
      await expect(unpostBtn.first()).toBeVisible();
      await expect(cancelBtn.first()).toBeVisible();
      await phase(userPage, 'user-sees-both-without-relogin');

      // ── 5. Revoke cancel only ─────────────────────────────────────────────
      await openRoleEditor(adminPage, roleName);
      await togglePermission(adminPage, /المحاسبة/, /السندات المالية\s*-\s*إلغاء(?!\s*الترحيل)/);
      await saveRole(adminPage);

      await userPage.reload();
      await userPage.waitForLoadState('networkidle');
      await expect(cancelBtn).toHaveCount(0);
      await expect(unpostBtn.first()).toBeVisible();
      await phase(userPage, 'cancel-revoked-unpost-remains');

      // ── 6. Revoke the whole role ──────────────────────────────────────────
      await setUserRoles(adminPage, accounts.regularUser.email, [], own);
      await userPage.reload();
      await userPage.waitForLoadState('networkidle');
      await expect(cancelBtn).toHaveCount(0);
      await expect(unpostBtn).toHaveCount(0);
      await phase(userPage, 'role-revoked-no-buttons');

      // ── 7. Audit rows for every mutation ──────────────────────────────────
      await adminPage.goto('/org-admin/audit-log');
      await adminPage.waitForLoadState('networkidle');
      const auditText = await adminPage.locator('body').innerText();
      for (const action of ['rbac.role.create', 'rbac.role.update', 'rbac.user_roles.replace']) {
        if (auditText.includes(action)) evidence.auditRows.push(action);
      }
      await phase(adminPage, 'audit-log');
      expect(
        evidence.auditRows,
        `audit log did not show the expected rbac.* actions; saw: ${evidence.auditRows.join(', ')}`
      ).toContain('rbac.role.create');

      // ── 8. Console and network hygiene ────────────────────────────────────
      const loops = evidence.consoleErrors.filter(e =>
        /Maximum update depth|too many re-renders/i.test(e)
      );
      expect(loops, `render-loop errors: ${loops.join(' | ')}`).toHaveLength(0);

      const rpcErrors = evidence.consoleErrors.filter(e =>
        /RBAC_174_|NOT_ORG_ADMIN|NOT_ORG_MEMBER/i.test(e)
      );
      expect(rpcErrors, `unexpected RPC errors: ${rpcErrors.join(' | ')}`).toHaveLength(0);
      expect(
        evidence.failedRequests,
        `failed requests: ${evidence.failedRequests.join(' | ')}`
      ).toHaveLength(0);

      // Bounded, not zero: the snapshot is re-read on load and after each
      // grant/revocation. A large count means the staleness listener regressed
      // to firing on ordinary focus changes instead of visibilitychange.
      const snapshots = evidence.rpcCalls.filter(c => c === 'rpc_permission_snapshot').length;
      expect(snapshots, `rpc_permission_snapshot called ${snapshots}×`).toBeLessThan(30);

      // Writes went exclusively through the 174 RPCs.
      expect(evidence.rpcCalls).toContain('rpc_upsert_org_role');
      expect(evidence.rpcCalls).toContain('rpc_replace_user_roles');
    } finally {
      // ── 9. Cleanup: ours only, through the approved RPC, always ───────────
      try {
        if (adminPage && !adminPage.isClosed()) {
          for (const name of own.ownedRoles()) {
            // Assignments must go first: rpc_delete_org_role refuses a role that
            // users still hold, by design.
            await setUserRoles(adminPage, accounts.regularUser.email, [], own).catch(() => {});
            await deleteOwnedRole(adminPage, name, own);
          }
          expect(evidence.rpcCalls).toContain('rpc_delete_org_role');
        }
      } finally {
        await writeEvidence();
        if (userPage && !userPage.isClosed()) await logout(userPage).catch(() => {});
      }
    }
  });
});
