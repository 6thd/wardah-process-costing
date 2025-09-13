// Central action dispatcher registry
const registry = new Map();

/**
 * Register actions for a module with namespacing
 */
export function registerActions(prefix, actionObject) {
  Object.entries(actionObject).forEach(([name, fn]) => {
    const actionName = `${prefix}:${name}`;
    registry.set(actionName, fn);
    console.log(`📝 Registered action: ${actionName}`);
  });
}

/**
 * Execute an action by name
 */
export async function runAction(name, payload = {}, element = null) {
  try {
    const fn = registry.get(name);
    if (!fn) {
      throw new Error(`No action registered for "${name}"`);
    }
    
    console.log(`🎬 Running action: ${name}`, payload);
    const result = await fn(payload, element);
    return result;
  } catch (error) {
    console.error(`❌ Action "${name}" failed:`, error);
    
    // Show error notification
    const statusEl = document.getElementById('connectionStatus');
    if (statusEl) {
      statusEl.textContent = `❌ ${error.message}`;
      statusEl.className = 'status-error';
    }
    
    throw error;
  }
}

/**
 * Helper to read form data into an object
 */
export function readForm(formId) {
  const root = document.getElementById(formId);
  if (!root) throw new Error(`Form #${formId} not found`);
  
  const data = {};
  root.querySelectorAll('[name]').forEach(el => {
    let value;
    
    if (el.type === 'number') {
      value = Number(el.value || 0);
    } else if (el.type === 'checkbox') {
      value = el.checked;
    } else if (el.type === 'radio') {
      if (el.checked) value = el.value;
    } else {
      value = (el.value ?? '').trim();
    }
    
    if (value !== undefined) {
      data[el.name] = value;
    }
  });
  
  return data;
}

/**
 * Get all registered actions (for debugging)
 */
export function getRegisteredActions() {
  return Array.from(registry.keys()).sort();
}

/**
 * Register global utility actions
 */
export function registerGlobalActions() {
  registerActions('global', {
    'save': async () => {
      console.log('💾 Global save triggered');
      // Implement global save logic
    },
    
    'refresh': async () => {
      window.location.reload();
    },
    
    'toggle-sidebar': async () => {
      const sidebar = document.getElementById('sidebar');
      if (sidebar) {
        sidebar.classList.toggle('collapsed');
      }
    }
  });
}