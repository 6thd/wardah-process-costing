import { checkRequiredEnv, renderNotConfiguredScreen } from './lib/env-guard';

const rootElement = document.getElementById('root');

/**
 * P4-C3: إقلاع محروس — فحص البيئة قبل استيراد شجرة التطبيق.
 * غياب مفاتيح Supabase في الإنتاج كان يسبب شاشة بيضاء صامتة؛
 * الآن تظهر شاشة إرشاد واضحة. في التطوير نكمل (fallbacks التطوير تعمل).
 */
async function bootstrap() {
  if (!rootElement) {
    console.error('Failed to find the root element. The application cannot be mounted.');
    return;
  }

  const envCheck = checkRequiredEnv();
  if (!envCheck.ok && import.meta.env.PROD) {
    renderNotConfiguredScreen(rootElement, envCheck.missing);
    return;
  }

  // P4-C2: مراقبة الأخطاء — تعمل فقط عند وجود VITE_SENTRY_DSN
  // (بدونه: لا تغيير في السلوك إطلاقاً)
  if (import.meta.env.PROD && import.meta.env.VITE_SENTRY_DSN) {
    const { initSentry } = await import('./lib/monitoring/sentry');
    initSentry();
  }

  const [React, ReactDOM, { default: App }] = await Promise.all([
    import('react'),
    import('react-dom/client'),
    import('./App.tsx'),
  ]);
  await Promise.all([import('./globals.css'), import('./i18n.ts')]);

  ReactDOM.default.createRoot(rootElement).render(
    <React.default.StrictMode>
      <App />
    </React.default.StrictMode>
  );
}

bootstrap();
