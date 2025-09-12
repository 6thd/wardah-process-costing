/**
 * Action-based UI Event Delegation System
 * Provides bulletproof event handling with centralized action management
 */

class UIEventSystem {
  constructor() {
    this.actions = new Map()
    this.isInitialized = false
    this.rootElement = null
  }

  /**
   * Initialize the event system
   */
  initialize(rootElement = document.body) {
    if (this.isInitialized) {
      console.warn('UIEventSystem already initialized')
      return
    }

    this.rootElement = rootElement
    this.setupEventDelegation()
    this.isInitialized = true
    console.log('✅ UIEventSystem initialized successfully')
  }

  /**
   * Set up event delegation on root element
   */
  setupEventDelegation() {
    this.rootElement.addEventListener('click', this.handleClick.bind(this), true)
    this.rootElement.addEventListener('change', this.handleChange.bind(this), true)
    this.rootElement.addEventListener('submit', this.handleSubmit.bind(this), true)
    this.rootElement.addEventListener('keydown', this.handleKeydown.bind(this), true)
  }

  /**
   * Register an action handler
   */
  registerAction(actionName, handler, options = {}) {
    if (typeof handler !== 'function') {
      throw new Error(`Action handler for '${actionName}' must be a function`)
    }

    this.actions.set(actionName, {
      handler,
      options: {
        preventDefault: options.preventDefault ?? true,
        stopPropagation: options.stopPropagation ?? false,
        debounce: options.debounce ?? 0,
        throttle: options.throttle ?? 0,
        ...options
      }
    })

    console.log(`📋 Registered action: ${actionName}`)
  }

  /**
   * Unregister an action handler
   */
  unregisterAction(actionName) {
    const removed = this.actions.delete(actionName)
    if (removed) {
      console.log(`🗑️ Unregistered action: ${actionName}`)
    }
    return removed
  }

  /**
   * Execute an action by name
   */
  async executeAction(actionName, context = {}) {
    const action = this.actions.get(actionName)
    if (!action) {
      console.warn(`⚠️ Unknown action: ${actionName}`)
      return false
    }

    try {
      const result = await action.handler(context)
      console.log(`✅ Action executed: ${actionName}`)
      return result
    } catch (error) {
      console.error(`❌ Action failed: ${actionName}`, error)
      this.handleActionError(actionName, error, context)
      return false
    }
  }

  /**
   * Handle click events
   */
  async handleClick(event) {
    const actionName = this.getActionName(event.target)
    if (!actionName) return

    const action = this.actions.get(actionName)
    if (!action) return

    if (action.options.preventDefault) {
      event.preventDefault()
    }
    if (action.options.stopPropagation) {
      event.stopPropagation()
    }

    const context = this.buildContext(event)
    await this.executeAction(actionName, context)
  }

  /**
   * Handle change events
   */
  async handleChange(event) {
    const actionName = this.getActionName(event.target, 'change')
    if (!actionName) return

    const context = this.buildContext(event)
    await this.executeAction(actionName, context)
  }

  /**
   * Handle submit events
   */
  async handleSubmit(event) {
    const actionName = this.getActionName(event.target, 'submit')
    if (!actionName) return

    event.preventDefault() // Always prevent default form submission

    const context = this.buildContext(event)
    await this.executeAction(actionName, context)
  }

  /**
   * Handle keydown events
   */
  async handleKeydown(event) {
    const actionName = this.getActionName(event.target, 'keydown')
    if (!actionName) return

    // Check for specific key combinations
    const keyAction = this.getKeyAction(event)
    if (keyAction) {
      const context = this.buildContext(event)
      await this.executeAction(keyAction, context)
    }
  }

  /**
   * Get action name from element
   */
  getActionName(element, eventType = 'click') {
    // Try data-action first
    let actionName = element.dataset.action
    if (actionName) return actionName

    // Try data-{eventType}-action
    actionName = element.dataset[`${eventType}Action`]
    if (actionName) return actionName

    // Try parent elements
    let parent = element.parentElement
    while (parent && parent !== this.rootElement) {
      actionName = parent.dataset.action || parent.dataset[`${eventType}Action`]
      if (actionName) return actionName
      parent = parent.parentElement
    }

    return null
  }

  /**
   * Get key-specific action
   */
  getKeyAction(event) {
    const { key, ctrlKey, altKey, shiftKey } = event
    
    // Build key combination string
    const modifiers = []
    if (ctrlKey) modifiers.push('ctrl')
    if (altKey) modifiers.push('alt')
    if (shiftKey) modifiers.push('shift')
    
    const keyCombo = modifiers.length > 0 
      ? `${modifiers.join('+')}+${key.toLowerCase()}`
      : key.toLowerCase()
    
    return this.getActionName(event.target, `key-${keyCombo}`)
  }

  /**
   * Build context object for action handlers
   */
  buildContext(event) {
    const element = event.target
    const form = element.closest('form')
    
    return {
      event,
      element,
      form,
      formData: form ? new FormData(form) : null,
      value: element.value,
      checked: element.checked,
      dataset: { ...element.dataset },
      timestamp: Date.now()
    }
  }

  /**
   * Handle action execution errors
   */
  handleActionError(actionName, error, context) {
    // Log error details
    console.group(`❌ Action Error: ${actionName}`)
    console.error('Error:', error)
    console.log('Context:', context)
    console.groupEnd()

    // Show user-friendly error message
    this.showErrorMessage(`خطأ في تنفيذ العملية: ${actionName}`)
  }

  /**
   * Show error message to user
   */
  showErrorMessage(message) {
    // Try to use existing toast system
    if (window.toast && typeof window.toast.error === 'function') {
      window.toast.error(message)
    } else if (window.Toastify) {
      window.Toastify({
        text: message,
        duration: 3000,
        backgroundColor: '#ef4444',
        className: 'error-toast'
      }).showToast()
    } else {
      // Fallback to alert
      alert(message)
    }
  }

  /**
   * Get all registered actions
   */
  getRegisteredActions() {
    return Array.from(this.actions.keys())
  }

  /**
   * Clear all registered actions
   */
  clearActions() {
    this.actions.clear()
    console.log('🧹 All actions cleared')
  }

  /**
   * Destroy the event system
   */
  destroy() {
    if (!this.isInitialized) return

    // Remove event listeners
    this.rootElement.removeEventListener('click', this.handleClick.bind(this), true)
    this.rootElement.removeEventListener('change', this.handleChange.bind(this), true)
    this.rootElement.removeEventListener('submit', this.handleSubmit.bind(this), true)
    this.rootElement.removeEventListener('keydown', this.handleKeydown.bind(this), true)

    // Clear actions
    this.clearActions()

    this.isInitialized = false
    this.rootElement = null
    console.log('🗑️ UIEventSystem destroyed')
  }
}

// Create singleton instance
const uiEvents = new UIEventSystem()

// Auto-initialize when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    uiEvents.initialize()
  })
} else {
  uiEvents.initialize()
}

// Export for use in modules
export default uiEvents
export { UIEventSystem }

// Global access (for debugging)
if (typeof window !== 'undefined') {
  window.uiEvents = uiEvents
}