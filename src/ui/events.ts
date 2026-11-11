/**
 * Unified Event System for Wardah ERP
 * Central data-action delegation with error handling and security
 */

import { createSecureRPC, logSecurityEvent, checkRateLimit } from '../core/security.ts'

// Action result interface
interface ActionResult {
  success: boolean
  data?: any
  error?: string
  message?: string
}

// Action context interface
interface ActionContext {
  element: HTMLElement
  data: Record<string, any>
  tenantId?: string
  userId?: string
}

// Action handler type
type ActionHandler = (context: ActionContext) => Promise<ActionResult>

// Global action registry
const actionHandlers = new Map<string, ActionHandler>()

// Event delegation manager
class EventManager {
  private isInitialized = false
  private rootElement: HTMLElement | null = null

  /**
   * Initialize the event delegation system
   */
  initialize(rootElement: HTMLElement = document.body) {
    if (this.isInitialized) {
      console.warn('⚡ Event manager already initialized')
      return
    }

    this.rootElement = rootElement
    this.setupEventDelegation()
    this.isInitialized = true
    
    console.log('⚡ Event manager initialized successfully')
  }

  /**
   * Setup event delegation for data-action attributes
   */
  private setupEventDelegation() {
    if (!this.rootElement) return

    // Handle click events
    this.rootElement.addEventListener('click', this.handleClick.bind(this))
    
    // Handle form submissions
    this.rootElement.addEventListener('submit', this.handleSubmit.bind(this))
    
    // Handle input changes for auto-save
    this.rootElement.addEventListener('change', this.handleChange.bind(this))
  }

  /**
   * Handle click events with data-action
   */
  private async handleClick(event: Event) {
    const element = event.target as HTMLElement
    const actionElement = element.closest('[data-action]') as HTMLElement
    
    if (!actionElement) return

    const action = actionElement.dataset.action
    if (!action) return

    // Prevent default behavior
    event.preventDefault()
    event.stopPropagation()

    await this.executeAction(action, actionElement, event)
  }

  /**
   * Handle form submissions with data-action
   */
  private async handleSubmit(event: Event) {
    const form = event.target as HTMLFormElement
    const action = form.dataset.action
    
    if (!action) return

    event.preventDefault()
    await this.executeAction(action, form, event)
  }

  /**
   * Handle input changes for auto-save actions
   */
  private async handleChange(event: Event) {
    const element = event.target as HTMLElement
    const action = element.dataset.actionChange
    
    if (!action) return

    await this.executeAction(action, element, event)
  }

  /**
   * Execute action with error handling and security
   */
  private async executeAction(action: string, element: HTMLElement, event: Event) {
    try {
      // Rate limiting check
      if (!checkRateLimit(action, 50, 60000)) {
        this.showError(element, 'Rate limit exceeded. Please try again later.')
        return
      }

      // Get action handler
      const handler = actionHandlers.get(action)
      if (!handler) {
        console.warn(`⚡ No handler found for action: ${action}`)
        this.showError(element, `Unknown action: ${action}`)
        return
      }

      // Show loading state
      this.setLoadingState(element, true)

      // Prepare action context
      const context = await this.prepareActionContext(element, event)

      // Log security event
      await logSecurityEvent('action_executed', { action, element_id: element.id })

      // Execute action
      const result = await handler(context)

      // Handle result
      if (result.success) {
        this.showSuccess(element, result.message || 'Operation completed successfully')
        
        // Trigger custom events for UI updates
        this.triggerCustomEvent('action:success', { action, result, element })
      } else {
        this.showError(element, result.error || 'Operation failed')
        this.triggerCustomEvent('action:error', { action, error: result.error, element })
      }

    } catch (error) {
      console.error(`⚡ Action execution failed: ${action}`, error)
      this.showError(element, 'An unexpected error occurred')
      this.triggerCustomEvent('action:error', { action, error, element })
      
    } finally {
      this.setLoadingState(element, false)
    }
  }

  /**
   * Prepare action context with form data and metadata
   */
  private async prepareActionContext(element: HTMLElement, event: Event): Promise<ActionContext> {
    const data: Record<string, any> = {}

    // Extract form data if element is a form
    if (element instanceof HTMLFormElement) {
      const formData = new FormData(element)
      for (const [key, value] of formData.entries()) {
        data[key] = value
      }
    }

    // Extract data attributes
    for (const [key, value] of Object.entries(element.dataset)) {
      if (key.startsWith('param')) {
        const paramName = key.replace('param', '').toLowerCase()
        data[paramName] = value
      }
    }

    // Get closest form data if element is not a form
    if (!(element instanceof HTMLFormElement)) {
      const closestForm = element.closest('form') as HTMLFormElement
      if (closestForm) {
        const formData = new FormData(closestForm)
        for (const [key, value] of formData.entries()) {
          if (!data[key]) data[key] = value
        }
      }
    }

    return {
      element,
      data,
      tenantId: '', // Will be set by security layer
      userId: ''    // Will be set by security layer
    }
  }

