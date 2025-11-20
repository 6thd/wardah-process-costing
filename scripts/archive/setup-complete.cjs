/**
 * إعداد كامل لقاعدة بيانات وردة البيان ERP
 */

const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

const config = JSON.parse(fs.readFileSync('public/config.json', 'utf8'));
const SUPABASE_URL = config.SUPABASE_URL;
const SUPABASE_ANON_KEY = config.SUPABASE_ANON_KEY;

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const TENANT_ID = '00000000-0000-0000-0000-000000000001';

async function main() {
  console.log('🚀 إعداد نظام وردة البيان ERP');
  console.log('='.repeat(60));

  try {
    // 1. إنشاء المؤسسة
    console.log('\n🏢 الخطوة 1: إنشاء مؤسسة وردة البيان...');
    await createOrganization();
    
    // 2. استيراد شجرة الحسابات
    console.log('\n📊 الخطوة 2: استيراد شجرة الحسابات...');
    await importChartOfAccounts();
    
    // 3. استيراد خرائط الأحداث
    console.log('\n🗺️ الخطوة 3: استيراد خرائط الأحداث...');
    await importGLMappings();
    
    console.log('\n' + '='.repeat(60));
    console.log('✅ تم إعداد نظام وردة البيان ERP بنجاح!');
    console.log('='.repeat(60));
    
  } catch (error) {
    console.error('\n❌ خطأ:', error.message);
    process.exit(1);
  }
}

async function createOrganization() {
  const { error } = await supabase
    .from('organizations')
    .upsert({
      id: TENANT_ID,
      name: 'وردة البيان للصناعات البلاستيكية',
      code: 'WARDAH',
      is_active: true,
      settings: {
        currency: 'SAR',
        timezone: 'Asia/Riyadh'
      }
    }, {
      onConflict: 'id'
    });
    
  if (error) {
    console.log(`   ⚠️ ${error.message}`);
  } else {
    console.log('   ✅ تم إنشاء/تحديث المؤسسة');
  }
}

async function importChartOfAccounts() {
  const csvPath = path.join(__dirname, 'wardah_erp_handover/wardah_enhanced_coa.csv');
  const csvContent = fs.readFileSync(csvPath, 'utf8');
  const lines = csvContent.split('\n').filter(line => line.trim());
  const headers = lines[0].split(',').map(h => h.trim());
  
  let imported = 0;
  let updated = 0;
  let errors = [];
  
  // جولة 1: الحسابات الرئيسية
  console.log('   جولة 1: الحسابات الرئيسية...');
  for (let i = 1; i < lines.length; i++) {
    const values = parseCSVLine(lines[i]);
    if (values.length !== headers.length) continue;
    
    const account = {};
    headers.forEach((header, index) => {
      account[header] = values[index].trim();
    });
    
    // تخطي الحسابات الفرعية في الجولة الأولى
    if (account.parent_code && account.parent_code.trim()) continue;
    
    try {
      const { error } = await supabase
        .from('gl_accounts')
        .upsert({
          org_id: TENANT_ID,
          code: account.code,
          name: account.name,
          category: account.category,
          subtype: account.subtype || 'OTHER',
          parent_code: null,
          normal_balance: account.normal_balance,
          allow_posting: account.allow_posting === 'TRUE',
          is_active: account.is_active === 'TRUE',
          currency: account.currency || 'SAR',
          notes: account.notes || null
        }, {
          onConflict: 'org_id,code'
        });
        
      if (error) {
        errors.push(`${account.code}: ${error.message}`);
      } else {
        imported++;
      }
    } catch (err) {
      errors.push(`${account.code}: ${err.message}`);
    }
    
    if (i % 20 === 0) {
      process.stdout.write(`\r   تقدم: ${i}/${lines.length - 1}...`);
    }
  }
  
  console.log(`\r   ✅ جولة 1: ${imported} حساب رئيسي`);
  
  // انتظار قليل للتأكد من حفظ البيانات
  await new Promise(resolve => setTimeout(resolve, 1000));
  
  // جولة 2: الحسابات الفرعية
  console.log('   جولة 2: الحسابات الفرعية...');
  for (let i = 1; i < lines.length; i++) {
    const values = parseCSVLine(lines[i]);
    if (values.length !== headers.length) continue;
    
    const account = {};
    headers.forEach((header, index) => {
      account[header] = values[index].trim();
    });
    
    // فقط الحسابات الفرعية
    if (!account.parent_code || !account.parent_code.trim()) continue;
    
    try {
      const { error } = await supabase
        .from('gl_accounts')
        .upsert({
          org_id: TENANT_ID,
          code: account.code,
          name: account.name,
          category: account.category,
          subtype: account.subtype || 'OTHER',
          parent_code: account.parent_code || null,
          normal_balance: account.normal_balance,
          allow_posting: account.allow_posting === 'TRUE',
          is_active: account.is_active === 'TRUE',
          currency: account.currency || 'SAR',
          notes: account.notes || null
        }, {
          onConflict: 'org_id,code'
        });
        
      if (error) {
        errors.push(`${account.code}: ${error.message}`);
      } else {
        updated++;
      }
    } catch (err) {
      errors.push(`${account.code}: ${err.message}`);
    }
    
    if (i % 20 === 0) {
      process.stdout.write(`\r   تقدم: ${i}/${lines.length - 1}...`);
    }
  }
  
  console.log(`\r   ✅ جولة 2: ${updated} حساب فرعي`);
  console.log(`   📊 إجمالي: ${imported + updated} حساب`);
  
  if (errors.length > 0 && errors.length <= 5) {
    console.log(`   ⚠️ أخطاء: ${errors.join(', ')}`);
  }
}

