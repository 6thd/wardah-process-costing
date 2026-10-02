import { chromium, expect } from '@playwright/test'
import { verifyParentVersionProfiles } from './parent-version.mjs'
if (process.env.WARDAH_PARENT_VERSION_198 !== 'true') throw new Error('M198_FIXTURE_REQUIRED')
const browser = await chromium.launch({ executablePath: process.env.WARDAH_BROWSER_EXECUTABLE || undefined,
  headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] })
const ids = { product: 'ed000000-0000-4000-8000-0000000000c2', center: 'ed000000-0000-4000-8000-0000000000f2',
  stage: 'ed000000-0000-4000-8000-0000000000f1', item: 'ed000000-0000-4000-8000-0000000000d1' }
const errors = []; let expectedDenial = false; const realAuth = process.env.WARDAH_REAL_AUTH === 'true'; const rpcRequests = []; const setupRequests = []; const expectedFaults = new Set()
const state = page => page.evaluate(async () => (await fetch('/state')).json())
const financial = snapshot => Object.fromEntries(Object.entries(snapshot).filter(([key]) => key !== 'trace'))
const setup = page => page.getByRole('region', { name: 'Prepare material issue', exact: true })
async function contextPage() {
  const context = await browser.newContext()
  await context.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort())
  const page = await context.newPage()
  page.on('request', request => { if (realAuth && request.url().endsWith('/rpc/rpc_consume_material_event')) rpcRequests.push({ name: 'rpc_consume_material_event', args: request.postDataJSON() }) })
  page.on('request', request => { if (realAuth && request.url().endsWith('/rpc/rpc_manage_material_issue_setup')) setupRequests.push({ name: 'rpc_manage_material_issue_setup', args: request.postDataJSON() }) })
  page.on('pageerror', e => errors.push(e.message))
  page.on('console', e => { if (e.type() === 'error' && !((expectedDenial || expectedFaults.has(e.location().url)) && e.text().startsWith('Failed to load resource:'))) errors.push(e.text()) })
  await page.goto('http://127.0.0.1:4177')
  if (realAuth) {
    await page.route('**/rest/v1/rpc/rpc_consume_material_event', async route => {
      const lost = await page.evaluate(() => localStorage.getItem('operator:lose-issue') === 'true')
      if (lost) {
        await page.evaluate(() => localStorage.removeItem('operator:lose-issue'))
        const response = await route.fetch(); expect(response.ok()).toBe(true)
        expectedFaults.add(route.request().url()); await route.abort('failed')
      } else await route.continue()
    })
    await page.route('**/rest/v1/rpc/rpc_manage_material_issue_setup', async route => {
      const lost = await page.evaluate(() => localStorage.getItem('operator:drop-setup-before-call') === 'true')
      if (lost) {
        await page.evaluate(() => localStorage.removeItem('operator:drop-setup-before-call'))
        expectedFaults.add(route.request().url()); await route.abort('failed')
      } else if (await page.evaluate(() => localStorage.getItem('operator:lose-setup-after-commit') === 'true')) {
        await page.evaluate(() => localStorage.removeItem('operator:lose-setup-after-commit'))
        const response = await route.fetch(); expect(response.ok()).toBe(true)
        expectedFaults.add(route.request().url()); await route.abort('failed')
      } else await route.continue()
    })
    await page.getByLabel('Local fixture email').fill('mfg-red-consumer@example.test')
    await page.getByLabel('Local fixture password').fill(process.env.WARDAH_AUTH_PASSWORD)
    await page.getByRole('button', { name: 'Sign in locally', exact: true }).click()
    await expect(page.getByText('Verified local Auth actor:', { exact: false })).toContainText('ed000000-0000-4000-8000-0000000000a2')
    await expect(page.getByLabel('Manufacturing order', { exact: true })).toBeEnabled()
  }
  return { context, page }
}
async function open(page, mo) {
  await setup(page).getByRole('button', { name: 'Prepare material issue', exact: true }).click()
  await expect(setup(page).getByLabel('Preparation order', { exact: true })).toBeEnabled()
  if (mo) await setup(page).getByLabel('Preparation order', { exact: true }).selectOption(mo)
}
async function act(page, name) {
  await setup(page).getByRole('button', { name, exact: true }).click()
  await expect(setup(page).getByLabel('Preparation order', { exact: true })).toBeEnabled()
}
try {
  const { context, page } = await contextPage(); console.log('OPERATOR_STEP=initial_page')
  const initial = await state(page)
  await open(page)
  await setup(page).getByLabel('Order product', { exact: true }).selectOption(ids.product)
  await setup(page).getByLabel('New order number', { exact: true }).fill('MO-OPERATOR-COMBINED')
  await setup(page).getByLabel('Planned order quantity', { exact: true }).fill('5')
  await act(page, 'Create draft order')
  const created = await state(page)
  const mo = created.manufacturing_orders.find(r => r.order_number === 'MO-OPERATOR-COMBINED')
  console.log('OPERATOR_STEP=draft_created'); expect(mo.status).toBe('draft'); expect(mo.item_id).toBeNull()
  for (const status of ['confirmed', 'in_progress']) {
    await setup(page).getByLabel('New order status', { exact: true }).selectOption(status)
    await act(page, 'Save order status')
  }
  await setup(page).getByLabel('Work center', { exact: true }).selectOption(ids.center)
  await setup(page).getByLabel('Operation name', { exact: true }).fill('Manual issue preparation')
  await setup(page).getByLabel('Planned operation quantity', { exact: true }).fill('5')
  await act(page, 'Create manual work order')
  const withWO = await state(page); const wo = withWO.work_orders.find(r => r.mo_id === mo.id)
  expect(wo.status).toBe('READY')
  await setup(page).getByLabel('Preparation work order', { exact: true }).selectOption(wo.id)
  await setup(page).getByLabel('New work order status', { exact: true }).selectOption('IN_PROGRESS')
  await act(page, 'Save work order eligibility')
  await setup(page).getByLabel('Reservation item', { exact: true }).selectOption(ids.item)
  await setup(page).getByLabel('New reservation quantity', { exact: true }).fill('20')
  await act(page, 'Reserve material')
  const reserved = await state(page); const res = reserved.material_reservations.find(r => r.mo_id === mo.id)
  expect(res.quantity_reserved).toBe(20)
  await setup(page).getByLabel('Reservation to maintain', { exact: true }).selectOption(res.id)
  await setup(page).getByLabel('Resize total or release quantity', { exact: true }).fill('25')
  await act(page, 'Resize pristine reservation')
  expect((await state(page)).material_reservations.find(r => r.id === res.id).quantity_reserved).toBe(25)
  await setup(page).getByRole('button', { name: 'Open pristine stage record', exact: true }).click()
  const form = page.getByRole('dialog'); const selectors = form.getByRole('combobox')
  await selectors.nth(0).click(); await page.getByRole('option', { name: 'MO-OPERATOR-COMBINED', exact: true }).click()
  await selectors.nth(1).click()
  // The fixture stage label comes from the real org-scoped SELECT.
  const options = page.getByRole('option'); await options.first().click()
  await expect(form.getByLabel('تكلفة العمل')).toHaveCount(0)
  await form.getByRole('button', { name: 'حفظ', exact: true }).click(); await expect(form).toHaveCount(0)
  console.log('OPERATOR_STEP=wip_opened'); const prepared = await state(page); const wip = prepared.stage_wip_log.find(r => r.mo_id === mo.id)
  expect(wip.cost_material).toBe(0)
  for (const table of ['bins', 'stock_ledger_entries', 'material_consumption', 'gl_entries', 'gl_entry_lines', 'journal_entries', 'journal_lines']) {
    expect(prepared[table]).toEqual(initial[table])
  }
  await page.reload(); await page.getByLabel('Manufacturing order', { exact: true }).selectOption(mo.id)
  await expect(page.getByLabel('Reserved material 1')).toBeEnabled()
  const ctx = realAuth ? await page.evaluate(id => window.__fixtureReadIssueContext(id), mo.id) : await page.evaluate(async id => (await fetch('/call', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ kind: 'rpc', name: 'rpc_get_material_issue_context', args: { p_mo_id: id } }) })).json(), mo.id)
  for (const [label, value] of [['Stage', wip.stage_id], ['Reserved material 1', res.id], ['Work order 1', wo.id],
    ['Warehouse 1', ctx.data.warehouses.find(r => r.product_ids.includes(res.product_id)).id], ['Base unit 1', res.uom_id]]) {
    await page.getByLabel(label, { exact: true }).selectOption(value)
  }
  await page.getByLabel('Quantity 1', { exact: true }).fill('10')
  await page.evaluate(() => localStorage.setItem('operator:lose-issue', 'true'))
  await page.getByRole('button', { name: 'Issue materials', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Retry saved event', exact: true })).toBeEnabled()
  console.log('OPERATOR_STEP=committed_lost_response'); const posted = await state(page)
  expect(posted.material_consumption.filter(r => r.mo_id === mo.id)).toHaveLength(1)
  expect(posted.stage_wip_log.find(r => r.id === wip.id).cost_material).toBe(100)
  expect(posted.material_reservations.find(r => r.id === res.id).quantity_consumed).toBe(10)
  const receipt = posted.events.find(r => r.mo_id === mo.id)
  expect(receipt).toBeTruthy(); expect(posted.events.filter(r => r.mo_id === mo.id)).toHaveLength(1)
  expect(posted.stock_ledger_entries.length - prepared.stock_ledger_entries.length).toBe(1)
  const onHand = rows => rows.filter(r => r.product_id === res.product_id).reduce((n, r) => n + Number(r.actual_qty), 0)
  expect(onHand(prepared.bins) - onHand(posted.bins)).toBe(10)
  await page.reload(); await page.getByLabel('Manufacturing order', { exact: true }).selectOption(mo.id)
  await page.getByRole('button', { name: 'Retry saved event', exact: true }).click()
  await expect(page.getByText('Issue confirmed. Receipt:', { exact: false })).toBeVisible()
  await expect(page.getByRole('status').filter({ hasText: 'Issue confirmed. Receipt:' }).locator('code')).toHaveText(receipt.event_id)
  const replayed = await state(page); expect(financial(replayed)).toEqual(financial(posted))
  const calls = (realAuth ? rpcRequests : replayed.trace).filter(r => r.name === 'rpc_consume_material_event')
  expect(calls).toHaveLength(2); expect(calls[1].args).toEqual(calls[0].args)
  console.log('OPERATOR_STEP=receipt_replayed'); await open(page, mo.id)
  // Two separate browser profiles share a real server actor, not IndexedDB.
  // A lost-before-send intent keeps its immutable old version; another device advances it.
  console.log('OPERATOR_STEP=second_profile'); const other = await contextPage(); await open(other.page, mo.id)
  await setup(page).getByLabel('Preparation work order', { exact: true }).selectOption(wo.id)
  await setup(page).getByLabel('New work order status', { exact: true }).selectOption('ON_HOLD')
  await page.evaluate(() => localStorage.setItem('operator:drop-setup-before-call', 'true'))
  await act(page, 'Save work order eligibility')
  await expect(setup(page).getByRole('alert')).toContainText('saved request')
  await setup(other.page).getByLabel('Preparation work order', { exact: true }).selectOption(wo.id)
  await setup(other.page).getByLabel('New work order status', { exact: true }).selectOption('READY')
  await act(other.page, 'Save work order eligibility')
  const advanced = await state(page)
  expectedDenial = true
  const staleResponse = realAuth ? page.waitForResponse(response => response.url().endsWith('/rpc/rpc_manage_material_issue_setup'), { timeout: 5000 }) : null
  await setup(page).getByRole('button', { name: 'Retry selected order preparation', exact: true }).click()
  if (staleResponse) {
    const response = await staleResponse
    expect(response.status()).toBe(400)
    const rejection = await response.json()
    expect(rejection.code).toBe('P0001'); expect(rejection.message).toBe('ISSUE_SETUP_STALE_VERSION')
    console.log('LOCAL_REAL_AUTH_STALE_VERSION_BOUNDED_P0001_PASS')
  }
  await expect(setup(page).getByText('No saved request was reconciled.', { exact: false })).toBeVisible()
  expectedDenial = false
  expect(financial(await state(page))).toEqual(financial(advanced))
  await setup(page).getByRole('button', { name: 'Resolve pending preparation', exact: true }).click()
  await expect(setup(page).getByText('The pending request was not applied and has been safely closed.', { exact: false })).toBeVisible()
  await expect(setup(page).getByLabel('Preparation work order', { exact: true })).toBeEnabled()
  const fenced = await state(page)
  expect(fenced.setup_events.length).toBe(advanced.setup_events.length + 1)
  expect(fenced.setup_events.filter(row => row.state === 'closed')).toHaveLength(1)
  for (const table of ['manufacturing_orders', 'work_orders', 'material_reservations', 'stage_wip_log', 'material_consumption',
    'bins', 'stock_ledger_entries', 'products', 'events', 'gl_entries', 'gl_entry_lines', 'journal_entries', 'journal_lines']) {
    expect(fenced[table]).toEqual(advanced[table])
  }
  await setup(page).getByLabel('New work order status', { exact: true }).selectOption('IN_PROGRESS')
  await act(page, 'Save work order eligibility')
  await other.context.close()
  console.log('COMBINED_TWO_DEVICE_STALE_INTENT_DENIAL_FENCE_NEW_INTENT_PASS')
  await verifyParentVersionProfiles({ page, ids, state, setup, act, open, contextPage, realAuth, setupRequests, setDenial: value => { expectedDenial = value } })
  await setup(page).getByLabel('Preparation order', { exact: true }).selectOption(mo.id)
  await setup(page).getByLabel('Reservation to maintain', { exact: true }).selectOption(res.id)
  await setup(page).getByLabel('Resize total or release quantity', { exact: true }).fill('15')
  // Release-only permission snapshot cannot create/resize orders or reservations.
  if (realAuth) {
    await page.evaluate(async () => {
      await fetch('/fixture-grants', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ keys: ['manufacturing.material_issue_setup.prepare', 'manufacturing.material_reservation.reserve'], enabled: false }) })
      await window.__fixtureRefreshIdentity()
    })
  } else await page.evaluate(() => window.__setFixtureKeys(['manufacturing.material_consumption.consume', 'manufacturing.material_reservation.release']))
  // Both loading-free adapter changes and real snapshots clear unsent drafts.
  await expect(setup(page).getByLabel('Preparation order', { exact: true })).toHaveCount(0)
  await open(page, mo.id)
  await expect(setup(page).getByLabel('Resize total or release quantity', { exact: true })).toHaveValue('')
  await setup(page).getByLabel('Reservation to maintain', { exact: true }).selectOption(res.id)
  await setup(page).getByLabel('Resize total or release quantity', { exact: true }).fill('15')
  await expect(setup(page).getByRole('button', { name: 'Resize pristine reservation', exact: true })).toBeDisabled()
  await expect(setup(page).getByRole('button', { name: 'Open pristine stage record', exact: true })).toBeDisabled()
  await act(page, 'Release unconsumed quantity')
  const released = await state(page); const history = released.material_reservations.find(r => r.id === res.id)
  expect(history.quantity_consumed).toBe(10); expect(history.quantity_released).toBe(15); expect(history.status).toBe('released')
  for (const table of ['stage_wip_log', 'material_consumption', 'stock_ledger_entries', 'bins', 'products', 'events',
    'gl_entries', 'gl_entry_lines', 'journal_entries', 'journal_lines']) expect(released[table]).toEqual(posted[table])
  if (realAuth) {
    // The still-valid Auth JWT cannot bypass a revoked database permission.
    await page.evaluate(async () => {
      await fetch('/fixture-grants', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ keys: ['manufacturing.material_consumption.consume'], enabled: false }) })
    })
    expectedDenial = true
    const denied = await page.evaluate(id => window.__fixtureReadIssueContext(id), mo.id)
    expect(denied.error.message).toContain('MATERIAL_CONSUMPTION_PERMISSION_DENIED')
    expectedDenial = false
    const afterDenied = await state(page); expect(financial(afterDenied)).toEqual(financial(released))
    // Non-vacuity: the consumption heading is rendered before the refresh removes it.
    await expect(page.getByRole('heading', { name: 'Material issue', exact: true })).toHaveCount(1)
    await page.evaluate(() => window.__fixtureRefreshIdentity())
    await expect(page.getByRole('heading', { name: 'Material issue', exact: true })).toHaveCount(0)
    // Release-only preparation and recovery stay available without consume.
    await expect(setup(page)).toHaveCount(1)
    await page.getByRole('button', { name: 'Sign out locally', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Sign in locally', exact: true })).toBeVisible()
    console.log('LOCAL_REAL_AUTH_REVOCATION_OLD_JWT_NO_EFFECTS_SIGNOUT_PASS')
  }
  console.log('OPERATOR_STEP=release_and_denials_verified'); expect(errors).toEqual([])
  console.log('COMBINED_PRODUCT_FORM_PRISTINE_WIP_REAL_PG_PASS')
  console.log('COMBINED_MOUNTED_MO_WO_RESERVE_RESIZE_RELEASE_OPERATOR_PASS')
  console.log('COMBINED_BROWSER_M192_LOST_RESPONSE_RELOAD_REPLAY_STATE_EQUAL_PASS')
  console.log('COMBINED_RELEASE_PRESERVES_HISTORY_STOCK_WIP_GL_PASS')
  console.log(realAuth ? 'LOCAL_REAL_AUTH_POSTGREST_MOUNTED_OPERATOR_REPLAY_RECONCILIATION_PASS — real local password/JWT/PostgREST; network loss simulated; no hosted environment sign-off' : 'COMBINED_TECHNICAL_ACCEPTANCE_PASS — native mounted operator controls + real local PG; identity/network loss simulated; no live Auth or owner UX sign-off')
  await context.close()
} catch (error) { console.error(error); console.error('BROWSER_DIAGNOSTICS', JSON.stringify(errors)); throw error } finally { await browser.close() }
