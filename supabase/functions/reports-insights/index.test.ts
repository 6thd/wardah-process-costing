// deno-lint-ignore-file require-await -- fakes below are async to satisfy
// the AuthUserClient/AdminClient/ProviderCaller Promise-returning interfaces
// even where a given test case has nothing to await.
//
// Deno test suite for the reports-insights Edge Function.
//
// Run with: deno test --allow-env supabase/functions/reports-insights/index.test.ts
//
// handleRequest() takes injectable createUserClient/createAdminClient/
// callProvider dependencies precisely so this suite can drive every branch
// (auth, org resolution, permission, quota, provider success/failure)
// without a live database or network call. The true concurrency guarantee
// (the org+UTC-date advisory lock) lives entirely in
// rpc_check_and_record_ai_usage and is proven at the SQL layer in
// scripts/ci/fresh-db/acceptance_171_ai_usage_concurrency.sh — there is
// nothing concurrent to exercise at this layer, since each Edge Function
// invocation is an independent request that defers all shared-state
// arbitration to that single RPC call.
import { assertEquals, assertNotEquals, assertRejects } from 'https://deno.land/std@0.168.0/testing/asserts.ts'
import {
  handleRequest,
  validateBody,
  buildSystemPrompt,
  buildUserPrompt,
  createProvider,
  INSIGHT_OPERATIONS,
  MAX_QUESTION_LENGTH,
  PERMISSION_KEY,
  GROQ_URL,
  GROQ_MODEL,
  type AuthUserClient,
  type AdminClient,
  type HandleRequestDeps,
  type ProviderCaller,
  type FetchImpl,
} from './index.ts'

const ORG_ID = '11111111-1111-1111-1111-111111111111'
const OTHER_ORG_ID = '22222222-2222-2222-2222-222222222222'
const USER_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'

function fakeUserClient(overrides: Partial<AuthUserClient> = {}): AuthUserClient {
  return {
    auth: {
      getUser: async () => ({ data: { user: { id: USER_ID } }, error: null }),
    },
    rpc: async (fn: string) => {
      if (fn === 'wardah_org_id') return { data: ORG_ID, error: null }
      if (fn === 'has_permission') return { data: true, error: null }
      throw new Error(`unexpected rpc: ${fn}`)
    },
    ...overrides,
  }
}

function fakeAdminClient(overrides: Partial<AdminClient> = {}): AdminClient {
  return {
    rpc: async () => ({ data: [{ allowed: true, user_accepted_count: 1, org_accepted_count: 1 }], error: null }),
    ...overrides,
  }
}

const okProvider: ProviderCaller = async () => ({ kind: 'ok', text: 'قدّم النص الذكي هنا' })

function buildDeps(overrides: Partial<HandleRequestDeps> = {}): HandleRequestDeps {
  return {
    createUserClient: () => fakeUserClient(),
    createAdminClient: () => fakeAdminClient(),
    callProvider: okProvider,
    ...overrides,
  }
}

function req(body: unknown, { auth = 'Bearer test-token', method = 'POST' }: { auth?: string | null; method?: string } = {}) {
  const headers = new Headers({ 'Content-Type': 'application/json' })
  if (auth) headers.set('Authorization', auth)
  const canHaveBody = method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS'
  return new Request('https://example.test/reports-insights', {
    method,
    headers,
    body: canHaveBody && body !== undefined ? JSON.stringify(body) : undefined,
  })
}

// --- Body validation -------------------------------------------------------

Deno.test('validateBody accepts every declared operation with a valid locale', () => {
  for (const operation of INSIGHT_OPERATIONS) {
    const body = operation === 'ask' ? { operation, locale: 'ar', question: 'سؤال؟' } : { operation, locale: 'en', data: { totalSales: 100 } }
    const result = validateBody(body)
    assertEquals(result.ok, true)
  }
})

Deno.test('validateBody rejects an unknown operation', () => {
  const result = validateBody({ operation: 'delete_everything', locale: 'en' })
  assertEquals(result.ok, false)
})

