import { chromium, expect } from '@playwright/test'
import fs from 'node:fs/promises'
const url = 'http://127.0.0.1:4175'
// Fixed local evidence paths: caller input never selects a write destination.
await fs.mkdir('/tmp/wardah-issue-browser', { recursive: true })
const browser = await chromium.launch({ executablePath: process.env.WARDAH_BROWSER_EXECUTABLE,
 headless: true, timeout: 20000, args: ['--no-sandbox','--disable-dev-shm-usage','--single-process','--no-zygote'] })
try {
 const context = await browser.newContext()
 await context.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort())
 const errors = []
 const watch = page => { page.on('pageerror', error => errors.push(error.message)); page.on('console', message => { if (message.type() === 'error') errors.push(message.text()) }) }
 const page = await context.newPage(); watch(page)
 const ids = { mo: 'ed000000-0000-4000-8000-000000000010', stage: 'ed000000-0000-4000-8000-0000000000f1', wo: 'ed000000-0000-4000-8000-000000000020', reservation: 'ed000000-0000-4000-8000-000000000030', warehouse: 'ed000000-0000-4000-8000-0000000000e1', uom: 'ed000000-0000-4000-8000-000000000040' }
 async function selectMO(p) {
  await expect(p.getByLabel('Manufacturing order')).toBeEnabled()
  await p.getByLabel('Manufacturing order').selectOption(ids.mo)
 }
 async function fill(p) {
  await selectMO(p); await expect(p.getByLabel('Reserved material 1')).toBeEnabled()
  for (const [label,value] of [['Stage',ids.stage],['Reserved material 1',ids.reservation],['Work order 1',ids.wo],['Warehouse 1',ids.warehouse],['Base unit 1',ids.uom]]) await p.getByLabel(label,{exact:true}).selectOption(value)
  await p.getByLabel('Quantity 1',{exact:true}).fill('10')
  await expect(p.getByRole('button',{name:'Issue materials',exact:true})).toBeEnabled()
 }
 const calls = async () => page.evaluate(() => JSON.parse(localStorage.getItem('fixture:trace') || '[]').filter(call => call.name==='rpc_consume_material_event'))
 await page.goto(url); await fill(page)
 await page.screenshot({ path: '/tmp/wardah-issue-browser/employee.png', fullPage: true })
 await page.evaluate(() => localStorage.setItem('fixture:lose-next','true'))
 await page.getByRole('button',{name:'Issue materials',exact:true}).click()
 await expect(page.getByRole('button',{name:'Retry saved event'})).toBeEnabled()
 expect(await page.evaluate(() => localStorage.getItem('fixture:effects'))).toBe('1')
 await expect(page.getByRole('button',{name:'Acknowledge definite rejection'})).toHaveCount(0)
 await page.reload(); await selectMO(page)
 await page.getByRole('button',{name:'Retry saved event'}).click()
 await expect(page.getByText('Issue confirmed. Receipt:',{exact:false})).toBeVisible()
 const replay = await calls(); expect(replay).toHaveLength(2); expect(replay[0].args).toEqual(replay[1].args)
 expect(await page.evaluate(() => localStorage.getItem('fixture:effects'))).toBe('1')
 console.log('NATIVE_INDEXEDDB_LOST_RESPONSE_RELOAD_REPLAY_PASS')

 const tab = await context.newPage(); watch(tab); await tab.goto(url)
 await fill(page); await fill(tab)
 await page.evaluate(() => localStorage.setItem('fixture:lose-next','true'))
 await Promise.all([page.getByRole('button',{name:'Issue materials',exact:true}).click(),tab.getByRole('button',{name:'Issue materials',exact:true}).click()])
 await expect.poll(async () => (await calls()).length).toBe(3)
 const raced = await calls(); expect(new Set(raced.map(call=>call.args.p_event_id)).size).toBe(2)
 expect(await page.evaluate(() => localStorage.getItem('fixture:effects'))).toBe('2')
 await page.reload(); await selectMO(page)
 await page.getByRole('button',{name:'Retry saved event'}).click(); await expect(page.getByText('Issue confirmed. Receipt:',{exact:false})).toBeVisible()
 expect(await page.evaluate(() => localStorage.getItem('fixture:effects'))).toBe('2')
 console.log('NATIVE_INDEXEDDB_TWO_TAB_CLAIM_AND_RECOVERY_PASS')
 await tab.close()
 await fill(page)
 await page.evaluate(() => window.__fixture.changeIdentity({grant:false}))
 await expect(page.getByText('Material-issue access is unavailable.')).toBeVisible()
 await expect(page.getByLabel('Quantity 1')).toHaveCount(0)
 await page.evaluate(() => window.__fixture.changeIdentity({grant:true,org:'ed000000-0000-4000-8000-000000000002'}))
 await expect(page.getByLabel('Manufacturing order')).toHaveValue('')
 await page.evaluate(() => window.__fixture.changeIdentity({user:'ed000000-0000-4000-8000-0000000000a3'}))
 await expect(page.getByLabel('Manufacturing order')).toHaveValue('')
 console.log('SIMULATED_PERMISSION_AND_IDENTITY_CHANGE_PASS')

 await page.evaluate(() => window.__fixture.changeIdentity({org:window.__fixture.ids.org,user:window.__fixture.ids.user}))
 await page.getByRole('button',{name:'Policy page',exact:true}).click()
 await expect(page.getByRole('checkbox',{name:'READY',exact:true})).toBeDisabled()
 await page.evaluate(() => window.__fixture.changeIdentity({admin:true}))
 await expect(page.getByRole('checkbox',{name:'READY',exact:true})).toBeEnabled()
 await page.getByRole('checkbox',{name:'READY',exact:true}).check()
 await page.getByRole('button',{name:'Save policy',exact:true}).click()
 await expect(page.getByText('Policy version: 2',{exact:true})).toBeVisible()
 await page.screenshot({ path: '/tmp/wardah-issue-browser/policy.png', fullPage: true })
 await page.evaluate(() => { const p=JSON.parse(localStorage.getItem('fixture:policy')); p.version=3;p.allowed_statuses=['IN_PROGRESS','IN_SETUP'];localStorage.setItem('fixture:policy',JSON.stringify(p));window.dispatchEvent(new Event('focus')) })
 await expect(page.getByText('Policy version: 3',{exact:true})).toBeVisible()
 await expect(page.getByRole('checkbox',{name:'IN_SETUP',exact:true})).toBeChecked()
 await page.evaluate(() => window.__fixture.changeIdentity({admin:false}))
 await expect(page.getByRole('button',{name:'Save policy',exact:true})).toHaveCount(0)
 console.log('SIMULATED_POLICY_REFRESH_AND_ADMIN_REVOCATION_PASS')

 const blocked = await context.newPage(); watch(blocked)
 await blocked.addInitScript(() => Object.defineProperty(window,'indexedDB',{ value: undefined }))
 await blocked.goto(url); await selectMO(blocked)
 await expect(blocked.getByText('Durable request storage is unavailable. Issuing is blocked.')).toBeVisible()
 await expect(blocked.getByRole('button',{name:'Issue materials',exact:true})).toBeDisabled()
 expect(errors).toEqual([])
 await expect(page.locator('vite-error-overlay')).toHaveCount(0)
 await fs.writeFile('/tmp/wardah-issue-browser/trace.json',JSON.stringify(await page.evaluate(()=>JSON.parse(localStorage.getItem('fixture:trace'))),null,2))
 console.log('NATIVE_STORAGE_FAILURE_BLOCK_PASS')
 console.log('LOCAL_BROWSER_FIXTURE_PASS — simulated accounts/RPC; no database or real identity acceptance')
 await context.close()
} finally { await browser.close() }
