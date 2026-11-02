/**
 * رد `rpc_get_mfg_cost_policy_205` بالشكل الذي يبنيه ملف 205 (sql/migrations/205_…sql):
 * حقول 204 لكل إصدار، ثم `policy_205` و`data_205` و`approval` و`legacy_resolution`
 * و`unallocated_exception`؛ والمسودات من `mfg_cost_policy_drafts_205`. المبالغ كما يرسلها
 * الخادم: الموازنات والاستثناء بالريال، ومبالغ المسودات كما أُدخلت.
 */
export const ORG = '52050205-0000-0000-0000-0000000000a1'
export const SESSION_USER = '52050205-0000-0000-0000-000000000a02'
export const OTHER_USER = '52050205-0000-0000-0000-000000000a03'

const pools204 = [
  { pool_code: 'LABOR_OH', name: 'Labor overhead', name_ar: null, basis: 'labor_hours', rate: 12 },
  { pool_code: 'MACHINE_OH', name: 'Machine overhead', name_ar: null, basis: 'machine_hours', rate: 46 },
]

export function cp205Response(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    org_id: ORG,
    today: '2026-11-02',
    current_version_id: 'ver-1',
    latest_version_no: 2,
    versions: [
      {
        id: 'ver-2', version_no: 2, effective_from: '2026-11-10', status: 'scheduled',
        labor_cost_source: 'work_center_rate', default_labor_rate_per_hour: 30, stage_costing_method: 'weighted_average',
        pin_event: 'mo_created', note: null, pinned_order_count: 0, awaiting_start_order_count: 0, withdraw_reason: null,
        overhead_pools: pools204, work_center_rules: [],
        policy_205: 'approved_205',
        data_205: {
          labor_cost_source: 'work_center_rate', default_labor_rate: 30,
          pools: [
            { code: 'LABOR_OH', basis: 'labor_hours', rate: 12, activity: 'both', budgets: ['ELECTRICITY'] },
            { code: 'MACHINE_OH', basis: 'machine_hours', rate: 46, activity: 'run', budgets: ['DEPRECIATION'] },
          ],
          wc_rules: {},
          budgets: [
            { code: 'DEPRECIATION', gl_account: 'gl-2', cost_center: null, setup: false, amount: 15000 },
            { code: 'ELECTRICITY', gl_account: 'gl-1', cost_center: null, setup: false, amount: 9000 },
            { code: 'SUPERVISION', gl_account: 'gl-3', cost_center: null, setup: false, amount: 4800.5 },
          ],
          setup_acks: [],
          unallocated_exception: { policy: 'controlled_exception', budgets: ['SUPERVISION'], reason: 'period cost', treatment: 'unabsorbed', approved_by: OTHER_USER },
        },
        approval: {
          id: 'appr-1', draft_id: 'draft-approved', kind: 'version', policy_version_id: 'ver-2', created_by: SESSION_USER,
          approved_by: OTHER_USER, approved_at: '2026-11-01T10:00:00+00:00', draft_revision: 3, self_approved: false,
          self_approval_enabled_at_approval: false, unallocated_policy_at_approval: 'controlled_exception',
        },
        legacy_resolution: null,
        unallocated_exception: {
          policy_version_id: 'ver-2', draft_id: 'draft-approved', budgets: { SUPERVISION: 4800.5 },
          reason: 'period cost', treatment: 'unabsorbed', approved_by: OTHER_USER,
          policy_at_approval: 'controlled_exception', approved_at: '2026-11-01T10:00:00+00:00',
        },
      },
      {
        id: 'ver-1', version_no: 1, effective_from: '2026-10-22', status: 'current',
        labor_cost_source: 'work_center_rate', default_labor_rate_per_hour: 30, stage_costing_method: 'weighted_average',
        pin_event: 'mo_created', note: null, pinned_order_count: 2, awaiting_start_order_count: 0, withdraw_reason: null,
        overhead_pools: pools204, work_center_rules: [],
        policy_205: 'legacy_unresolved',
        data_205: {
          labor_cost_source: 'work_center_rate', default_labor_rate: 30,
          pools: [{ code: 'LABOR_OH', basis: 'labor_hours', rate: 12 }, { code: 'MACHINE_OH', basis: 'machine_hours', rate: 46 }],
          wc_rules: {},
        },
        approval: null, legacy_resolution: null, unallocated_exception: null,
      },
    ],
    drafts: [
      {
        id: 'draft-stale', kind: 'version', status: 'draft', revision: 2, legacy_version_id: null,
        payload: { effective_from: '2026-11-20', budgets: [{ budget_code: 'SUPERVISION', amount: 4800.5 }] },
        expected_latest_version_no: 1, reason: null, created_by: SESSION_USER, created_at: '2026-11-01T09:00:00+00:00',
        updated_at: '2026-11-01T09:30:00+00:00', decided_by: null, decided_at: null, decision_reason: null, result_version_id: null,
        unallocated_budgets: [{ budget_code: 'SUPERVISION', amount: 4800.5 }],
      },
      {
        id: 'draft-legacy', kind: 'legacy_resolution', status: 'draft', revision: 1, legacy_version_id: 'ver-1',
        payload: { pools: [], budgets: [] }, expected_latest_version_no: null, reason: 'resolve v1', created_by: OTHER_USER,
        created_at: '2026-11-01T11:00:00+00:00', updated_at: '2026-11-01T11:00:00+00:00', decided_by: null, decided_at: null,
        decision_reason: null, result_version_id: null, unallocated_budgets: [],
      },
      {
        id: 'draft-approved', kind: 'version', status: 'approved', revision: 3, legacy_version_id: null,
        payload: { effective_from: '2026-11-10' }, expected_latest_version_no: 1, reason: null, created_by: SESSION_USER,
        created_at: '2026-10-31T09:00:00+00:00', updated_at: '2026-11-01T10:00:00+00:00', decided_by: OTHER_USER,
        decided_at: '2026-11-01T10:00:00+00:00', decision_reason: null, result_version_id: 'ver-2', unallocated_budgets: [],
      },
      {
        id: 'draft-rejected', kind: 'version', status: 'rejected', revision: 1, legacy_version_id: null,
        payload: { effective_from: '2026-11-05' }, expected_latest_version_no: 1, reason: null, created_by: SESSION_USER,
        created_at: '2026-10-30T09:00:00+00:00', updated_at: '2026-10-30T12:00:00+00:00', decided_by: OTHER_USER,
        decided_at: '2026-10-30T12:00:00+00:00', decision_reason: 'rates not agreed', result_version_id: null, unallocated_budgets: [],
      },
    ],
    settings: { self_approval_enabled: false, unallocated_budget_policy: 'controlled_exception' },
    settings_audit: [{
      id: 1, setting: 'unallocated_budget_policy', old_value: 'block', new_value: 'controlled_exception',
      changed_by: OTHER_USER, changed_at: '2026-10-31T08:00:00+00:00', reason: 'supervision as a period cost',
    }],
    supported: {
      labor_cost_sources: ['work_center_rate', 'recorded_entry_rate'], overhead_bases: ['labor_hours', 'machine_hours'],
      pool_activities: ['run', 'setup', 'both'], stage_costing_methods: ['weighted_average'],
      pin_events: ['mo_created', 'production_started'], unallocated_budget_policies: ['block', 'controlled_exception'],
      cost_centers_accepted: false,
    },
    capabilities: {
      can_create: true, can_approve: true, can_self_approve: true,
      can_manage_approval_settings: true, can_manage_unallocated_policy: true,
    },
    ...overrides,
  }
}