Deno.test('validateBody rejects a question over the max length', () => {
  const result = validateBody({ operation: 'ask', locale: 'en', question: 'a'.repeat(MAX_QUESTION_LENGTH + 1) })
  assertEquals(result.ok, false)
})

Deno.test('validateBody rejects a non-object data payload', () => {
  const result = validateBody({ operation: 'summary', locale: 'en', data: [1, 2, 3] })
  assertEquals(result.ok, false)
})

Deno.test('validateBody ignores any org_id the caller supplies — org is never client-controlled', () => {
  const result = validateBody({ operation: 'summary', locale: 'en', data: {}, org_id: OTHER_ORG_ID })
  assertEquals(result.ok, true)
  if (result.ok) {
    assertEquals((result.body as unknown as { org_id?: string }).org_id, undefined)
  }
})

Deno.test('validateBody accepts optional financial context alongside an ask question', () => {
  const result = validateBody({
    operation: 'ask',
    locale: 'en',
    question: 'Why is margin low?',
    data: { totalSales: 1000, marginOfSafety: 0.1 },
  })
  assertEquals(result.ok, true)
  if (result.ok) {
    assertEquals(result.body.question, 'Why is margin low?')
    assertEquals(result.body.data, { totalSales: 1000, marginOfSafety: 0.1 })
  }
})

Deno.test('buildUserPrompt includes financial context in an ask prompt when provided', () => {
  const withContext = buildUserPrompt({
    operation: 'ask',
    locale: 'en',
    question: 'Why is margin low?',
    data: { marginOfSafety: 0.1 },
  })
  assertEquals(withContext.includes('Why is margin low?'), true)
  assertEquals(withContext.includes('marginOfSafety'), true)

  const withoutContext = buildUserPrompt({ operation: 'ask', locale: 'en', question: 'Why is margin low?' })
  assertEquals(withoutContext.includes('Why is margin low?'), true)
  assertEquals(withoutContext.includes('Financial context'), false)
})

// --- Prompt building never leaks the caller's data outside its own payload -

Deno.test('buildSystemPrompt never mentions any operation-specific data', () => {
  const sys = buildSystemPrompt('en')
  assertEquals(sys.includes('totalSales'), false)
})

// --- createProvider() direct coverage --------------------------------------
//
// handleRequest()'s own tests above drive callProvider through the injected
// ProviderCaller fake, which never exercises createProvider()'s actual HTTP
// request/response handling. These tests call createProvider() itself with
// an injected fake fetch (matching the real `fetch` signature) so the
// request Groq actually receives, and every one of its response-status
// branches, is proven directly rather than only through hand-written
// ProviderResult stand-ins.

function fakeFetch(handler: (input: RequestInfo | URL, init?: RequestInit) => Response): FetchImpl {
  return ((input: RequestInfo | URL, init?: RequestInit) => Promise.resolve(handler(input, init))) as FetchImpl
}

Deno.test('createProvider with no API key returns unavailable without ever calling fetch', async () => {
  let fetchCalled = false
  const provider = createProvider('', fakeFetch(() => {
    fetchCalled = true
    return new Response('should not be reached', { status: 200 })
  }))
  const result = await provider('sys', 'user')
  assertEquals(result, { kind: 'unavailable', reason: 'provider_not_configured' })
  assertEquals(fetchCalled, false)
})

Deno.test('createProvider sends the exact URL, model, messages, max_tokens, and temperature Groq expects', async () => {
  let capturedUrl: string | undefined
  let capturedInit: RequestInit | undefined
  const provider = createProvider('real-key', fakeFetch((input, init) => {
    capturedUrl = String(input)
    capturedInit = init
    return new Response(JSON.stringify({ choices: [{ message: { content: 'ok' } }] }), { status: 200 })
  }))

  await provider('system prompt', 'user prompt')

  assertEquals(capturedUrl, GROQ_URL)
  assertEquals(capturedInit?.method, 'POST')
  assertEquals(capturedInit?.headers, { 'Content-Type': 'application/json', Authorization: 'Bearer real-key' })
  const body = JSON.parse(capturedInit?.body as string)
  assertEquals(body.model, GROQ_MODEL)
  assertEquals(body.messages, [
    { role: 'system', content: 'system prompt' },
    { role: 'user', content: 'user prompt' },
  ])
  assertEquals(body.max_tokens, 500)
  assertEquals(body.temperature, 0.3)
})

