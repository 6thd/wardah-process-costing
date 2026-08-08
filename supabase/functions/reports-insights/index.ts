// reports-insights: generic, provider-agnostic AI insights endpoint for the
// financial reports dashboard. No vendor name in any identifier — the model
// provider sits behind callProvider() below and can be swapped without
// touching the auth/quota/validation contract around it.
//
// Security contract (see sql/migrations/171_ai_usage_daily_and_reports_insights_permission.sql
// and docs/db/AI_USAGE_DAILY_171_RUNBOOK.md):
//   - Identity, org membership, and permission are resolved with a
//     request-bound client carrying the caller's own JWT.
//   - The daily quota RPC is called through a *separate* service_role
//     client. rpc_check_and_record_ai_usage is service_role-only in the
//     database — no direct caller can invoke it, and the limits passed to it
//     are internal constants, never taken from the request body.
//   - The question/data payload is never logged, only operation/status/
//     source/duration metadata.
//   - Model output is treated as untrusted by the caller (the client
//     never puts it through an HTML sink — every dynamic value is set via
//     .textContent, not innerHTML) — this function does not attempt to
//     sanitize it, only bounds its length.
//   - Only a classified provider failure (timeout, missing key, rate limit,
//     upstream 5xx) returns HTTP 200 with source:'fallback'. A database or
//     programming error returns a real 4xx/5xx so it is never mistaken for
//     normal fallback behavior.
//
// handleRequest() takes its Supabase clients and provider caller as
// injectable dependencies (defaulted to the real implementations at the
// bottom of this file) specifically so index.test.ts can drive every branch
// — auth, org resolution, permission, quota, provider success/failure —
// without a live database or network call.
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
// Pinned to the exact version resolved in package-lock.json (the npm side
// of this same client) rather than the floating "@2" tag: this function
// runs with the service_role key, so an unreviewed transitive upgrade
// landing between deploys is not an acceptable way to pick up a new
// @supabase/supabase-js release. Bump deliberately, alongside the npm
// dependency, and regenerate the repo's root-level deno.lock in the same
// change — every `deno check`/`lint`/`test` invocation here (CI included)
// runs from the repo root, so that root deno.lock is the one that's
// actually consulted, not a per-function lock next to
// supabase/functions/deno.json.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.86.0'
import { corsHeaders } from '../_shared/cors.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? ''
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const GROQ_API_KEY = Deno.env.get('GROQ_API_KEY') ?? ''

// Quota limits (20/day per user, 100/day per org) are enforced entirely
// inside rpc_check_and_record_ai_usage(p_org_id, p_user_id) as internal
// PL/pgSQL constants (sql/migrations/171_ai_usage_daily_and_reports_insights_permission.sql)
// — the function takes no limit arguments, so there is nothing here for a
// caller to override.
export const PERMISSION_KEY = 'reports.ai_insights.use'
export const MAX_BODY_BYTES = 16 * 1024
export const MAX_QUESTION_LENGTH = 500
export const MAX_OUTPUT_CHARS = 4000
export const PROVIDER_TIMEOUT_MS = 10000
export const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions'
// openai/gpt-oss-120b, not qwen/qwen3.6-27b: Groq classifies Qwen 3.6 27B as
// Preview ("evaluation purposes only," may be discontinued without notice),
// while GPT-OSS 120B is Production-tier, lists the same ~500 t/s speed, and
// is materially cheaper — no reason to run this function's real traffic on
// an eval-only model when a Production one matches or beats it on every
// axis that matters here.
export const GROQ_MODEL = 'openai/gpt-oss-120b'

export const INSIGHT_OPERATIONS = ['summary', 'predictions', 'optimization', 'risk', 'strategy', 'ask'] as const
export type InsightOperation = (typeof INSIGHT_OPERATIONS)[number]

export interface InsightRequestBody {
  operation: InsightOperation
  locale: 'ar' | 'en'
  data?: Record<string, unknown>
  question?: string
  requestId?: string
}

function jsonResponse(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    status,
  })
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function validateBody(
  raw: unknown
): { ok: true; body: InsightRequestBody } | { ok: false; error: string } {
  if (!isPlainObject(raw)) return { ok: false, error: 'invalid_request' }

  const operation = raw.operation
  if (typeof operation !== 'string' || !(INSIGHT_OPERATIONS as readonly string[]).includes(operation)) {
    return { ok: false, error: 'invalid_request' }
  }

  const locale = raw.locale
  if (locale !== 'ar' && locale !== 'en') {
    return { ok: false, error: 'invalid_request' }
  }

  const requestId = raw.requestId
  if (requestId !== undefined && (typeof requestId !== 'string' || requestId.length === 0 || requestId.length > 100)) {
    return { ok: false, error: 'invalid_request' }
  }

  const data = raw.data
  if (data !== undefined && !isPlainObject(data)) {
    return { ok: false, error: 'invalid_request' }
  }

  if (operation === 'ask') {
    const question = raw.question
    if (typeof question !== 'string' || question.length === 0 || question.length > MAX_QUESTION_LENGTH) {
      return { ok: false, error: 'invalid_request' }
    }
    // data is optional context for 'ask' — the dashboard's already-computed
    // financial figures, so the model can ground its answer in the
    // organization's real numbers instead of the question alone.
    return { ok: true, body: { operation, locale, question, data, requestId } }
  }

  return {
    ok: true,
    body: { operation: operation as InsightOperation, locale, data: data ?? {}, requestId },
  }
}

