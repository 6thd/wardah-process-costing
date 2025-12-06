/**
 * استيراد شجرة الحسابات وخرائط الأحداث إلى Supabase
 * يستخدم REST API مباشرة بدون دوال SQL
 */

const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

// قراءة الإعدادات
const config = JSON.parse(fs.readFileSync('public/config.json', 'utf8'));
const SUPABASE_URL = config.SUPABASE_URL;
const SUPABASE_ANON_KEY = config.SUPABASE_ANON_KEY;

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const TENANT_ID = '00000000-0000-0000-0000-000000000001';

async function main() {
  console.log('🚀 بدء استيراد بيانات وردة البيان ERP');
  console.log('='.repeat(60));

  try {
    // الخطوة 1: استيراد شجرة الحسابات
    console.log('\n📊 الخطوة 1: استيراد شجرة الحسابات...');
    await importChartOfAccounts();
    
    // الخطوة 2: استيراد خرائط الأحداث
    console.log('\n🗺️ الخطوة 2: استيراد خرائط الأحداث...');
    await importGLMappings();
    
    console.log('\n' + '='.repeat(60));
    console.log('✅ تم استيراد بيانات وردة البيان ERP بنجاح!');
    console.log('='.repeat(60));
    
  } catch (error) {
    console.error('\n❌ خطأ في الاستيراد:', error.message);
    if (error.details) console.error('التفاصيل:', error.details);
    if (error.hint) console.error('الحل المقترح:', error.hint);
    process.exit(1);
  }
}

async function importChartOfAccounts() {
  const csvPath = path.join(__dirname, 'wardah_erp_handover/wardah_enhanced_coa.csv');
  const csvContent = fs.readFileSync(csvPath, 'utf8');
  const lines = csvContent.split('\n').filter(line => line.trim());
  const headers = lines[0].split(',').map(h => h.trim());
  
  let imported = 0;
  let skipped = 0;
  let errors = [];
  
  // استيراد على دفعتين: الحسابات الرئيسية ثم الفرعية
  for (let pass = 1; pass <= 2; pass++) {
    if (pass === 2) {
      console.log(`   جولة ${pass}: ربط الحسابات الفرعية...`);
      await new Promise(resolve => setTimeout(resolve, 1000)); // انتظار للتأكد من إدخال الحسابات الرئيسية
    }
    
    for (let i = 1; i < lines.length; i++) {
      const values = parseCSVLine(lines[i]);
      if (values.length !== headers.length) continue;
      
      const account = {};
      headers.forEach((header, index) => {
        account[header] = values[index].trim();
      });
      
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
          if (pass === 2 && !error.message.includes('violates foreign key')) {
            errors.push(`${account.code}: ${error.message}`);
            skipped++;
          }
        } else {
          if (pass === 1 || !errors.some(e => e.startsWith(account.code))) {
            imported++;
          }
        }
        
        // تقدم
        if (i % 20 === 0) {
          process.stdout.write(`\r   تقدم: ${i}/${lines.length - 1} حساب...`);
        }
      } catch (err) {
        if (pass === 2) {
          errors.push(`${account.code}: ${err.message}`);
          skipped++;
        }
      }
    }
  }
  
  console.log(`\n   ✅ تم استيراد ${imported} حساب`);
  if (skipped > 0) {
    console.log(`   ⚠️ تم تخطي ${skipped} حساب`);
    if (errors.length > 0 && errors.length <= 5) {
      console.log(`   الأخطاء: ${errors.join(', ')}`);
    }
  }
}

async function importGLMappings() {
  const csvPath = path.join(__dirname, 'wardah_erp_handover/wardah_gl_mappings.csv');
  
  if (!fs.existsSync(csvPath)) {
    console.log('   ⚠️ ملف خرائط الأحداث غير موجود - تخطي...');
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
      
      // تقدم
      if (i % 10 === 0) {
        process.stdout.write(`\r   تقدم: ${i}/${lines.length - 1} خريطة...`);
      }
    } catch (err) {
      errors.push(`${mapping.key_value}: ${err.message}`);
    }
  }
  
  console.log(`\n   ✅ تم استيراد ${imported} خريطة حدث`);
  if (errors.length > 0) {
    console.log(`   ⚠️ أخطاء: ${errors.length}`);
    if (errors.length <= 5) {
      console.log(`   ${errors.join('\n   ')}`);
    }
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

// تشغيل
main().catch(console.error);