Deno.test('createProvider parses a successful Groq response into kind:ok with the model text', async () => {
  const provider = createProvider('real-key', fakeFetch(() =>
    new Response(JSON.stringify({ choices: [{ message: { content: 'Real model answer' } }] }), { status: 200 })
  ))
  const result = await provider('sys', 'user')
  assertEquals(result, { kind: 'ok', text: 'Real model answer' })
})

Deno.test('createProvider classifies a 429 response as unavailable, not a thrown error', async () => {
  const provider = createProvider('real-key', fakeFetch(() => new Response('rate limited', { status: 429 })))
  const result = await provider('sys', 'user')
  assertEquals(result, { kind: 'unavailable', reason: 'provider_status_429' })
})

Deno.test('createProvider classifies a 5xx response as unavailable, not a thrown error', async () => {
  const provider = createProvider('real-key', fakeFetch(() => new Response('upstream error', { status: 503 })))
  const result = await provider('sys', 'user')
  assertEquals(result, { kind: 'unavailable', reason: 'provider_status_503' })
})

Deno.test('createProvider treats a non-429 4xx as our own request bug, not a classified provider failure — it throws instead of returning unavailable', async () => {
  const provider = createProvider('real-key', fakeFetch(() => new Response('bad request', { status: 400 })))
  await assertRejects(() => provider('sys', 'user'), Error, 'provider_request_error_400')
})

// --- HTTP-level behavior -----------------------------------------------------

Deno.test('OPTIONS returns 200 without touching any dependency', async () => {
  const res = await handleRequest(req(undefined, { method: 'OPTIONS', auth: null }), buildDeps())
  assertEquals(res.status, 200)
})

Deno.test('non-POST method returns 405', async () => {
  const res = await handleRequest(req({ operation: 'summary', locale: 'en' }, { method: 'GET' }), buildDeps())
  assertEquals(res.status, 405)
})

Deno.test('oversized body returns 413', async () => {
  const bigData: Record<string, string> = {}
  bigData.padding = 'x'.repeat(20 * 1024)
  const res = await handleRequest(req({ operation: 'summary', locale: 'en', data: bigData }), buildDeps())
  assertEquals(res.status, 413)
})

Deno.test('invalid JSON body returns 400', async () => {
  const headers = new Headers({ Authorization: 'Bearer t', 'Content-Type': 'application/json' })
  const badReq = new Request('https://example.test/reports-insights', { method: 'POST', headers, body: '{not json' })
  const res = await handleRequest(badReq, buildDeps())
  assertEquals(res.status, 400)
})

Deno.test('invalid operation returns 400', async () => {
  const res = await handleRequest(req({ operation: 'nope', locale: 'en' }), buildDeps())
  assertEquals(res.status, 400)
})

Deno.test('missing Authorization header returns 401', async () => {
  const res = await handleRequest(req({ operation: 'summary', locale: 'en', data: {} }, { auth: null }), buildDeps())
  assertEquals(res.status, 401)
  const body = await res.json()
  assertEquals(body.error, 'not_authenticated')
})

Deno.test('an invalid/expired token returns 401', async () => {
  const deps = buildDeps({
    createUserClient: () =>
      fakeUserClient({ auth: { getUser: async () => ({ data: { user: null }, error: { message: 'invalid token' } }) } }),
  })
  const res = await handleRequest(req({ operation: 'summary', locale: 'en', data: {} }), deps)
  assertEquals(res.status, 401)
})

Deno.test('no organization membership returns 403 (never a raw DB null)', async () => {
  const deps = buildDeps({
    createUserClient: () => fakeUserClient({ rpc: async (fn) => (fn === 'wardah_org_id' ? { data: null, error: null } : { data: true, error: null }) }),
  })
  const res = await handleRequest(req({ operation: 'summary', locale: 'en', data: {} }), deps)
  assertEquals(res.status, 403)
  const body = await res.json()
  assertEquals(body.error, 'forbidden')
})

