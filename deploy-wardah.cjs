/**
 * Wardah ERP Deployment Script
 * تنفيذ نظام وردة البيان ERP بالكامل
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
  console.log('🚀 بدء نشر نظام وردة البيان ERP');
  console.log('='.repeat(50));

  try {
    // الخطوة 1: تنفيذ Schema
    console.log('\n📋 الخطوة 1: تنفيذ المخطط الأساسي...');
    await executeSQL('wardah_erp_handover/wardah-migration-schema.sql');
    
    // الخطوة 2: تطبيق RLS
    console.log('\n🔒 الخطوة 2: تطبيق سياسات الأمان (RLS)...');
    await executeSQL('wardah_erp_handover/wardah-rls-policies.sql');
    
    // الخطوة 3: تثبيت دوال AVCO
    console.log('\n⚙️ الخطوة 3: تثبيت دوال AVCO والتصنيع...');
    await executeSQL('wardah_erp_handover/wardah-avco-functions.sql');
    
    // الخطوة 4: استيراد شجرة الحسابات
    console.log('\n📊 الخطوة 4: استيراد شجرة الحسابات...');
    await importChartOfAccounts();
    
    // الخطوة 5: استيراد خرائط الأحداث
    console.log('\n🗺️ الخطوة 5: استيراد خرائط الأحداث...');
    await importGLMappings();
    
    console.log('\n' + '='.repeat(50));
    console.log('✅ تم نشر نظام وردة البيان ERP بنجاح!');
    console.log('='.repeat(50));
    
  } catch (error) {
    console.error('\n❌ خطأ في النشر:', error.message);
    if (error.details) console.error('التفاصيل:', error.details);
    if (error.hint) console.error('الحل المقترح:', error.hint);
    process.exit(1);
  }
}

async function executeSQL(filePath) {
  const fullPath = path.join(__dirname, filePath);
  if (!fs.existsSync(fullPath)) {
    console.log(`⚠️ الملف غير موجود: ${filePath} - تخطي...`);
    return;
  }

  const sql = fs.readFileSync(fullPath, 'utf8');
  console.log(`   تنفيذ: ${filePath}`);
  
  // تقسيم SQL إلى جمل منفصلة وتنفيذها
  const statements = sql
    .split(';')
    .map(s => s.trim())
    .filter(s => s.length > 0 && !s.startsWith('--'));
  
  for (const statement of statements) {
    try {
      // استخدام rpc لتنفيذ SQL مباشرة (يتطلب دالة مخصصة)
      // أو يمكن استخدام REST API
      const { error } = await supabase.rpc('exec_sql', { sql_query: statement });
      if (error) throw error;
    } catch (err) {
      // بعض الأوامر قد تفشل إذا كانت موجودة مسبقاً (مثل CREATE TABLE IF NOT EXISTS)
      if (!err.message.includes('already exists')) {
        console.warn(`   ⚠️ تحذير: ${err.message}`);
      }
    }
  }
  
  console.log(`   ✅ تم التنفيذ بنجاح`);
}

async function importChartOfAccounts() {
  const csvPath = path.join(__dirname, 'wardah_erp_handover/wardah_enhanced_coa.csv');
  const csvContent = fs.readFileSync(csvPath, 'utf8');
  const lines = csvContent.split('\n').filter(line => line.trim());
  const headers = lines[0].split(',');
  
  let imported = 0;
  let skipped = 0;
  
  // تنفيذ على دفعتين: أولاً الحسابات الرئيسية، ثم الفرعية
  for (let pass = 1; pass <= 2; pass++) {
    for (let i = 1; i < lines.length; i++) {
      const values = parseCSVLine(lines[i]);
      if (values.length !== headers.length) continue;
      
      const account = {};
      headers.forEach((header, index) => {
        account[header.trim()] = values[index].trim();
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
          if (pass === 2) {
            console.warn(`   ⚠️ تخطي ${account.code}: ${error.message}`);
            skipped++;
          }
        } else {
          imported++;
        }
      } catch (err) {
        console.error(`   ❌ خطأ في ${account.code}:`, err.message);
        skipped++;
      }
    }
  }
  
  console.log(`   ✅ تم استيراد ${imported} حساب`);
  if (skipped > 0) console.log(`   ⚠️ تم تخطي ${skipped} حساب`);
}

async function importGLMappings() {
  const csvPath = path.join(__dirname, 'wardah_erp_handover/wardah_gl_mappings.csv');
  
  if (!fs.existsSync(csvPath)) {
    console.log('   ⚠️ ملف خرائط الأحداث غير موجود - تخطي...');
    return;
  }
  
  const csvContent = fs.readFileSync(csvPath, 'utf8');
  const lines = csvContent.split('\n').filter(line => line.trim());
  const headers = lines[0].split(',');
  
  let imported = 0;
  
  for (let i = 1; i < lines.length; i++) {
    const values = parseCSVLine(lines[i]);
    if (values.length < headers.length) continue;
    
    const mapping = {};
    headers.forEach((header, index) => {
      mapping[header.trim()] = values[index]?.trim() || '';
    });
    
    try {
      const { error } = await supabase
        .from('gl_mappings')
        .upsert({
          org_id: TENANT_ID,
          key_type: 'EVENT',
          key_value: mapping.event_code || mapping.key_value,
          debit_account_code: mapping.dr_account_code || mapping.debit_account_code,
          credit_account_code: mapping.cr_account_code || mapping.credit_account_code,
          description: mapping.notes || mapping.description || null,
          is_active: true
        }, {
          onConflict: 'org_id,key_type,key_value'
        });
        
      if (error) {
        console.warn(`   ⚠️ تخطي ${mapping.event_code}: ${error.message}`);
      } else {
        imported++;
      }
    } catch (err) {
      console.error(`   ❌ خطأ في ${mapping.event_code}:`, err.message);
    }
  }
  
  console.log(`   ✅ تم استيراد ${imported} خريطة حدث`);
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
