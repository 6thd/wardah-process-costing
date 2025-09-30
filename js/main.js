/**
 * Wardah ERP - Main Bootstrap
 * Initializes all modules and binds UI events
 */

import { bindUIOnce, showStatus, showToast } from './core/ui-bootstrap.js';
import { registerGlobalActions, getRegisteredActions } from './core/actions.js';
import { testConnection } from './core/supabase.js';
import { registerProcessCosting } from './modules/processCosting.js';
import { registerPurchasing } from './modules/purchasing.js';
import { registerInventory } from './modules/inventory.js';
import { registerSales } from './modules/sales.js';

/**
 * Main application bootstrap function
 */
async function bootstrap() {
  console.log('🚀 Starting Wardah ERP Modular System...');
  
  try {
    // Show loading status
    showStatus('جارٍ تحميل النظام...', 'info');
    
    // 1. Initialize UI event handlers
    bindUIOnce();
    console.log('✅ UI Bootstrap complete');
    
    // 2. Register global actions
    registerGlobalActions();
    console.log('✅ Global actions registered');
    
    // 3. Test database connection
    showStatus('جارٍ اختبار الاتصال بقاعدة البيانات...', 'info');
    const connectionOk = await testConnection();
    
    if (!connectionOk) {
      throw new Error('فشل الاتصال بقاعدة البيانات');
    }
    
    // 4. Register all business modules
    showStatus('جارٍ تحميل الموديولات...', 'info');
    
    await registerProcessCosting();
    await registerPurchasing();
    await registerInventory();
    await registerSales();
    
    // 5. Show success status
    showStatus('✅ النظام جاهز للاستخدام', 'success');
    showToast('تم تحميل النظام بنجاح', 'success');
    
    // 6. Log registered actions for debugging
    const actions = getRegisteredActions();
    console.log(`📋 Registered ${actions.length} actions:`, actions);
    
    // 7. Initialize dashboard if available
    initializeDashboard();
    
    console.log('🎉 Wardah ERP Modular System ready!');
    
  } catch (error) {
    console.error('💥 Bootstrap failed:', error);
    showStatus(`❌ خطأ في تحميل النظام: ${error.message}`, 'error');
    showToast(`فشل تحميل النظام: ${error.message}`, 'error');
  }
}

/**
 * Initialize dashboard with basic metrics
 */
function initializeDashboard() {
  const dashboardContainer = document.getElementById('dashboard-content');
  if (!dashboardContainer) return;
  
  // Basic dashboard content
  dashboardContainer.innerHTML = `
    <div class="row">
      <div class="col-md-3">
        <div class="card border-primary">
          <div class="card-body text-center">
            <h5 class="card-title text-primary">تكاليف المراحل</h5>
            <p class="card-text">إدارة تكاليف مراحل التصنيع</p>
            <button class="btn btn-primary" onclick="showModule('manufacturing')">
              عرض الموديول
            </button>
          </div>
        </div>
      </div>
      <div class="col-md-3">
        <div class="card border-success">
          <div class="card-body text-center">
            <h5 class="card-title text-success">المشتريات</h5>
            <p class="card-text">إدارة الموردين وأوامر الشراء</p>
            <button class="btn btn-success" onclick="showModule('purchasing')">
              عرض الموديول
            </button>
          </div>
        </div>
      </div>
      <div class="col-md-3">
        <div class="card border-warning">
          <div class="card-body text-center">
            <h5 class="card-title text-warning">المخزون</h5>
            <p class="card-text">إدارة الأصناف وحركات المخزون</p>
            <button class="btn btn-warning" onclick="showModule('inventory')">
              عرض الموديول
            </button>
          </div>
        </div>
      </div>
      <div class="col-md-3">
        <div class="card border-info">
          <div class="card-body text-center">
            <h5 class="card-title text-info">المبيعات</h5>
            <p class="card-text">إدارة العملاء وأوامر البيع</p>
            <button class="btn btn-info" onclick="showModule('sales')">
              عرض الموديول
            </button>
          </div>
        </div>
      </div>
    </div>
    
    <div class="row mt-4">
      <div class="col-12">
        <div class="card">
          <div class="card-header">
            <h5>إجراءات سريعة</h5>
          </div>
          <div class="card-body">
            <div class="row">
              <div class="col-md-6">
                <h6>تكاليف المراحل</h6>
                <button class="btn btn-outline-primary btn-sm me-2" data-action="mfg:stage:recalc" data-form="quick-stage-form">
                  احتساب مرحلة
                </button>
                <button class="btn btn-outline-primary btn-sm me-2" data-action="mfg:bom:consume" data-form="quick-bom-form">
                  استهلاك BOM
                </button>
              </div>
              <div class="col-md-6">
                <h6>المخزون والمبيعات</h6>
                <button class="btn btn-outline-success btn-sm me-2" data-action="inv:item:create" data-form="quick-item-form">
                  إضافة صنف
                </button>
                <button class="btn btn-outline-info btn-sm me-2" data-action="sales:so:create" data-form="quick-so-form">
                  أمر بيع جديد
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  `;
  
  console.log('📊 Dashboard initialized');
}

/**
 * Show/hide modules (for navigation)
 */
window.showModule = function(moduleName) {
  // Hide all module containers
  document.querySelectorAll('[id$="-content"]').forEach(el => {
    el.style.display = 'none';
  });
  
  // Show selected module
  const moduleContainer = document.getElementById(`${moduleName}-content`);
  if (moduleContainer) {
    moduleContainer.style.display = 'block';
  }
  
  // Update navigation
  document.querySelectorAll('.nav-link').forEach(link => {
    link.classList.remove('active');
  });
  
  const activeLink = document.querySelector(`[onclick="showModule('${moduleName}')"]`);
  if (activeLink) {
    activeLink.classList.add('active');
  }
  
  console.log(`📄 Switched to ${moduleName} module`);
};

/**
 * Global error handler for debugging
 */
window.addEventListener('error', (e) => {
  console.error('🚨 Global Error:', {
    message: e.message,
    filename: e.filename,
    lineno: e.lineno,
    colno: e.colno,
    stack: e.error?.stack
  });
});

// Start the application
bootstrap();