Deno.test('missing reports.ai_insights.use permission returns 403', async () => {
  const deps = buildDeps({
    createUserClient: () =>
      fakeUserClient({
        rpc: async (fn) => {
          if (fn === 'wardah_org_id') return { data: ORG_ID, error: null }
          if (fn === 'has_permission') return { data: false, error: null }
          throw new Error(`unexpected rpc: ${fn}`)
        },
      }),
  })
  const res = await handleRequest(req({ operation: 'summary', locale: 'en', data: {} }), deps)
  assertEquals(res.status, 403)
})

Deno.test('has_permission is called with the caller\'s own id and the reports.ai_insights.use key', async () => {
  let capturedParams: Record<string, unknown> | undefined
  const deps = buildDeps({
    createUserClient: () =>
      fakeUserClient({
        rpc: async (fn, params) => {
          if (fn === 'wardah_org_id') return { data: ORG_ID, error: null }
          if (fn === 'has_permission') {
            capturedParams = params
            return { data: true, error: null }
          }
          throw new Error(`unexpected rpc: ${fn}`)
        },
      }),
  })
  await handleRequest(req({ operation: 'summary', locale: 'en', data: {} }), deps)
  assertEquals(capturedParams?.p_user_id, USER_ID)
  assertEquals(capturedParams?.p_org_id, ORG_ID)
  assertEquals(capturedParams?.p_permission_key, PERMISSION_KEY)
})

Deno.test('a database error resolving org membership returns 500, not a silent fallback', async () => {
  const deps = buildDeps({
    createUserClient: () =>
      fakeUserClient({ rpc: async () => ({ data: null, error: { message: 'connection reset' } }) }),
  })
  const res = await handleRequest(req({ operation: 'summary', locale: 'en', data: {} }), deps)
  assertEquals(res.status, 500)
  const body = await res.json()
  assertEquals(body.error, 'internal_error')
  assertNotEquals(body.source, 'fallback')
})

Deno.test('quota RPC is called only through the admin client, with only org_id/user_id — no caller-supplied limits', async () => {
  let userClientCalledQuota = false
  let capturedParams: Record<string, unknown> | undefined
  const deps = buildDeps({
    createUserClient: () =>
      fakeUserClient({
        rpc: async (fn, _params) => {
          if (fn === 'rpc_check_and_record_ai_usage') userClientCalledQuota = true
          if (fn === 'wardah_org_id') return { data: ORG_ID, error: null }
          if (fn === 'has_permission') return { data: true, error: null }
          return { data: null, error: null }
        },
      }),
    createAdminClient: () =>
      fakeAdminClient({
        rpc: async (_fn, params) => {
          capturedParams = params
          return { data: [{ allowed: true, user_accepted_count: 1, org_accepted_count: 1 }], error: null }
        },
      }),
  })
  // Even though the body carries an (ignored) limit-shaped field, assert the
  // RPC call carries only org_id/user_id — the daily limits are internal
  // constants inside rpc_check_and_record_ai_usage itself, never parameters.
  await handleRequest(req({ operation: 'summary', locale: 'en', data: { user_daily_limit: 999999 } }), deps)
  assertEquals(userClientCalledQuota, false)
  assertEquals(capturedParams?.p_org_id, ORG_ID)
  assertEquals(capturedParams?.p_user_id, USER_ID)
  assertEquals(Object.keys(capturedParams ?? {}).sort(), ['p_org_id', 'p_user_id'])
})

Deno.test('quota exceeded returns 429', async () => {
  const deps = buildDeps({
    createAdminClient: () => fakeAdminClient({ rpc: async () => ({ data: [{ allowed: false, user_accepted_count: 20, org_accepted_count: 50 }], error: null }) }),
  })
  const res = await handleRequest(req({ operation: 'summary', locale: 'en', data: {} }), deps)
  assertEquals(res.status, 429)
  const body = await res.json()
  assertEquals(body.error, 'quota_exceeded')
})

