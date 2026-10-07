import { expect } from '@playwright/test'

// Real mounted controls and PG effects. Each context has separate IndexedDB.
export async function verifyParentVersionProfiles({ page, ids, state, setup, act, open, contextPage, realAuth, setupRequests, setDenial }) {
  await setup(page).getByLabel('Order product', { exact: true }).selectOption(ids.product)
  await setup(page).getByLabel('New order number', { exact: true }).fill('MO-M198-TWO-PROFILES')
  await setup(page).getByLabel('Planned order quantity', { exact: true }).fill('5')
  await act(page, 'Create draft order')
  const mo = (await state(page)).manufacturing_orders.find(row => row.order_number === 'MO-M198-TWO-PROFILES')
  expect(mo).toBeTruthy()
  for (const operation of ['reserve', 'create_work_order']) {
    await act(page, 'Refresh preparation')
    await setup(page).getByLabel('Preparation order', { exact: true }).selectOption(mo.id)
    const device = await contextPage(); await open(device.page, mo.id)
    try {
      const before = await state(page); const parent = before.manufacturing_orders.find(row => row.id === mo.id)
      const table = operation === 'reserve' ? 'material_reservations' : 'work_orders'
      const childCount = snapshot => snapshot[table].filter(row => row.mo_id === mo.id).length
      const unchanged = ['bins', 'stock_ledger_entries', 'products', 'stage_wip_log', 'material_consumption', 'events', 'gl_entries', 'gl_entry_lines', 'journal_entries', 'journal_lines']
      const fillChild = async target => {
        if (operation === 'reserve') {
          await setup(target).getByLabel('Reservation item', { exact: true }).selectOption(ids.item)
          await setup(target).getByLabel('New reservation quantity', { exact: true }).fill('2')
        } else {
          await setup(target).getByLabel('Work center', { exact: true }).selectOption(ids.center)
          await setup(target).getByLabel('Operation name', { exact: true }).fill('M198 profile child')
          await setup(target).getByLabel('Planned operation quantity', { exact: true }).fill('2')
        }
      }
      const button = operation === 'reserve' ? 'Reserve material' : 'Create manual work order'
      await fillChild(page); await fillChild(device.page)
      await page.evaluate(() => localStorage.setItem('operator:drop-setup-before-call', 'true'))
      await act(page, button); await expect(setup(page).getByRole('alert')).toContainText('saved request')
      await device.page.evaluate(() => localStorage.setItem('operator:lose-setup-after-commit', 'true'))
      await act(device.page, button); await expect(setup(device.page).getByRole('alert')).toContainText('saved request')
      const committed = await state(page)
      expect(childCount(committed)).toBe(childCount(before) + 1)
      expect(committed.manufacturing_orders.find(row => row.id === mo.id).maintenance_version).toBe(Number(parent.maintenance_version) + 1)
      for (const key of unchanged) expect(committed[key]).toEqual(before[key])
      const terminal = committed.setup_events.find(row => row.command.mo_id === mo.id && row.command.operation === operation && row.state === 'applied')
      expect(terminal).toBeTruthy()
      await device.page.reload(); await open(device.page, mo.id)
      await setup(device.page).getByRole('button', { name: 'Retry selected order preparation', exact: true }).click()
      await expect(setup(device.page).getByText('The saved request was reconciled.', { exact: false })).toBeVisible()
      const replay = await state(page)
      for (const key of Object.keys(committed).filter(key => key !== 'trace')) expect(replay[key]).toEqual(committed[key])
      const calls = (realAuth ? setupRequests : replay.trace).filter(row => row.name === 'rpc_manage_material_issue_setup' && row.args.p_event_id === terminal.event_id)
      expect(calls).toHaveLength(2); expect(calls[1].args).toEqual(calls[0].args)
      expect(calls[0].args.p_command.expected_version).toBe(Number(parent.maintenance_version))
      setDenial(true)
      const responsePromise = realAuth ? page.waitForResponse(response => response.url().endsWith('/rpc/rpc_manage_material_issue_setup'), { timeout: 5000 }) : null
      await setup(page).getByRole('button', { name: 'Retry selected order preparation', exact: true }).click()
      if (responsePromise) {
        const response = await responsePromise; expect(response.status()).toBe(400)
        expect(await response.json()).toMatchObject({ code: 'P0001', message: 'ISSUE_SETUP_STALE_VERSION' })
      }
      await expect(setup(page).getByText('No saved request was reconciled.', { exact: false })).toBeVisible()
      setDenial(false)
      const denied = await state(page)
      for (const key of Object.keys(committed).filter(key => key !== 'trace')) expect(denied[key]).toEqual(committed[key])
      await setup(page).getByRole('button', { name: 'Resolve pending preparation', exact: true }).click()
      await expect(setup(page).getByText('The pending request was not applied and has been safely closed.', { exact: false })).toBeVisible()
      const closed = await state(page)
      expect(closed.setup_events.length).toBe(committed.setup_events.length + 1)
      for (const key of Object.keys(committed).filter(key => !['trace', 'setup_events'].includes(key))) expect(closed[key]).toEqual(committed[key])
      await expect(setup(page).getByLabel('Preparation order', { exact: true })).toBeEnabled()
      await fillChild(page); await act(page, button)
      const fresh = await state(page)
      expect(childCount(fresh)).toBe(childCount(before) + 2)
      expect(fresh.manufacturing_orders.find(row => row.id === mo.id).maintenance_version).toBe(Number(parent.maintenance_version) + 2)
      for (const key of unchanged) expect(fresh[key]).toEqual(before[key])
      console.log(`M198_NATIVE_${operation.toUpperCase()}_TWO_PROFILE_REPLAY_STALE_FENCE_REFRESH_PASS`)
    } finally { setDenial(false); await device.context.close() }
  }
}
