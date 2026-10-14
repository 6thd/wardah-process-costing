import assert from 'node:assert/strict'
import { test } from 'node:test'
import { checkJreAccess } from './check-sonar-jre-access.mjs'

test('missing token rejects before making a request', async () => {
  let called = false
  await assert.rejects(checkJreAccess('', () => { called = true }), /SONAR_TOKEN_MISSING/)
  assert.equal(called, false)
})

test('success uses fixed endpoint, bearer auth and rejects redirects', async () => {
  const result = await checkJreAccess('synthetic-test-token', async (url, options) => {
    assert.equal(url, 'https://api.sonarcloud.io/analysis/jres?os=linux&arch=x86_64')
    assert.equal(options.headers.Authorization, 'Bearer synthetic-test-token')
    assert.equal(options.redirect, 'error')
    assert.ok(options.signal instanceof AbortSignal)
    return { status: 200 }
  })
  assert.equal(result, 'SONAR_JRE_ACCESS_HTTP_200')
})

for (const status of [401, 403, 429, 500]) {
  test(`HTTP ${status} fails with status only`, async () => {
    await assert.rejects(checkJreAccess('synthetic-test-token', async () => ({ status })),
      { message: `SONAR_JRE_ACCESS_HTTP_${status}` })
  })
}

test('network exception is sanitized rather than exposing request details', async () => {
  await assert.rejects(checkJreAccess('synthetic-test-token', async () => {
    throw new Error('request metadata with synthetic-test-token')
  }), { message: 'SONAR_JRE_ACCESS_NETWORK_ERROR' })
})
