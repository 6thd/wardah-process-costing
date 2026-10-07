import { chromium, expect } from '@playwright/test'
const browser = await chromium.launch({ executablePath: process.env.WARDAH_BROWSER_EXECUTABLE,
  headless: true, timeout: 20000, args: ['--no-sandbox', '--disable-dev-shm-usage', '--single-process', '--no-zygote'] })
try {
  const context = await browser.newContext()
  await context.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort())
  const errors = []
  async function preparer(page) {
    page.on('pageerror', error => errors.push(error.message))
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()) })
    await page.goto('http://127.0.0.1:4175')
    await page.evaluate(() => window.__fixture.changeIdentity({ grant: false, prepare: true }))
    await expect(page.getByRole('button', { name: 'Resolve pending preparation', exact: true })).toBeVisible()
  }
  const page = await context.newPage(); await preparer(page)
  // Real IndexedDB survives reload. Neither simulated unknown nor a subsequent
  // precise SQL denial permits local dismissal; the explicit server fence does.
  const unknown = await page.evaluate(async () => {
    localStorage.setItem('fixture:setup-mode', 'lost-before')
    try { await window.__fixture.setup.manage({ operation: 'set_order_status', mo_id: window.__fixture.ids.mo, status: 'in_progress', expected_version: 1 }) }
    catch (error) { return error.message }
  })
  expect(unknown).toBe('SIMULATED_UNKNOWN_TRANSPORT')
  await preparer(page)
  await page.getByLabel('Manufacturing order').selectOption(await page.evaluate(() => window.__fixture.ids.mo))
  await page.evaluate(() => localStorage.setItem('fixture:setup-mode', 'denied'))
  await page.getByRole('button', { name: 'Retry selected order preparation', exact: true }).click()
  await expect(page.getByRole('status')).toContainText('An unknown result cannot be dismissed')
  await page.getByRole('button', { name: 'Dismiss rejected preparation', exact: true }).click()
  await expect(page.getByRole('status')).toContainText('An unknown result cannot be dismissed')
  await page.getByRole('button', { name: 'Resolve pending preparation', exact: true }).click()
  await expect(page.getByRole('status')).toContainText('safely closed')
  expect(await page.evaluate(() => window.__fixture.setup.pending())).toEqual([])
  await page.evaluate(async () => {
    localStorage.removeItem('fixture:setup-mode')
    await window.__fixture.setup.manage({ operation: 'set_order_status', mo_id: window.__fixture.ids.mo, status: 'on_hold', expected_version: 2 })
  })
  console.log('NATIVE_SETUP_UNKNOWN_DENIAL_RELOAD_FENCE_NEW_INTENT_PASS')
  // The two real tabs share one durable event. An applied lost response is then
  // reconciled to its verified receipt, without posting another setup command.
  const other = await context.newPage(); await preparer(other)
  await page.evaluate(() => localStorage.setItem('fixture:setup-mode', 'lost-before'))
  async function claim(p) { return p.evaluate(async () => {
    try { await window.__fixture.setup.manage({ operation: 'set_order_status', mo_id: window.__fixture.ids.mo, status: 'in_progress', expected_version: 2 }) }
    catch { return (await window.__fixture.setup.pending())[0].eventId }
  }) }
  const events = await Promise.all([claim(page), claim(other)])
  expect(events[0]).toBe(events[1])
  await page.evaluate(() => localStorage.setItem('fixture:setup-mode', 'lost-after'))
  const lost = await other.evaluate(async () => {
    try { await window.__fixture.setup.recover(window.__fixture.ids.mo) }
    catch (error) { return error.message }
  })
  expect(lost).toBe('SIMULATED_COMMIT_THEN_LOST_RESPONSE')
  await preparer(page)
  await page.getByLabel('Manufacturing order').selectOption(await page.evaluate(() => window.__fixture.ids.mo))
  const count = await page.evaluate(() => JSON.parse(localStorage.getItem('fixture:trace')).filter(c => c.name === 'rpc_manage_material_issue_setup').length)
  await page.getByRole('button', { name: 'Resolve pending preparation', exact: true }).click()
  await expect(page.getByRole('status')).toContainText('The saved request was reconciled.')
  expect(await page.evaluate(() => window.__fixture.setup.pending())).toEqual([])
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('fixture:trace')).filter(c => c.name === 'rpc_manage_material_issue_setup').length)).toBe(count)
  console.log('NATIVE_SETUP_TWO_TAB_EVENT_APPLIED_RECEIPT_RECONCILIATION_PASS')
  expect(errors).toEqual([])
  await context.close()
  console.log('LOCAL_MAINTENANCE_BROWSER_PASS — simulated RPC/identity; not database-connected acceptance')
} finally { await browser.close() }