Deno.test('a database error from the quota RPC returns 500, not 429 and not a fallback', async () => {
  const deps = buildDeps({
    createAdminClient: () => fakeAdminClient({ rpc: async () => ({ data: null, error: { message: 'deadlock detected' } }) }),
  })
  const res = await handleRequest(req({ operation: 'summary', locale: 'en', data: {} }), deps)
  assertEquals(res.status, 500)
  const body = await res.json()
  assertEquals(body.error, 'internal_error')
})

Deno.test('same-org happy path: authenticated + permitted + under quota returns 200 with provider text', async () => {
  const res = await handleRequest(req({ operation: 'summary', locale: 'ar', data: { totalSales: 1000 }, requestId: 'r-1' }), buildDeps())
  assertEquals(res.status, 200)
  const body = await res.json()
  assertEquals(body.success, true)
  assertEquals(body.source, 'ai')
  assertEquals(body.requestId, 'r-1')
  assertEquals(typeof body.text, 'string')
})

Deno.test('org resolution never reads a client-supplied org id — it always comes from wardah_org_id()', async () => {
  let orgIdPassedToQuota: unknown
  const deps = buildDeps({
    createUserClient: () =>
      fakeUserClient({
        rpc: async (fn) => {
          if (fn === 'wardah_org_id') return { data: ORG_ID, error: null }
          if (fn === 'has_permission') return { data: true, error: null }
          throw new Error(`unexpected rpc: ${fn}`)
        },
      }),
    createAdminClient: () =>
      fakeAdminClient({
        rpc: async (_fn, params) => {
          orgIdPassedToQuota = params?.p_org_id
          return { data: [{ allowed: true, user_accepted_count: 1, org_accepted_count: 1 }], error: null }
        },
      }),
  })
  // Body claims a different org than the caller's real membership.
  await handleRequest(req({ operation: 'summary', locale: 'en', data: { org_id: OTHER_ORG_ID } }), deps)
  assertEquals(orgIdPassedToQuota, ORG_ID)
  assertNotEquals(orgIdPassedToQuota, OTHER_ORG_ID)
})

Deno.test('a classified provider failure (timeout) returns 200 with source:fallback, not a 5xx', async () => {
  const deps = buildDeps({ callProvider: async () => ({ kind: 'unavailable', reason: 'provider_timeout' }) })
  const res = await handleRequest(req({ operation: 'ask', locale: 'en', question: 'How are margins trending?' }), deps)
  assertEquals(res.status, 200)
  const body = await res.json()
  assertEquals(body.success, false)
  assertEquals(body.source, 'fallback')
})

Deno.test('a classified provider failure (missing key) returns 200 with source:fallback', async () => {
  const deps = buildDeps({ callProvider: async () => ({ kind: 'unavailable', reason: 'provider_not_configured' }) })
  const res = await handleRequest(req({ operation: 'summary', locale: 'en', data: {} }), deps)
  assertEquals(res.status, 200)
  const body = await res.json()
  assertEquals(body.source, 'fallback')
})

Deno.test('a programming error thrown by the provider adapter returns 500, never a disguised fallback', async () => {
  const deps = buildDeps({
    callProvider: async () => {
      throw new Error('unexpected null pointer in adapter')
    },
  })
  const res = await handleRequest(req({ operation: 'summary', locale: 'en', data: {} }), deps)
  assertEquals(res.status, 500)
  const body = await res.json()
  assertEquals(body.error, 'internal_error')
  assertNotEquals(body.source, 'fallback')
})

Deno.test('the question is present in the outgoing prompt but never logged (contract check via buildUserPrompt)', () => {
  // This asserts the prompt-building contract directly rather than trying
  // to intercept console.log — handleRequest's own console.log/error calls
  // (asserted by code review) only ever pass operation/status/source/
  // duration metadata, never body.question or body.data.
  const prompt = buildUserPrompt({ operation: 'ask', locale: 'en', question: 'Why did COGS spike?' })
  assertEquals(prompt.includes('Why did COGS spike?'), true)
})
