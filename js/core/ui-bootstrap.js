/**
 * UI Bootstrap & Event Delegation
 * Bulletproof scaffolding for UI interactions
 */

import { runAction, readForm } from './actions.js';

/**
 * UI Bootstrap - Bind event handlers and setup global UI behavior
 */
export function bindUIOnce() {
  // Prevent multiple binding
  if (window.__uiBound) return;
  window.__uiBound = true;
  
  console.log('🎯 Binding UI event handlers...');
  
  // Global error handling
  window.addEventListener('error', (e) => {
    console.error('🚨 UI Error:', e.message, e.filename, e.lineno);
    showStatus(`❌ Error: ${e.message}`, 'error');
  });
  
  window.addEventListener('unhandledrejection', (e) => {
    console.error('🚨 Promise Rejection:', e.reason);
    showStatus(`❌ Promise Error: ${e.reason}`, 'error');
    e.preventDefault(); // Prevent console spam
  });
  
  // Delegated click handler for data-action buttons
  document.addEventListener('click', async (e) => {
    const actionElement = e.target.closest('[data-action]');
    if (!actionElement) return;
    
    e.preventDefault();
    
    try {
      const action = actionElement.dataset.action;
      const formId = actionElement.dataset.form;
      
      // Disable button during action
      const originalText = actionElement.textContent;
      actionElement.disabled = true;
      actionElement.textContent = 'جارٍ التنفيذ...';
      
      // Gather payload
      let payload = {};
      if (formId) {
        payload = readForm(formId);
      }
      
      // Additional data attributes
      Object.keys(actionElement.dataset).forEach(key => {
        if (key !== 'action' && key !== 'form') {
          payload[key] = actionElement.dataset[key];
        }
      });
      
      // Execute action
      await runAction(action, payload, actionElement);
      
      // Re-enable button
      actionElement.disabled = false;
      actionElement.textContent = originalText;
      
    } catch (error) {
      console.error('Action execution failed:', error);
      
      // Re-enable button
      actionElement.disabled = false;
      actionElement.textContent = actionElement.textContent.replace('جارٍ التنفيذ...', originalText);
      
      showToast(error.message, 'error');
    }
  });
  
  // Keyboard shortcuts
  document.addEventListener('keydown', (e) => {
    // Ctrl+S / Cmd+S for save
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
      e.preventDefault();
      runAction('global:save').catch(console.error);
    }
    
    // Escape to collapse sidebar
    if (e.key === 'Escape') {
      runAction('global:toggle-sidebar').catch(console.error);
    }
    
    // F5 for refresh (prevent default and use our refresh)
    if (e.key === 'F5') {
      e.preventDefault();
      runAction('global:refresh').catch(console.error);
    }
  });
  
  // Form submit prevention (we use data-action instead)
  document.addEventListener('submit', (e) => {
    e.preventDefault();
    console.log('Form submit prevented - use data-action buttons instead');
  });
  
  // Make readForm available globally for compatibility
  window.readForm = readForm;
  
  console.log('✅ UI Bootstrap complete');
}

/**
 * Show status message
 */
export function showStatus(message, type = 'info') {
  const statusEl = document.getElementById('connectionStatus');
  if (statusEl) {
    statusEl.textContent = message;
    statusEl.className = `status-${type}`;
    
    // Auto-clear success messages
    if (type === 'success') {
      setTimeout(() => {
        statusEl.textContent = '';
        statusEl.className = '';
      }, 3000);
    }
  }
}

/**
 * Show toast notification
 */
export function showToast(message, type = 'info') {
  // Try to use existing toast function
  if (window.toastOk && type === 'success') {
    window.toastOk(message);
    return;
  }
  
  if (window.toastError && type === 'error') {
    window.toastError(message);
    return;
  }
  
  // Fallback to console and status
  const icon = type === 'success' ? '✅' : type === 'error' ? '❌' : 'ℹ️';
  console.log(`${icon} ${message}`);
  showStatus(`${icon} ${message}`, type);
}

// Make utilities available globally
window.showStatus = showStatus;
window.showToast = showToast;
