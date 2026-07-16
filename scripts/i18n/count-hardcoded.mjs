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
 *
 * كود الخروج: 0 دائماً (تقرير فقط) — يُحوَّل لبوابة CI لاحقاً عند بلوغ الصفر.
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
  const lines = text.split('\n')
  let count = 0
  lines.forEach((line, idx) => {
    PATTERN.lastIndex = 0
    let m
    while ((m = PATTERN.exec(line)) !== null) {
      count++
      total++
      hits.push({ file: relative(ROOT, file), line: idx + 1, text: line.trim().slice(0, 120) })
    }
  })
  if (count > 0) perFile[relative(ROOT, file)] = count
}

const fileCount = Object.keys(perFile).length

if (asJson) {
  console.log(JSON.stringify({ total, files: fileCount, perFile }, null, 2))
} else if (asList) {
  for (const h of hits) console.log(`${h.file}:${h.line}  ${h.text}`)
  console.log(`\nإجمالي: ${total} موضع في ${fileCount} ملف`)
} else {
  const sorted = Object.entries(perFile).sort((a, b) => b[1] - a[1])
  console.log('النصوص المشفَّرة (isRTL ? \'عربي\' : \'إنجليزي\') — أعلى الملفات:')
  for (const [f, c] of sorted.slice(0, 20)) console.log(`  ${String(c).padStart(4)}  ${f}`)
  if (sorted.length > 20) console.log(`  … و${sorted.length - 20} ملفاً آخر`)
  console.log(`\nالإجمالي: ${total} موضع في ${fileCount} ملف`)
}