async function importGLMappings() {
  const csvPath = path.join(__dirname, 'wardah_erp_handover/wardah_gl_mappings.csv');
  
  if (!fs.existsSync(csvPath)) {
    console.log('   ⚠️ ملف غير موجود');
    return;
  }
  
  const csvContent = fs.readFileSync(csvPath, 'utf8');
  const lines = csvContent.split('\n').filter(line => line.trim());
  const headers = lines[0].split(',').map(h => h.trim());
  
  let imported = 0;
  let errors = [];
  
  for (let i = 1; i < lines.length; i++) {
    const values = parseCSVLine(lines[i]);
    if (values.length < headers.length) continue;
    
    const mapping = {};
    headers.forEach((header, index) => {
      mapping[header] = values[index]?.trim() || '';
    });
    
    try {
      const { error } = await supabase
        .from('gl_mappings')
        .upsert({
          org_id: TENANT_ID,
          key_type: mapping.key_type || 'EVENT',
          key_value: mapping.key_value,
          debit_account_code: mapping.debit_account,
          credit_account_code: mapping.credit_account,
          description: mapping.description || null,
          is_active: true
        }, {
          onConflict: 'org_id,key_type,key_value'
        });
        
      if (error) {
        errors.push(`${mapping.key_value}: ${error.message}`);
      } else {
        imported++;
      }
      
      if (i % 10 === 0) {
        process.stdout.write(`\r   تقدم: ${i}/${lines.length - 1}...`);
      }
    } catch (err) {
      errors.push(`${mapping.key_value}: ${err.message}`);
    }
  }
  
  console.log(`\r   ✅ تم: ${imported} خريطة`);
  
  if (errors.length > 0 && errors.length <= 5) {
    console.log(`   ⚠️ أخطاء: ${errors.join('\n   ')}`);
  }
}

function parseCSVLine(line) {
  const values = [];
  let current = '';
  let inQuotes = false;
  
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    
    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === ',' && !inQuotes) {
      values.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  
  values.push(current);
  return values;
}

main().catch(console.error);
