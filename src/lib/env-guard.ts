/**
 * env-guard — فحص إعدادات البيئة قبل إقلاع التطبيق (P4-C3)
 * =========================================================
 * المشكلة السابقة: غياب مفاتيح Supabase في الإنتاج كان يرمي خطأً
 * أثناء تحميل الموديولات ⇒ شاشة بيضاء صامتة (ErrorBoundary لا يلتقط
 * أخطاء مرحلة التحميل). الآن نفحص قبل استيراد شجرة التطبيق ونعرض
 * شاشة إرشاد واضحة بدل الصمت.
 */

export interface EnvCheckResult {
  ok: boolean
  missing: string[]
}

/** فحص مفاتيح البيئة الإلزامية للإقلاع */
export function checkRequiredEnv(env: Record<string, string | undefined> = import.meta.env): EnvCheckResult {
  const required = ['VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY'] as const
  const missing = required.filter((key) => {
    const v = env[key]
    return !v || String(v).trim() === ''
  })
  return { ok: missing.length === 0, missing }
}

/** شاشة "التطبيق غير مُهيّأ" — ثنائية اللغة RTL، بلا أي اعتماد على React */
export function renderNotConfiguredScreen(rootElement: HTMLElement, missing: string[]): void {
  const list = missing.map((m) => `<code style="direction:ltr;display:inline-block">${m}</code>`).join('، ')
  rootElement.innerHTML = `
    <div dir="rtl" style="min-height:100vh;display:flex;align-items:center;justify-content:center;
         font-family:system-ui,-apple-system,'Segoe UI',Tahoma,sans-serif;background:#f8fafc;color:#0f172a;padding:24px">
      <div style="max-width:560px;text-align:center;background:#fff;border:1px solid #e2e8f0;
           border-radius:12px;padding:40px 32px;box-shadow:0 1px 3px rgba(0,0,0,.06)">
        <div style="font-size:44px;margin-bottom:12px">⚙️</div>
        <h1 style="font-size:22px;margin:0 0 8px;font-weight:700">التطبيق غير مُهيّأ بعد</h1>
        <p style="margin:0 0 16px;color:#475569;line-height:1.8">
          متغيرات البيئة التالية مفقودة في إعدادات النشر:<br>${list}
        </p>
        <p style="margin:0;color:#64748b;font-size:13px;line-height:1.8">
          أضفها في إعدادات الاستضافة (Vercel → Settings → Environment Variables)
          ثم أعد النشر — التفاصيل في <code style="direction:ltr">VERCEL_ENV_SETUP.md</code>
        </p>
        <hr style="border:none;border-top:1px solid #e2e8f0;margin:20px 0">
        <p dir="ltr" style="margin:0;color:#94a3b8;font-size:12px">
          App not configured — missing environment variables. See VERCEL_ENV_SETUP.md
        </p>
      </div>
    </div>`
}
