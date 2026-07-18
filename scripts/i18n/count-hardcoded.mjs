#!/usr/bin/env node
/**
 * عدّاد النصوص ثنائية اللغة المشفَّرة (hardcoded) — يُنتج رقماً آلياً بدل العدّ
 * اليدوي المتضارب في تقارير المعالجة.
 *
 * النمط الأساسي (--ci): isRTL ? '<عربي>' : '<إنجليزي>'
 * النمط الموسَّع (--extended): أيضاً placeholder/label/title + نصوص JSX المباشرة
 *
 * الاستخدام:
 *   node scripts/i18n/count-hardcoded.mjs            # ملخّص + إجمالي (النمط الأساسي)
 *   node scripts/i18n/count-hardcoded.mjs --json     # ناتج JSON (للـCI)
 *   node scripts/i18n/count-hardcoded.mjs --list     # كل موضع مع الملف/السطر
 *   node scripts/i18n/count-hardcoded.mjs --ci       # بوابة CI: يخرج بـ 1 عند إجمالي > 0
 *   node scripts/i18n/count-hardcoded.mjs --extended # تقرير إضافي شامل (غير حاجز)
 *   node scripts/i18n/count-hardcoded.mjs --extended --ci-extended
 *                                                     # حاجز CI موسَّع (مستقبلاً)
 *
 * كود الخروج: 0 إن كان الإجمالي صفرًا أو لم يُمرَّر --ci/--ci-extended؛
 *             1 عند --ci مع إجمالي > 0، أو --ci-extended مع إجمالي موسَّع > 0.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..')
const SRC = join(ROOT, 'src')

// النمط الأساسي: isRTL ? '<يبدأ بحرف عربي>...'
const PATTERN = /isRTL\s*\?\s*(['"`])\s*[؀-ۿ]/g

// النمط الموسَّع أ: نصوص عربية في سمات placeholder/label/title/aria-label
const ATTR_PATTERN = /(?:placeholder|aria-label|aria-placeholder)\s*=\s*["'][^"'\n]*[؀-ۿ][^"'\n]*["']/g

// النمط الموسَّع ب: نصوص JSX مباشرة بين علامتي وسوم (>نص عربي<)
// يستثني ما بداخل {} (تعبيرات React) والتعليقات
const JSX_TEXT_PATTERN = /(?<=>)\s*([^{}<>]+[؀-ۿ][^{}<>]*)\s*(?=<)/g

const args = new Set(process.argv.slice(2))
const asJson = args.has('--json')
const asList = args.has('--list')
const asCI = args.has('--ci')
const extended = args.has('--extended')
const asCIExtended = args.has('--ci-extended')

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

function scanPattern(files, pattern) {
  const perFile = {}
  const hits = []
  let total = 0

  for (const file of files) {
    const text = readFileSync(file, 'utf8')
    const linesArr = text.split('\n')
    let count = 0
    pattern.lastIndex = 0
    let m
    while ((m = pattern.exec(text)) !== null) {
      const lineNum = text.slice(0, m.index).split('\n').length
      const lineText = linesArr[lineNum - 1] ?? ''
      count++
      total++
      hits.push({ file: relative(ROOT, file), line: lineNum, text: lineText.trim().slice(0, 120) })
    }
    if (count > 0) perFile[relative(ROOT, file)] = count
  }

  return { perFile, hits, total }
}

const sourceFiles = walk(SRC)

// ─── المسح الأساسي (isRTL ? pattern) ───────────────────────────────────────
const { perFile, hits, total } = scanPattern(sourceFiles, PATTERN)
const fileCount = Object.keys(perFile).length

if (asJson) {
  const out = { total, files: fileCount, perFile }
  if (extended) {
    const attrRes  = scanPattern(sourceFiles, ATTR_PATTERN)
    const jsxRes   = scanPattern(sourceFiles, JSX_TEXT_PATTERN)
    out.extended = {
      attributes: { total: attrRes.total, files: Object.keys(attrRes.perFile).length },
      jsxText:    { total: jsxRes.total,  files: Object.keys(jsxRes.perFile).length },
    }
  }
  console.log(JSON.stringify(out, null, 2))
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
  console.log(`\nالإجمالي (أساسي): ${total} موضع في ${fileCount} ملف`)
}

// ─── المسح الموسَّع (placeholder / JSX text) ────────────────────────────────
if (extended || asCIExtended) {
  const attrRes = scanPattern(sourceFiles, ATTR_PATTERN)
  const jsxRes  = scanPattern(sourceFiles, JSX_TEXT_PATTERN)
  const extTotal = attrRes.total + jsxRes.total

  if (!asJson) {
    console.log('\n── التقرير الموسَّع (placeholder + نصوص JSX المباشرة) ──')
    console.log(`   placeholder/aria-label بعربي: ${attrRes.total} موضع في ${Object.keys(attrRes.perFile).length} ملف`)
    console.log(`   نصوص JSX مباشرة بعربي:        ${jsxRes.total} موضع في ${Object.keys(jsxRes.perFile).length} ملف`)
    console.log(`   الإجمالي الموسَّع:              ${extTotal}`)
    console.log('   ملاحظة: هذا تقرير إعلامي — البوابة الحاجزة تستخدم النمط الأساسي فقط')
  }

  if (asCIExtended && extTotal > 0) {
    console.error(`❌ i18n gate (موسَّع): ${extTotal} نص عربي مشفَّر خارج نمط isRTL`)
    process.exit(1)
  }
}
