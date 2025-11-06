// التحقق من صحة الـ Supabase connection و RLS policies
const { createClient } = require('@supabase/supabase-js');
const config = require('./config.json');

const supabase = createClient(config.SUPABASE_URL, config.SUPABASE_ANON_KEY);

async function checkConnection() {
  console.log('\n🔌 اختبار اتصال Supabase...\n');
  console.log('URL:', config.SUPABASE_URL);
  console.log('Key Length:', config.SUPABASE_ANON_KEY?.length, 'characters\n');

  try {
    // اختبار 1: قراءة gl_entries
    console.log('📋 اختبار 1: جدول gl_entries');
    const { data: entries, error: entriesError, count: entriesCount } = await supabase
      .from('gl_entries')
      .select('*', { count: 'exact' })
      .limit(5);

    if (entriesError) {
      console.error('❌ خطأ:', entriesError.message);
      console.error('   التفاصيل:', entriesError.details);
      console.error('   الإشارة:', entriesError.hint);
    } else {
      console.log('✅ النجاح! عدد السجلات:', entriesCount);
      console.log('   عينة:', entries.slice(0, 2).map(e => ({
        id: e.id,
        entry_number: e.entry_number,
        status: e.status
      })));
    }

    // اختبار 2: قراءة gl_entry_lines
    console.log('\n📊 اختبار 2: جدول gl_entry_lines');
    const { data: lines, error: linesError, count: linesCount } = await supabase
      .from('gl_entry_lines')
      .select('*', { count: 'exact' })
      .limit(5);

    if (linesError) {
      console.error('❌ خطأ:', linesError.message);
      console.error('   التفاصيل:', linesError.details);
      console.error('   الإشارة:', linesError.hint);
    } else {
      console.log('✅ النجاح! عدد السجلات:', linesCount);
      console.log('   عينة:', lines.slice(0, 2).map(l => ({
        account_code: l.account_code,
        debit: l.debit_amount,
        credit: l.credit_amount
      })));
    }

    // اختبار 3: قراءة القيود المعتمدة فقط
    console.log('\n✅ اختبار 3: القيود المعتمدة (POSTED)');
    const { data: postedEntries, error: postedError } = await supabase
      .from('gl_entries')
      .select('id, entry_number, entry_date, status')
      .eq('status', 'POSTED')
      .gte('entry_date', '2025-01-01')
      .lte('entry_date', '2025-12-31');

    if (postedError) {
      console.error('❌ خطأ:', postedError.message);
    } else {
      console.log('✅ النجاح! عدد القيود المعتمدة:', postedEntries.length);
      
      if (postedEntries.length > 0) {
        // اختبار 4: قراءة التفاصيل للقيود المعتمدة
        console.log('\n📑 اختبار 4: تفاصيل القيود المعتمدة');
        const entryIds = postedEntries.map(e => e.id);
        const { data: postedLines, error: postedLinesError } = await supabase
          .from('gl_entry_lines')
          .select('*')
          .in('entry_id', entryIds);

        if (postedLinesError) {
          console.error('❌ خطأ:', postedLinesError.message);
        } else {
          console.log('✅ النجاح! عدد التفاصيل:', postedLines.length);
          
          // حساب ميزان المراجعة
          console.log('\n🧮 حساب ميزان المراجعة...');
          const accountTotals = new Map();
          
          postedLines.forEach(line => {
            if (!accountTotals.has(line.account_code)) {
              accountTotals.set(line.account_code, {
                account_code: line.account_code,
                account_name: line.account_name,
                debit: 0,
                credit: 0
              });
            }
            
            const account = accountTotals.get(line.account_code);
            account.debit += parseFloat(line.debit_amount || 0);
            account.credit += parseFloat(line.credit_amount || 0);
          });
          
          const trialBalance = Array.from(accountTotals.values())
            .sort((a, b) => a.account_code.localeCompare(b.account_code));
          
          const totalDebit = trialBalance.reduce((sum, acc) => sum + acc.debit, 0);
          const totalCredit = trialBalance.reduce((sum, acc) => sum + acc.credit, 0);
          const balanced = Math.abs(totalDebit - totalCredit) < 0.01;
          
          console.log('\n📊 نتيجة ميزان المراجعة:');
          console.log('   عدد الحسابات:', trialBalance.length);
          console.log('   إجمالي المدين:', totalDebit.toFixed(2), 'ر.س');
          console.log('   إجمالي الدائن:', totalCredit.toFixed(2), 'ر.س');
          console.log('   الفرق:', (totalDebit - totalCredit).toFixed(2), 'ر.س');
          console.log('   الحالة:', balanced ? '✅ متوازن' : '❌ غير متوازن');
          
          console.log('\n📋 تفاصيل الحسابات:');
          trialBalance.forEach(acc => {
            console.log(`   ${acc.account_code} - ${acc.account_name}`);
            console.log(`      مدين: ${acc.debit.toFixed(2)} | دائن: ${acc.credit.toFixed(2)}`);
          });
        }
      } else {
        console.log('⚠️  لا توجد قيود معتمدة في الفترة المحددة');
      }
    }

    console.log('\n✅ انتهى الاختبار بنجاح!');

  } catch (error) {
    console.error('\n❌ خطأ عام:', error.message);
    console.error('Stack:', error.stack);
  }
}

checkConnection();
