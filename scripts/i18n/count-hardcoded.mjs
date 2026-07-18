#!/usr/bin/env node
/**
 * عدّاد النصوص ثنائية اللغة المشفَّرة (hardcoded) — يُنتج رقماً آلياً بدل العدّ
 * اليدوي المتضارب في تقارير المعالجة.
 *
 * يعدّ فقط النمط الحقيقي لنص واجهة مشفَّر:  isRTL ? '<عربي>' : '<إنجليزي>'
 * (أي ثلاثية isRTL التي فرعها الأول يبدأ بحرف عربي). لا يعدّ ثلاثيات التخطيط
 * مثل  isRTL ? 'text-right' : 'text-left'  لأنها ليست نصوص محتوى.
 *
 * الاستخدام:
 *   node scripts/i18n/count-hardcoded.mjs            # ملخّص + إجمالي
 *   node scripts/i18n/count-hardcoded.mjs --json     # ناتج JSON (للـCI)
 *   node scripts/i18n/count-hardcoded.mjs --list     # كل موضع مع الملف/السطر
 *   node scripts/i18n/count-hardcoded.mjs --ci       # بوابة CI: يخرج بـ 1 عند إجمالي > 0
 *
 * كود الخروج: 0 إن كان الإجمالي صفرًا أو لم يُمرَّر --ci؛ 1 عند --ci مع إجمالي > 0.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..')
const SRC = join(ROOT, 'src')

// isRTL ? '<يبدأ بحرف عربي>...'  (أحادي أو مزدوج أو backtick)
// نلتقط بداية النص العربي بعد علامة الاقتباس مباشرةً.
const PATTERN = /isRTL\s*\?\s*(['"`])\s*[؀-ۿ]/g

const args = new Set(process.argv.slice(2))
const asJson = args.has('--json')
const asList = args.has('--list')
const asCI = args.has('--ci')

/** جميع ملفات المصدر ذات الامتداد المعني */
function walk(dir) {
  const files = []
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    const st = statSync(p)
    if (st.isDirectory()) {
      if (name === 'node_modules' || name === '__tests__' || name.startsWith('.')) continue
      files.push(...walk(p))
    } else if (/\.(tsx?|jsx?)$/.test(name) && !/\.(test|spec)\./.test(name)) {
      files.push(p)
    }
  }
  return files
}

const perFile = {}
const hits = []
let total = 0

for (const file of walk(SRC)) {
  const text = readFileSync(file, 'utf8')
  const linesArr = text.split('\n')
  let count = 0
  // مسح على النص الكامل لاصطياد النمط متعدد الأسطر مثل:
  //   isRTL
  //     ? 'نص عربي'
  PATTERN.lastIndex = 0
  let m
  while ((m = PATTERN.exec(text)) !== null) {
    const lineNum = text.slice(0, m.index).split('\n').length
    const lineText = linesArr[lineNum - 1] ?? ''
    count++
    total++
    hits.push({ file: relative(ROOT, file), line: lineNum, text: lineText.trim().slice(0, 120) })
  }
  if (count > 0) perFile[relative(ROOT, file)] = count
}

const fileCount = Object.keys(perFile).length

if (asJson) {
  console.log(JSON.stringify({ total, files: fileCount, perFile }, null, 2))
} else if (asList) {
  for (const h of hits) console.log(`${h.file}:${h.line}  ${h.text}`)
  console.log(`\nإجمالي: ${total} موضع في ${fileCount} ملف`)
} else if (asCI) {
  if (total === 0) {
    console.log('✅ i18n gate: 0 نص مشفَّر — ممتاز')
  } else {
    console.error(`❌ i18n gate: ${total} نص مشفَّر في ${fileCount} ملف — يجب استبدالها بـ t() قبل الدمج`)
    for (const h of hits) console.error(`  ${h.file}:${h.line}  ${h.text}`)
    process.exit(1)
  }
} else {
  const sorted = Object.entries(perFile).sort((a, b) => b[1] - a[1])
  console.log('النصوص المشفَّرة (isRTL ? \'عربي\' : \'إنجليزي\') — أعلى الملفات:')
  for (const [f, c] of sorted.slice(0, 20)) console.log(`  ${String(c).padStart(4)}  ${f}`)
  if (sorted.length > 20) console.log(`  … و${sorted.length - 20} ملفاً آخر`)
  console.log(`\nالإجمالي: ${total} موضع في ${fileCount} ملف`)
}
