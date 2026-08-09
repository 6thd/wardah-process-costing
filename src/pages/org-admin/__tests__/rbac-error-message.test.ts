// src/pages/org-admin/__tests__/rbac-error-message.test.ts
//
// The Migration 174 RPCs raise stable, greppable codes. This mapping is what an
// administrator actually reads when an operation is refused, so each branch is
// pinned: a renamed code silently falling through to the raw Postgres string is
// a real regression, not a cosmetic one.

import { describe, it, expect } from 'vitest';
import { rbacErrorMessage } from '../rbac-role-form';

describe('rbacErrorMessage', () => {
  it('explains why an assigned role cannot be deleted, and what to do first', () => {
    const msg = rbacErrorMessage({ message: 'RBAC_174_ROLE_STILL_ASSIGNED: 2 user(s)' });
    expect(msg).toContain('مُعيَّنًا');
    expect(msg).not.toContain('RBAC_174');
  });

  it.each([
    ['RBAC_174_SYSTEM_ROLE_IMMUTABLE', 'دور النظام'],
    ['RBAC_174_ROLE_NAME_TAKEN', 'الاسم نفسه'],
    ['RBAC_174_ROLE_NAME_REQUIRED', 'اسم الدور مطلوب'],
    ['RBAC_174_UNKNOWN_PERMISSION_KEY', 'مفتاح صلاحية غير معروف'],
    ['RBAC_174_DUPLICATE_ROLE_ID', 'تكرار'],
    ['RBAC_174_ROLE_NOT_IN_ORG', 'لا ينتمي'],
    ['RBAC_174_TARGET_NOT_ACTIVE_ORG_MEMBER', 'عضوًا نشطًا'],
    ['NOT_ORG_ADMIN', 'مسؤول المؤسسة'],
  ])('maps %s to a readable message', (code, expected) => {
    expect(rbacErrorMessage({ message: code })).toContain(expected);
  });

  it('matches a code embedded in a longer Postgres message', () => {
    const raw = 'new row violates ... RBAC_174_ROLE_NOT_IN_ORG ... CONTEXT: PL/pgSQL function';
    expect(rbacErrorMessage({ message: raw })).toContain('لا ينتمي');
  });

  it('falls back to the raw message for an unrecognised failure rather than hiding it', () => {
    expect(rbacErrorMessage({ message: 'connection reset by peer' })).toBe('connection reset by peer');
  });

  it('still returns something usable for null, undefined and an empty message', () => {
    expect(rbacErrorMessage(null)).toBe('فشلت العملية');
    expect(rbacErrorMessage(undefined)).toBe('فشلت العملية');
    expect(rbacErrorMessage({ message: '' })).toBe('فشلت العملية');
    expect(rbacErrorMessage({})).toBe('فشلت العملية');
  });
});

// ---------------------------------------------------------------------------
// The rest of the role-editor logic, extracted from the page so it is testable
// directly rather than only through a mounted dialog.
// ---------------------------------------------------------------------------

import { permissionIdsToKeys, sensitiveAmong, buildUpsertRolePayload } from '../rbac-role-form';

const MODULES = [
  {
    permissions: [
      { id: 'p1', permission_key: 'accounting.vouchers.unpost' },
      { id: 'p2', permission_key: 'accounting.entries.approve' },
    ],
  },
  { permissions: [{ id: 'p3', permission_key: 'sales.invoices.create' }] },
];

describe('permissionIdsToKeys', () => {
  it('maps selected ids to permission keys across modules', () => {
    expect(permissionIdsToKeys(MODULES, ['p1', 'p3'])).toEqual([
      'accounting.vouchers.unpost',
      'sales.invoices.create',
    ]);
  });

  it('drops an unknown id rather than emitting undefined into the payload', () => {
    expect(permissionIdsToKeys(MODULES, ['p1', 'ghost'])).toEqual(['accounting.vouchers.unpost']);
  });

  it('returns an empty array for an empty selection', () => {
    expect(permissionIdsToKeys(MODULES, [])).toEqual([]);
    expect(permissionIdsToKeys([], ['p1'])).toEqual([]);
  });
});

describe('sensitiveAmong', () => {
  const SENSITIVE = ['accounting.vouchers.unpost', 'accounting.vouchers.cancel'];

  it('returns only the selected keys the backend classified as sensitive', () => {
    expect(sensitiveAmong(['accounting.vouchers.unpost', 'sales.invoices.create'], SENSITIVE))
      .toEqual(['accounting.vouchers.unpost']);
  });

  it('is empty when nothing sensitive is selected', () => {
    expect(sensitiveAmong(['sales.invoices.create'], SENSITIVE)).toEqual([]);
  });

  it('never invents sensitivity when the backend list is empty', () => {
    // If the snapshot said nothing is sensitive, the UI must not decide otherwise.
    expect(sensitiveAmong(['accounting.vouchers.unpost'], [])).toEqual([]);
  });

  it('follows the backend ordering so the warning list is stable', () => {
    expect(sensitiveAmong(['accounting.vouchers.cancel', 'accounting.vouchers.unpost'], SENSITIVE))
      .toEqual(SENSITIVE);
  });
});

describe('buildUpsertRolePayload', () => {
  it('sends role_id null on create, so the RPC takes the create branch', () => {
    const payload = buildUpsertRolePayload({
      orgId: 'org-1', name: '', nameAr: 'مراقب', permissionKeys: ['accounting.vouchers.unpost'],
    });
    expect(payload).toEqual({
      org_id: 'org-1',
      role_id: null,
      name: 'مراقب',          // falls back to the Arabic name when none is given
      name_ar: 'مراقب',
      description: undefined,
      is_active: true,
      permission_keys: ['accounting.vouchers.unpost'],
    });
  });

  it('carries role_id on update', () => {
    const payload = buildUpsertRolePayload({
      orgId: 'org-1', roleId: 'role-1', name: 'Controller', nameAr: 'مراقب', permissionKeys: [],
    });
    expect(payload.role_id).toBe('role-1');
    expect(payload.name).toBe('Controller');
    expect(payload.permission_keys).toEqual([]);
  });
});