  /**
   * Set loading state on element
   */
  private setLoadingState(element: HTMLElement, loading: boolean) {
    if (loading) {
      element.classList.add('loading')
      element.setAttribute('disabled', 'true')
      
      // Add spinner if it's a button
      if (element.tagName === 'BUTTON') {
        const originalText = element.textContent
        element.dataset.originalText = originalText || ''
        element.innerHTML = '<span class="spinner"></span> Loading...'
      }
    } else {
      element.classList.remove('loading')
      element.removeAttribute('disabled')
      
      // Restore original text if it's a button
      if (element.tagName === 'BUTTON' && element.dataset.originalText) {
        element.textContent = element.dataset.originalText
        delete element.dataset.originalText
      }
    }
  }

  /**
   * Show success message
   */
  private showSuccess(element: HTMLElement, message: string) {
    this.showNotification('success', message)
  }

  /**
   * Show error message
   */
  private showError(element: HTMLElement, message: string) {
    this.showNotification('error', message)
  }

  /**
   * Show notification (can be overridden to use a toast library)
   */
  private showNotification(type: 'success' | 'error' | 'warning', message: string) {
    // Create a simple notification
    const notification = document.createElement('div')
    notification.className = `notification notification-${type}`
    notification.textContent = message
    notification.style.cssText = `
      position: fixed;
      top: 20px;
      right: 20px;
      padding: 12px 20px;
      border-radius: 4px;
      color: white;
      font-weight: 500;
      z-index: 10000;
      max-width: 400px;
      box-shadow: 0 4px 12px rgba(0,0,0,0.15);
      background: ${type === 'success' ? '#10b981' : type === 'error' ? '#ef4444' : '#f59e0b'};
    `

    document.body.appendChild(notification)

    // Remove after 5 seconds
    setTimeout(() => {
      if (notification.parentNode) {
        notification.parentNode.removeChild(notification)
      }
    }, 5000)

    // Also log to console
    const logMethod = type === 'error' ? console.error : console.log
    logMethod(`⚡ ${type.toUpperCase()}: ${message}`)
  }

  /**
   * Trigger custom events for component communication
   */
  private triggerCustomEvent(eventName: string, detail: any) {
    const event = new CustomEvent(eventName, { detail, bubbles: true })
    document.dispatchEvent(event)
  }
}

// Global event manager instance
export const eventManager = new EventManager()

/**
 * Register action handler
 */
export const registerAction = (action: string, handler: ActionHandler) => {
  actionHandlers.set(action, handler)
  console.log(`⚡ Registered action handler: ${action}`)
}

/**
 * Unregister action handler
 */
export const unregisterAction = (action: string) => {
  actionHandlers.delete(action)
  console.log(`⚡ Unregistered action handler: ${action}`)
}

// ===================================================================
// MANUFACTURING ACTIONS
// ===================================================================

// The five manufacturing actions below previously called RPCs that do not exist on the schema now in Production
// (observed after M203, 2026-10-21): create_manufacturing_order, apply_labor_time, apply_overhead and
// complete_manufacturing_order are absent, and upsert_stage_cost exists only as upsert_stage_cost(p_tenant, p_mo, p_stage,
// p_wc, p_good_qty, p_dm, p_mode, ...). Nothing in src dispatches them. They now refuse without sending any request:
//  - stage costing (labor, overhead, recalculation) waits for the DB-first engine repair in #260;
//  - completion must go through the single authorized, idempotent completion orchestrator of #230 (FG stock, cost, WIP,
//    GL and MO status in one transaction), never through a client-side call.
const unavailableManufacturingAction = (issue: '#230' | '#260', code: string) =>
  async (_context: ActionContext): Promise<ActionResult> => ({
    success: false,
    error: `${code}: unavailable pending ${issue}; no request was sent`
  })

registerAction('mo-create', unavailableManufacturingAction('#230', 'MO_CREATE_ACTION_UNAVAILABLE'))
registerAction('stage-save-labor', unavailableManufacturingAction('#260', 'STAGE_COSTING_UNAVAILABLE_PENDING_260'))
registerAction('stage-apply-oh', unavailableManufacturingAction('#260', 'STAGE_COSTING_UNAVAILABLE_PENDING_260'))
registerAction('stage-recalc', unavailableManufacturingAction('#260', 'STAGE_COSTING_UNAVAILABLE_PENDING_260'))
registerAction('mo-finish', unavailableManufacturingAction('#230', 'MO_COMPLETION_UNAVAILABLE_PENDING_230'))

// ===================================================================
// INVENTORY ACTIONS
// ===================================================================

// Stock movement
registerAction('stock-move-in', async (context: ActionContext): Promise<ActionResult> => {
  const { data } = context
  
  try {
    const updateAVCO = createSecureRPC('update_item_avco')
    const result = await updateAVCO({
      p_item_id: data.itemId,
      p_quantity: Number.parseFloat(data.quantity),
      p_unit_cost: Number.parseFloat(data.unitCost),
      p_move_type: 'receipt',
      p_reference_type: data.referenceType,
      p_reference_number: data.referenceNumber
    })

    return {
      success: true,
      data: result,
      message: `Stock received: ${data.quantity} units at ${data.unitCost} each`
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to receive stock'
    }
  }
})

// ===================================================================
// AUTO-INITIALIZATION
// ===================================================================

// Auto-initialize when DOM is ready
if (typeof window !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      eventManager.initialize()
    })
  } else {
    eventManager.initialize()
  }
}

export default {
  eventManager,
  registerAction,
  unregisterAction
}
