/**
 * اختبارات التصليب الأمني (P4 — المرحلة A)
 * A1: execute-migrations معطَّل | A2: demo_mode لا يفبرك مستخدماً
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

describe('A1: execute-migrations معطَّل أمنياً', () => {
  it('executeSQLFile يرمي خطأ التعطيل ولا يلمس Supabase', async () => {
    const { executeSQLFile } = await import('@/database/execute-migrations')
    await expect(executeSQLFile('anything.sql')).rejects.toThrow('معطَّل أمنياً')
  })

  it('runMigrations يرمي خطأ التعطيل', async () => {
    const { runMigrations } = await import('@/database/execute-migrations')
    await expect(runMigrations()).rejects.toThrow('Migration 82')
  })
})

describe('A2: demo_mode آمن افتراضياً', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it('الإعداد الافتراضي في lib/config هو demo_mode=false', async () => {
    // fetch يفشل ⇒ يسقط للإعداد الافتراضي المدمج
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('no config')))
    const { loadConfig } = await import('@/lib/config')
    const config = await loadConfig()
    expect(config.FEATURES?.demo_mode).toBe(false)
    vi.unstubAllGlobals()
  })

  it('config.json المشحون يحمل demo_mode=false', async () => {
    const fs = await import('fs')
    const raw = fs.readFileSync('public/config.json', 'utf8')
    const parsed = JSON.parse(raw)
    expect(parsed.FEATURES.demo_mode).toBe(false)
  })

  it('checkAuth في auth-store مشروط بـ import.meta.env.DEV (فحص شيفرة)', async () => {
    // ضمانة ثبات: الشرط الأمني موجود نصياً — أي إزالة له تكسر هذا الاختبار
    const fs = await import('fs')
    const src = fs.readFileSync('src/store/auth-store.ts', 'utf8')
    expect(src).toMatch(/import\.meta\.env\.DEV\s*&&\s*config\.FEATURES\?\.demo_mode/)
  })
})