const OPERATION_INSTRUCTIONS: Record<InsightOperation, { ar: string; en: string }> = {
  summary: {
    ar: 'قدّم ملخصًا موجزًا وقابلاً للتنفيذ للأداء المالي بالاعتماد فقط على الأرقام المرسلة.',
    en: 'Provide a concise, actionable summary of financial performance using only the numbers provided.',
  },
  predictions: {
    ar: 'قدّم توقعات قصيرة المدى مبنية فقط على الاتجاهات الظاهرة في البيانات المرسلة.',
    en: 'Provide short-term predictions grounded only in the trends visible in the supplied data.',
  },
  optimization: {
    ar: 'اقترح توصيات عملية لتحسين الربحية بالاعتماد فقط على البيانات المرسلة.',
    en: 'Suggest practical recommendations to improve profitability, grounded only in the supplied data.',
  },
  risk: {
    ar: 'حلّل المخاطر المالية الظاهرة في البيانات المرسلة فقط.',
    en: 'Analyze the financial risks visible only in the supplied data.',
  },
  strategy: {
    ar: 'اقترح توصيات استراتيجية للنمو بالاعتماد فقط على البيانات المرسلة.',
    en: 'Suggest strategic growth recommendations grounded only in the supplied data.',
  },
  ask: {
    ar: 'أجب عن سؤال المستخدم بإيجاز ووضوح، بالاعتماد فقط على البيانات المرسلة إن وُجدت.',
    en: 'Answer the user question briefly and clearly, grounded only in any supplied data.',
  },
}

export function buildSystemPrompt(locale: 'ar' | 'en'): string {
  return locale === 'ar'
    ? 'أنت مساعد تحليلات مالية داخل نظام تخطيط موارد المصنّعين "وردة". أجب بإيجاز (150 كلمة كحد أقصى)، ولا تختلق أرقامًا لم تُرسل إليك، وأجب باللغة العربية فقط.'
    : 'You are a financial insights assistant inside the Wardah manufacturing ERP system. Answer concisely (150 words max), never invent numbers that were not provided to you, and reply in English only.'
}

export function buildUserPrompt(body: InsightRequestBody): string {
  const instruction = OPERATION_INSTRUCTIONS[body.operation][body.locale]
  if (body.operation === 'ask') {
    const context = body.data && Object.keys(body.data).length > 0
      ? `\n\nFinancial context (JSON): ${JSON.stringify(body.data)}`
      : ''
    return `${instruction}\n\nUser question: ${body.question}${context}`
  }
  return `${instruction}\n\nData (JSON): ${JSON.stringify(body.data ?? {})}`
}

export type ProviderResult = { kind: 'ok'; text: string } | { kind: 'unavailable'; reason: string }
export type FetchImpl = typeof fetch
export type ProviderCaller = (systemPrompt: string, userPrompt: string) => Promise<ProviderResult>

export function createProvider(apiKey: string, fetchImpl: FetchImpl = fetch): ProviderCaller {
  return async (systemPrompt: string, userPrompt: string): Promise<ProviderResult> => {
    if (!apiKey) {
      return { kind: 'unavailable', reason: 'provider_not_configured' }
    }

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), PROVIDER_TIMEOUT_MS)

    try {
      const response = await fetchImpl(GROQ_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: GROQ_MODEL,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ],
          max_tokens: 500,
          temperature: 0.3,
        }),
        signal: controller.signal,
      })

      if (response.status === 429 || response.status >= 500) {
        return { kind: 'unavailable', reason: `provider_status_${response.status}` }
      }
      if (!response.ok) {
        // A 4xx other than 429 means our request to the provider was
        // malformed or misconfigured — that is our bug, not a transient
        // provider outage, so it must not be silently swallowed as a
        // normal fallback.
        throw new Error(`provider_request_error_${response.status}`)
      }

      const payload = await response.json()
      const text = payload?.choices?.[0]?.message?.content
      if (typeof text !== 'string' || text.trim().length === 0) {
        throw new Error('provider_empty_response')
      }
      return { kind: 'ok', text: text.slice(0, MAX_OUTPUT_CHARS) }
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        return { kind: 'unavailable', reason: 'provider_timeout' }
      }
      if (err instanceof TypeError) {
        // Network-level failure (DNS, connection refused, etc.) — the
        // provider is unreachable, not a bug in our request.
        return { kind: 'unavailable', reason: 'provider_network_error' }
      }
      throw err
    } finally {
      clearTimeout(timer)
    }
  }
}

