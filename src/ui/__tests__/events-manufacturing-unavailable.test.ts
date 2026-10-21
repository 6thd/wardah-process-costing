/**
 * #260 / #230 interim: the five manufacturing data-actions of the unified event system (src/ui/events.ts) refuse
 * without sending any request. They are exercised through the real delegation path: a click on a [data-action]
 * button goes through rate limiting, the registry and the result handling of EventManager.
 * Each action must
 *  - never create a secure RPC (no request of any kind),
 *  - end in action:error with its explicit "unavailable pending #…" code, never action:success,
 *  - show that refusal to the user and release the button's loading state.
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest'

const createSecureRPC = vi.fn()

vi.mock('../../core/security.ts', () => ({
  createSecureRPC: (...args: unknown[]) => createSecureRPC(...args),
  logSecurityEvent: vi.fn(() => Promise.resolve()),
  checkRateLimit: vi.fn(() => true),
}))

const CASES = [
  ['mo-create', 'MO_CREATE_ACTION_UNAVAILABLE', '#230'],
  ['stage-save-labor', 'STAGE_COSTING_UNAVAILABLE_PENDING_260', '#260'],
  ['stage-apply-oh', 'STAGE_COSTING_UNAVAILABLE_PENDING_260', '#260'],
  ['stage-recalc', 'STAGE_COSTING_UNAVAILABLE_PENDING_260', '#260'],
  ['mo-finish', 'MO_COMPLETION_UNAVAILABLE_PENDING_230', '#230'],
] as const

type ActionEventDetail = { action: string; error?: unknown; result?: unknown }

let events: { action: string; type: 'success' | 'error'; detail: ActionEventDetail }[]
const onSuccess = (e: Event) => events.push({ action: (e as CustomEvent<ActionEventDetail>).detail.action, type: 'success', detail: (e as CustomEvent<ActionEventDetail>).detail })
const onError = (e: Event) => events.push({ action: (e as CustomEvent<ActionEventDetail>).detail.action, type: 'error', detail: (e as CustomEvent<ActionEventDetail>).detail })

beforeAll(async () => {
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
  // Importing the module registers its actions and initializes delegation on document.body (jsdom). The extension is
  // explicit: an extensionless '../events' resolves to the separate legacy src/ui/events.js.
  await import('../events.ts')
})

beforeEach(() => {
  events = []
  createSecureRPC.mockReset()
  document.addEventListener('action:success', onSuccess)
  document.addEventListener('action:error', onError)
})

afterEach(() => {
  document.removeEventListener('action:success', onSuccess)
  document.removeEventListener('action:error', onError)
  document.body.innerHTML = ''
})

async function clickAction(action: string) {
  const form = document.createElement('form')
  for (const [name, value] of Object.entries({ moId: 'mo-1', stageNo: '1', hours: '5', hourlyRate: '20', completedQty: '10' })) {
    const input = document.createElement('input')
    input.name = name
    input.value = value
    form.appendChild(input)
  }
  const button = document.createElement('button')
  button.dataset.action = action
  button.textContent = 'run'
  form.appendChild(button)
  document.body.appendChild(form)
  button.click()
  await vi.waitFor(() => expect(events.some(e => e.action === action)).toBe(true))
  return button
}

describe('src/ui/events.ts — manufacturing actions unavailable pending #260/#230', () => {
  it.each(CASES)('%s refuses with %s and sends no request', async (action, code, issue) => {
    const button = await clickAction(action)

    expect(createSecureRPC).not.toHaveBeenCalled()
    expect(events.filter(e => e.action === action).map(e => e.type)).toEqual(['error'])
    const error = String(events.find(e => e.action === action)?.detail.error)
    expect(error).toBe(`${code}: unavailable pending ${issue}; no request was sent`)

    const shown = [...document.querySelectorAll('.notification-error')].map(n => n.textContent)
    expect(shown).toContain(error)
    expect(document.querySelector('.notification-success')).toBeNull()

    expect(button.hasAttribute('disabled')).toBe(false)
    expect(button.textContent).toBe('run')
  })
})
