/**
 * T5 — اختبار i18n للـSidebar (مُحدَّث بعد إصلاح 121: subItems تُترجَم live)
 *
 * يتحقق من:
 * 1. تغيير اللغة بلا reload يُحدِّث document.dir/lang (والعودة للعربية)
 * 2. **استخراج آلي** لكل مفاتيح navigation.* المستخدمة في الـsidebar (القوائم
 *    الرئيسية + كل subItems) من مصدر المكوّن، والتأكد من وجودها في ar وen.
 * 3. **فتح القوائم الفرعية**: بعد التحويل إلى الإنجليزية لا يبقى أي حرف عربي في
 *    DOM الـsidebar (يمسك علّة useMemo التي كانت تجمّد تسميات subItems).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, act, cleanup, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

import arTranslation from '@/locales/ar/translation.json'
import enTranslation from '@/locales/en/translation.json'

// مصدر المكوّن كنص خام — لاستخراج المفاتيح آلياً بدل قائمة يدوية
import sidebarSource from '@/components/layout/sidebar.tsx?raw'

import i18n from '@/i18n'
import { Sidebar } from '@/components/layout/sidebar'
import { usePermissions } from '@/hooks/usePermissions'

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
// استخراج مفاتيح التنقل آلياً من مصدر sidebar
// ----------------------------------------------------------------

/** مفاتيح القوائم الرئيسية: key: 'X', يتبعها icon: (بنية عناصر التنقل) */
function extractTopLevelKeys(src: string): string[] {
  const re = /key:\s*'([^']+)',\s*[\r\n]+\s*icon:/g
  const out = new Set<string>()
  let m: RegExpExecArray | null
  while ((m = re.exec(src)) !== null) out.add(m[1])
  return [...out]
}

/** مفاتيح ترجمة القوائم الفرعية: labelKey: 'navigation.X' */
function extractSubItemNavKeys(src: string): string[] {
  const re = /labelKey:\s*'navigation\.([^']+)'/g
  const out = new Set<string>()
  let m: RegExpExecArray | null
  while ((m = re.exec(src)) !== null) out.add(m[1])
  return [...out]
}

const TOP_LEVEL_KEYS = extractTopLevelKeys(sidebarSource)
const SUBITEM_KEYS = extractSubItemNavKeys(sidebarSource)
const ALL_NAV_KEYS = [...new Set([...TOP_LEVEL_KEYS, ...SUBITEM_KEYS])]

const ARABIC = /[؀-ۿ]/

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

  // ---- 1. dir/lang ----

  it('Arabic: document.dir=rtl, document.lang=ar', async () => {
    renderSidebar()
    expect(document.documentElement.dir).toBe('rtl')
    expect(document.documentElement.lang).toBe('ar')
  })

  it('English switch: document.dir=ltr, document.lang=en (no reload)', async () => {
    renderSidebar()
    await act(async () => { await i18n.changeLanguage('en') })
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

  // ---- 2. النصوص تتغير ----

  it('navigation.dashboard translates differently in ar vs en', async () => {
    renderSidebar()
    const arText = i18n.t('navigation.dashboard')
    await act(async () => { await i18n.changeLanguage('en') })
    const enText = i18n.t('navigation.dashboard')
    expect(arText).toBeTruthy()
    expect(enText).toBeTruthy()
    expect(arText).not.toBe(enText)
  })

  // ---- 3. اكتمال المفاتيح (استخراج آلي) ----

  it('extracts a non-trivial set of navigation keys from sidebar source', () => {
    // حارس: لو تغيّرت بنية المصدر وفشل الاستخراج، لا نريد اختباراً فارغاً يمر
    expect(TOP_LEVEL_KEYS.length).toBeGreaterThan(5)
    expect(SUBITEM_KEYS.length).toBeGreaterThan(20)
  })

  it('all auto-extracted navigation.* keys exist in ar translation', () => {
    const arNav = (arTranslation as any).navigation ?? {}
    const missing = ALL_NAV_KEYS.filter(k => !(k in arNav))
    expect(missing, `مفاتيح غائبة في ar/translation.json: ${missing.join(', ')}`).toEqual([])
  })

  it('all auto-extracted navigation.* keys exist in en translation', () => {
    const enNav = (enTranslation as any).navigation ?? {}
    const missing = ALL_NAV_KEYS.filter(k => !(k in enNav))
    expect(missing, `مفاتيح غائبة في en/translation.json: ${missing.join(', ')}`).toEqual([])
  })

  // ---- 4. القوائم الفرعية تُترجَم عند تبديل اللغة (علّة useMemo) ----

  it('subItem labels are NOT frozen: no Arabic remains in sidebar DOM after switching to English', async () => {
    // كل الصلاحيات مفعّلة ⇒ كل القوائم (بما فيها org-admin/super-admin) تُعرض وتُفحص
    ;(usePermissions as any).mockReturnValue({
      isOrgAdmin: true, isSuperAdmin: true, permissions: [], loading: false, error: null,
    })

    const { container } = renderSidebar()

    // في العربية: يوجد نص عربي فعلاً (تأكيد أن الفحص ذو معنى)
    expect(ARABIC.test(container.textContent ?? '')).toBe(true)

    await act(async () => { await i18n.changeLanguage('en') })

    // بعد التحويل إلى الإنجليزية: subItems (المُخزَّنة سابقاً في useMemo) يجب أن
    // تُترجَم أيضاً ⇒ صفر أحرف عربية في DOM الـsidebar.
    const leftover = (container.textContent ?? '')
      .split(/\s+/)
      .filter(w => ARABIC.test(w))
    expect(leftover, `نصوص عربية بقيت بعد التبديل للإنجليزية: ${leftover.join(' | ')}`).toEqual([])
  })

  it('a known subItem (overview) renders its English label after switch', async () => {
    renderSidebar()
    await act(async () => { await i18n.changeLanguage('en') })
    const enOverview = (enTranslation as any).navigation?.overview
    expect(enOverview).toBeTruthy()
    expect(screen.queryAllByText(enOverview).length).toBeGreaterThan(0)
  })
})