// --- Minimal shape of the Supabase client surface this function needs. ---
export interface AuthUserClient {
  auth: {
    getUser: () => Promise<{ data: { user: { id: string } | null }; error: { message: string } | null }>
  }
  rpc: (
    fn: string,
    params?: Record<string, unknown>
  ) => Promise<{ data: unknown; error: { message: string } | null }>
}

export interface AdminClient {
  rpc: (
    fn: string,
    params?: Record<string, unknown>
  ) => Promise<{ data: unknown; error: { message: string } | null }>
}

export interface HandleRequestDeps {
  createUserClient: (authHeader: string) => AuthUserClient
  createAdminClient: () => AdminClient
  callProvider: ProviderCaller
}

function defaultCreateUserClient(authHeader: string): AuthUserClient {
  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  }) as unknown as AuthUserClient
}

function defaultCreateAdminClient(): AdminClient {
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  }) as unknown as AdminClient
}

const defaultDeps: HandleRequestDeps = {
  createUserClient: defaultCreateUserClient,
  createAdminClient: defaultCreateAdminClient,
  callProvider: createProvider(GROQ_API_KEY),
}

// Each helper below returns either a `Response` to send back verbatim (a
// failure) or the data the next stage needs — handleRequest() at the
// bottom just chains them in the exact original order (parse/validate ->
// authenticate -> authorize -> check quota -> run provider), stopping at
// the first failure. Splitting handleRequest() up this way (originally one
// function covering all five concerns) is a pure extraction: every status
// code, every jsonResponse() field, the quota-before-provider ordering,
// and every console.log/error call and its fields are unchanged — this is
// verified by index.test.ts, which drives handleRequest() itself and is
// untouched by this refactor.

type StageResult<T> = { ok: true; value: T } | { ok: false; response: Response }

async function parseAndValidateRequest(
  req: Request
): Promise<StageResult<InsightRequestBody>> {
  const contentLengthHeader = req.headers.get('content-length')
  if (contentLengthHeader && Number(contentLengthHeader) > MAX_BODY_BYTES) {
    return { ok: false, response: jsonResponse({ success: false, error: 'payload_too_large' }, 413) }
  }

  const rawBody = await req.text()
  if (new TextEncoder().encode(rawBody).length > MAX_BODY_BYTES) {
    return { ok: false, response: jsonResponse({ success: false, error: 'payload_too_large' }, 413) }
  }

  let parsed: unknown
  try {
    parsed = rawBody.length > 0 ? JSON.parse(rawBody) : {}
  } catch {
    return { ok: false, response: jsonResponse({ success: false, error: 'invalid_request' }, 400) }
  }

  const validation = validateBody(parsed)
  if (!validation.ok) {
    return { ok: false, response: jsonResponse({ success: false, error: validation.error }, 400) }
  }
  return { ok: true, value: validation.body }
}

async function authenticate(
  req: Request,
  deps: HandleRequestDeps,
  requestId: string | undefined
): Promise<StageResult<{ userClient: AuthUserClient; user: { id: string } }>> {
  const authHeader = req.headers.get('Authorization')
  if (!authHeader) {
    return { ok: false, response: jsonResponse({ success: false, error: 'not_authenticated', requestId }, 401) }
  }

  // Request-bound client: carries the caller's own JWT, used exclusively
  // for identity, org-membership, and permission resolution. Never used for
  // the quota RPC below — that RPC is service_role-only by design.
  const userClient = deps.createUserClient(authHeader)

  const { data: authData, error: authError } = await userClient.auth.getUser()
  if (authError || !authData?.user) {
    return { ok: false, response: jsonResponse({ success: false, error: 'not_authenticated', requestId }, 401) }
  }
  return { ok: true, value: { userClient, user: authData.user } }
}

