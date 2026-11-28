import { beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => {
  const result = { data: null as unknown, error: null as Error | null };
  const insert = vi.fn();
  const maybeSingle = vi.fn(async () => result);
  const chain = {
    select: vi.fn(),
    eq: vi.fn(),
    maybeSingle,
    insert,
  };
  chain.select.mockReturnValue(chain);
  chain.eq.mockReturnValue(chain);

  return {
    chain,
    from: vi.fn(() => chain),
    getTenant: vi.fn(),
    result,
  };
});

vi.mock('@/lib/supabase', () => ({
  getEffectiveTenantId: db.getTenant,
  supabase: { from: db.from },
}));

import { getHrPoliciesReadOnly } from '../policies-service';

describe('getHrPoliciesReadOnly', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    db.result.data = null;
    db.result.error = null;
  });

  it('returns in-memory defaults without inserting when no policy row exists', async () => {
    const policies = await getHrPoliciesReadOnly('org-1');

    expect(policies).toMatchObject({
      id: '',
      org_id: 'org-1',
      annual_leave_days_before_5y: 21,
      annual_leave_days_after_5y: 30,
    });
    expect(db.from).toHaveBeenCalledWith('hr_policies');
    expect(db.chain.eq).toHaveBeenCalledWith('org_id', 'org-1');
    expect(db.chain.insert).not.toHaveBeenCalled();
  });

  it('propagates policy read failures', async () => {
    db.result.error = new Error('policy read denied');

    await expect(getHrPoliciesReadOnly('org-1')).rejects.toThrow('policy read denied');
    expect(db.chain.insert).not.toHaveBeenCalled();
  });
});
