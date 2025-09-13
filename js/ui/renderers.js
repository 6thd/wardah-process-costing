/**
 * UI Rendering utilities for tables, forms, and dialogs
 */

/**
 * Render a data table
 */
export function renderTable(containerId, data, columns, options = {}) {
  const container = document.getElementById(containerId);
  if (!container) {
    console.error(`Container #${containerId} not found`);
    return;
  }
  
  const { 
    className = 'table table-striped',
    emptyMessage = 'لا توجد بيانات',
    showHeader = true 
  } = options;
  
  if (!data || data.length === 0) {
    container.innerHTML = `<div class="text-center text-muted py-4">${emptyMessage}</div>`;
    return;
  }
  
  let html = `<div class="table-responsive"><table class="${className}">`;
  
  // Header
  if (showHeader) {
    html += '<thead><tr>';
    columns.forEach(col => {
      html += `<th>${col.title}</th>`;
    });
    html += '</tr></thead>';
  }
  
  // Body
  html += '<tbody>';
  data.forEach(row => {
    html += '<tr>';
    columns.forEach(col => {
      let value = '';
      if (col.render) {
        value = col.render(row[col.key], row);
      } else {
        value = row[col.key] || '';
      }
      html += `<td>${value}</td>`;
    });
    html += '</tr>';
  });
  html += '</tbody></table></div>';
  
  container.innerHTML = html;
}

/**
 * Render form fields
 */
export function renderForm(containerId, fields, data = {}) {
  const container = document.getElementById(containerId);
  if (!container) return;
  
  let html = '';
  fields.forEach(field => {
    const { name, label, type = 'text', required = false, options = [] } = field;
    const value = data[name] || '';
    
    html += `<div class="mb-3">`;
    html += `<label for="${name}" class="form-label">${label}${required ? ' *' : ''}</label>`;
    
    if (type === 'select') {
      html += `<select name="${name}" id="${name}" class="form-select" ${required ? 'required' : ''}>`;
      html += `<option value="">اختر...</option>`;
      options.forEach(opt => {
        const selected = opt.value === value ? 'selected' : '';
        html += `<option value="${opt.value}" ${selected}>${opt.label}</option>`;
      });
      html += `</select>`;
    } else if (type === 'textarea') {
      html += `<textarea name="${name}" id="${name}" class="form-control" ${required ? 'required' : ''}>${value}</textarea>`;
    } else {
      html += `<input type="${type}" name="${name}" id="${name}" class="form-control" value="${value}" ${required ? 'required' : ''}>`;
    }
    
    html += `</div>`;
  });
  
  container.innerHTML = html;
}

/**
 * Show modal dialog
 */
export function showModal(title, content, actions = []) {
  const modalId = 'dynamicModal';
  let modal = document.getElementById(modalId);
  
  if (!modal) {
    modal = document.createElement('div');
    modal.id = modalId;
    modal.className = 'modal fade';
    modal.innerHTML = `
      <div class="modal-dialog">
        <div class="modal-content">
          <div class="modal-header">
            <h5 class="modal-title"></h5>
            <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
          </div>
          <div class="modal-body"></div>
          <div class="modal-footer"></div>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
  }
  
  // Update content
  modal.querySelector('.modal-title').textContent = title;
  modal.querySelector('.modal-body').innerHTML = content;
  
  // Update actions
  const footer = modal.querySelector('.modal-footer');
  footer.innerHTML = '';
  actions.forEach(action => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = action.className || 'btn btn-secondary';
    btn.textContent = action.text;
    
    if (action.dismiss) {
      btn.setAttribute('data-bs-dismiss', 'modal');
    }
    
    if (action.onClick) {
      btn.addEventListener('click', action.onClick);
    }
    
    footer.appendChild(btn);
  });
  
  // Show modal
  const bsModal = new bootstrap.Modal(modal);
  bsModal.show();
  
  return bsModal;
}

/**
 * Format currency
 */
export function formatCurrency(amount, currency = 'ريال') {
  return `${Number(amount).toFixed(2)} ${currency}`;
}

/**
 * Format date
 */
export function formatDate(date) {
  if (!date) return '';
  return new Date(date).toLocaleDateString('ar-SA');
}

/**
 * Format number
 */
export function formatNumber(num, decimals = 2) {
  return Number(num).toFixed(decimals);
}