async function authorize(
  userClient: AuthUserClient,
  userId: string,
  requestId: string | undefined
): Promise<StageResult<{ orgId: string }>> {
  const { data: orgId, error: orgError } = await userClient.rpc('wardah_org_id')
  if (orgError) {
    console.error('reports-insights: wardah_org_id failed', {
      requestId,
      user_id: userId,
      message: orgError.message,
    })
    return { ok: false, response: jsonResponse({ success: false, error: 'internal_error', requestId }, 500) }
  }
  if (!orgId) {
    return { ok: false, response: jsonResponse({ success: false, error: 'forbidden', requestId }, 403) }
  }

  const { data: hasPerm, error: permError } = await userClient.rpc('has_permission', {
    p_user_id: userId,
    p_org_id: orgId,
    p_permission_key: PERMISSION_KEY,
  })
  if (permError) {
    console.error('reports-insights: has_permission failed', {
      requestId,
      user_id: userId,
      org_id: orgId,
      message: permError.message,
    })
    return { ok: false, response: jsonResponse({ success: false, error: 'internal_error', requestId }, 500) }
  }
  if (!hasPerm) {
    return { ok: false, response: jsonResponse({ success: false, error: 'forbidden', requestId }, 403) }
  }

  return { ok: true, value: { orgId: orgId as string } }
}

async function checkQuota(
  deps: HandleRequestDeps,
  orgId: string,
  userId: string,
  operation: InsightOperation,
  requestId: string | undefined
): Promise<StageResult<void>> {
  // Separate admin client, service_role-keyed, used only for the quota RPC —
  // kept apart from userClient so a bug can never call the quota RPC with
  // the wrong credential, or a user-scoped lookup with elevated privileges.
  const adminClient = deps.createAdminClient()

  const { data: quotaRows, error: quotaError } = await adminClient.rpc('rpc_check_and_record_ai_usage', {
    p_org_id: orgId,
    p_user_id: userId,
  })
  if (quotaError) {
    console.error('reports-insights: rpc_check_and_record_ai_usage failed', {
      requestId,
      user_id: userId,
      org_id: orgId,
      message: quotaError.message,
    })
    return { ok: false, response: jsonResponse({ success: false, error: 'internal_error', requestId }, 500) }
  }
  const quota = Array.isArray(quotaRows) ? quotaRows[0] : quotaRows
  if (!(quota as { allowed?: boolean } | undefined)?.allowed) {
    console.log('reports-insights: quota_exceeded', {
      requestId,
      user_id: userId,
      org_id: orgId,
      operation,
    })
    return { ok: false, response: jsonResponse({ success: false, error: 'quota_exceeded', requestId }, 429) }
  }

  return { ok: true, value: undefined }
}

async function runProvider(
  deps: HandleRequestDeps,
  body: InsightRequestBody,
  userId: string,
  orgId: string,
  startedAt: number
): Promise<Response> {
  const requestId = body.requestId
  const systemPrompt = buildSystemPrompt(body.locale)
  const userPrompt = buildUserPrompt(body)

  let providerResult: ProviderResult
  try {
    providerResult = await deps.callProvider(systemPrompt, userPrompt)
  } catch (err) {
    console.error('reports-insights: provider call raised', {
      requestId,
      user_id: userId,
      org_id: orgId,
      operation: body.operation,
      message: err instanceof Error ? err.message : String(err),
    })
    return jsonResponse({ success: false, error: 'internal_error', requestId }, 500)
  }

  const durationMs = Date.now() - startedAt

  if (providerResult.kind === 'unavailable') {
    console.log('reports-insights: provider_unavailable', {
      requestId,
      user_id: userId,
      org_id: orgId,
      operation: body.operation,
      reason: providerResult.reason,
      durationMs,
    })
    return jsonResponse({ success: false, error: 'provider_unavailable', source: 'fallback', requestId }, 200)
  }

  console.log('reports-insights: ok', {
    requestId,
    user_id: userId,
    org_id: orgId,
    operation: body.operation,
    source: 'ai',
    durationMs,
  })
  return jsonResponse({ success: true, source: 'ai', text: providerResult.text, requestId }, 200)
}

export async function handleRequest(req: Request, deps: HandleRequestDeps = defaultDeps): Promise<Response> {
  const startedAt = Date.now()

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  if (req.method !== 'POST') {
    return jsonResponse({ success: false, error: 'method_not_allowed' }, 405)
  }

  const parsed = await parseAndValidateRequest(req)
  if (!parsed.ok) return parsed.response
  const body = parsed.value
  const requestId = body.requestId

  const authResult = await authenticate(req, deps, requestId)
  if (!authResult.ok) return authResult.response
  const { userClient, user } = authResult.value

  const authzResult = await authorize(userClient, user.id, requestId)
  if (!authzResult.ok) return authzResult.response
  const { orgId } = authzResult.value

  const quotaResult = await checkQuota(deps, orgId, user.id, body.operation, requestId)
  if (!quotaResult.ok) return quotaResult.response

  return runProvider(deps, body, user.id, orgId, startedAt)
}

// Guarded so importing this module from a test (index.test.ts) never binds
// a network listener — Deno only runs this when the file is the entry
// point, not when it's imported.
if (import.meta.main) {
  serve((req) => handleRequest(req))
}
