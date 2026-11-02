export const QUALITY_POLICY_QUERY_KEY = ['manufacturing-settings', 'quality'] as const
export const MATERIAL_ISSUE_QUERY_KEY = ['manufacturing-settings', 'material-issue'] as const
export const GL_MAPPINGS_QUERY_KEY = ['manufacturing-settings', 'gl-mappings'] as const
export const POSTING_ACCOUNTS_QUERY_KEY = ['manufacturing-settings', 'posting-accounts'] as const
export const WORK_CENTERS_QUERY_KEY = ['manufacturing-settings', 'work-centers'] as const
export const COST_POLICY_QUERY_KEY = ['manufacturing-settings', 'cost-policy'] as const
export const COST_POLICY_WORK_CENTERS_QUERY_KEY = ['manufacturing-settings', 'cost-policy-work-centers'] as const
export const COST_POLICY_205_QUERY_KEY = ['manufacturing-settings', 'cost-policy-205'] as const
/** مربوط بالمؤسسة المختارة: رد مؤسسة لا يُقرأ من ذاكرة مؤسسة أخرى، ولو وصل متأخرًا. */
export const costPolicy205QueryKey = (orgId: string | null) => [...COST_POLICY_205_QUERY_KEY, orgId] as const
/** مفاتيح 204 مربوطة بالمؤسسة المختارة كذلك: لا تُقرأ سياسة مؤسسة أو مراكز عملها من ذاكرة مؤسسة أخرى. */
export const costPolicyQueryKey = (orgId: string) => [...COST_POLICY_QUERY_KEY, orgId] as const
export const costPolicyWorkCentersQueryKey = (orgId: string) => [...COST_POLICY_WORK_CENTERS_QUERY_KEY, orgId] as const
