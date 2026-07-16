/**
 * T5 — اختبار i18n للـSidebar
 *
 * يتحقق من:
 * 1. تغيير اللغة بلا reload يُحدِّث document.dir/lang
 * 2. مفاتيح navigation.* الضرورية موجودة في كلا ملفَي الترجمة (ar/en)
 * 3. النصوص المبنية على مفاتيح t('navigation.*') تتغير عند تبديل اللغة
 * 4. العودة للعربية تُعيد RTL
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, act, cleanup } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

// قراءة ملفي الترجمة مباشرة (بلا حاجة لتشغيل i18n)
import arTranslation from '@/locales/ar/translation.json'
import enTranslation from '@/locales/en/translation.json'

// الـi18n الحقيقي (مُهيَّأ لمرة واحدة عند استيراده)
import i18n from '@/i18n'

// المكوّن
import { Sidebar } from '@/components/layout/sidebar'

// ----------------------------------------------------------------
// Mocks
// ----------------------------------------------------------------

vi.mock('@/hooks/usePermissions', () => ({
  usePermissions: vi.fn(() => ({
    isOrgAdmin: false,
    isSuperAdmin: false,
    permissions: [],
    loading: false,
    error: null,
  })),
}))

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: vi.fn(() => ({
    user: { id: 'u1', email: 'test@test.com' },
    session: null,
    organizations: [],
    currentOrgId: 'org-1',
    setCurrentOrgId: vi.fn(),
    signOut: vi.fn(),
    isLoading: false,
  })),
}))

// ----------------------------------------------------------------
// Helper
// ----------------------------------------------------------------

function renderSidebar() {
  return render(
    <MemoryRouter initialEntries={['/dashboard']}>
      <Sidebar />
    </MemoryRouter>
  )
}

// ----------------------------------------------------------------
// Tests
// ----------------------------------------------------------------

describe('Sidebar — i18n', () => {
  beforeEach(async () => {
    await act(async () => {
      await i18n.changeLanguage('ar')
    })
  })

  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
  })

  // ---- 1. dir/lang يتغيران بلا reload ----

  it('Arabic: document.dir=rtl, document.lang=ar', async () => {
    renderSidebar()
    expect(document.documentElement.dir).toBe('rtl')
    expect(document.documentElement.lang).toBe('ar')
  })

  it('English switch: document.dir=ltr, document.lang=en (no reload)', async () => {
    renderSidebar()

    await act(async () => {
      await i18n.changeLanguage('en')
    })

    expect(document.documentElement.dir).toBe('ltr')
    expect(document.documentElement.lang).toBe('en')
  })

  it('Back to Arabic: document.dir=rtl restored', async () => {
    renderSidebar()

    await act(async () => { await i18n.changeLanguage('en') })
    await act(async () => { await i18n.changeLanguage('ar') })

    expect(document.documentElement.dir).toBe('rtl')
    expect(document.documentElement.lang).toBe('ar')
  })

  // ---- 2. نصوص الـi18n تتغير فعلاً ----

  it('navigation.dashboard translates correctly in both languages', async () => {
    renderSidebar()

    const arText = i18n.t('navigation.dashboard')
    expect(arText).toBeTruthy()
    expect(arText).not.toBe('navigation.dashboard') // مفتاح لم يُحلَّ

    await act(async () => { await i18n.changeLanguage('en') })

    const enText = i18n.t('navigation.dashboard')
    expect(enText).toBeTruthy()
    expect(enText).not.toBe('navigation.dashboard')

    // النص العربي يختلف عن الإنجليزي
    expect(arText).not.toBe(enText)
  })

  it('navigation texts rendered in sidebar change on language switch', async () => {
    renderSidebar()

    // في العربية يجب أن نجد النص العربي للـ Dashboard
    const arLabel = (arTranslation as any)
      .navigation?.dashboard
    expect(screen.queryAllByText(arLabel).length).toBeGreaterThan(0)

    await act(async () => { await i18n.changeLanguage('en') })

    // بعد التبديل يجب أن يظهر النص الإنجليزي
    const enLabel = (enTranslation as any)
      .navigation?.dashboard
    expect(screen.queryAllByText(enLabel).length).toBeGreaterThan(0)
  })

  // ---- 3. اكتمال مفاتيح navigation.* في ملفَي الترجمة ----

  it('all navigation.* keys used in sidebar exist in ar translation', () => {
    const SIDEBAR_KEYS = [
      // القوائم الرئيسية
      'dashboard', 'manufacturing', 'inventory', 'purchasing', 'sales',
      'accounting', 'hr', 'reports', 'settings', 'org-admin', 'super-admin',
      // عناصر مشتركة
      'overview', 'analytics', 'performance', 'orders',
      // تصنيع
      'process-costing', 'stages', 'wipLog', 'standardCosts', 'workcenters', 'bom', 'quality',
      // مخزون
      'items', 'movements', 'adjustments', 'valuation', 'locations',
      // مشتريات
      'suppliers', 'receipts', 'invoices', 'payments',
      // مبيعات
      'customers', 'delivery', 'collections',
      // تقارير
      'financial', 'gemini-dashboard',
      // إعدادات
      'company', 'system', 'backup',
    ] as const

    const arNav = (arTranslation as any).navigation ?? {}
    const missing = SIDEBAR_KEYS.filter(k => !(k in arNav))
    expect(missing, `مفاتيح غائبة في ar/translation.json: ${missing.join(', ')}`).toEqual([])
  })

  it('all navigation.* keys used in sidebar exist in en translation', () => {
    const SIDEBAR_KEYS = [
      'dashboard', 'manufacturing', 'inventory', 'purchasing', 'sales',
      'accounting', 'hr', 'reports', 'settings', 'org-admin', 'super-admin',
      'overview', 'analytics', 'performance', 'orders',
      'process-costing', 'stages', 'wipLog', 'standardCosts', 'workcenters', 'bom', 'quality',
      'items', 'movements', 'adjustments', 'valuation', 'locations',
      'suppliers', 'receipts', 'invoices', 'payments',
      'customers', 'delivery', 'collections',
      'financial', 'gemini-dashboard',
      'company', 'system', 'backup',
    ] as const

    const enNav = (enTranslation as any).navigation ?? {}
    const missing = SIDEBAR_KEYS.filter(k => !(k in enNav))
    expect(missing, `مفاتيح غائبة في en/translation.json: ${missing.join(', ')}`).toEqual([])
  })

  it('fails (descriptively) when a navigation key is deleted — sentinel test', () => {
    const nav = (arTranslation as any).navigation ?? {}
    // التحقق من أن الـsatisfied key موجود فعلاً (الاختبار يفشل لو حُذف 'dashboard')
    expect('dashboard' in nav).toBe(true)
    expect('manufacturing' in nav).toBe(true)
  })
})
