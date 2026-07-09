import { Routes, Route, Navigate, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { lazy, Suspense } from 'react';
import { accountingModules, getLocalizedModule } from './config/modules';
import { ModuleCard, QuickStats } from './components';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

// Lazy load components
const JournalEntries = lazy(() => import('./journal-entries').then(m => ({ default: m.default })));
const TrialBalance = lazy(() => import('./trial-balance').then(m => ({ default: m.default })));
const AccountStatement = lazy(() => import('./account-statement').then(m => ({ default: m.AccountStatement })));
const ReconciliationPage = lazy(() => import('./reconciliation').then(m => ({ default: m.ReconciliationPage })));

// Loading component
function LoadingSpinner() {
  return (
    <div className="flex items-center justify-center min-h-[400px]">
      <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
    </div>
  );
}

// Accounting Overview Page - Refactored for reduced complexity
function AccountingOverview() {
  const { i18n } = useTranslation();
  const isRTL = i18n.language === 'ar';

  const localizedModules = accountingModules.map(m => getLocalizedModule(m, isRTL));

  return (
    <div className="container mx-auto p-6 space-y-6" dir={isRTL ? 'rtl' : 'ltr'}>
      <div>
        <h1 className="text-3xl font-bold mb-2">
          {isRTL ? 'المحاسبة المالية' : 'Financial Accounting'}
        </h1>
        <p className="text-muted-foreground">
          {isRTL 
            ? 'إدارة شاملة للنظام المحاسبي والمالي'
            : 'Comprehensive financial and accounting management'}
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {localizedModules.map((module) => (
          <ModuleCard
            key={module.href}
            title={module.title}
            description={module.description}
            icon={module.icon}
            href={module.href}
            color={module.color}
            bgColor={module.bgColor}
            features={module.features}
            isRTL={isRTL}
          />
        ))}
      </div>

      <QuickStats isRTL={isRTL} />
    </div>
  );
}

// Posting Page
function PostingPage() {
  const { i18n } = useTranslation();
  const isRTL = i18n.language === 'ar';
  const navigate = useNavigate();

  return (
    <div className="container mx-auto p-6" dir={isRTL ? 'rtl' : 'ltr'}>
      <Card>
        <CardHeader>
          <CardTitle>{isRTL ? 'الترحيل' : 'Posting'}</CardTitle>
          <CardDescription>
            {isRTL ? 'ترحيل القيود إلى دفتر الأستاذ' : 'Post entries to general ledger'}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4">
            <p className="text-sm text-blue-800 dark:text-blue-200">
              {isRTL 
                ? '💡 يمكنك استخدام زر "ترحيل مجمع" في صفحة القيود لترحيل قيود متعددة دفعة واحدة.'
                : '💡 You can use the "Batch Post" button in Journal Entries page to post multiple entries at once.'}
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Card 
              className="hover:shadow-md transition-shadow cursor-pointer" 
              role="button"
              tabIndex={0}
              onClick={() => navigate('/accounting/journal-entries')}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  navigate('/accounting/journal-entries');
                }
              }}
            >
              <CardHeader>
                <CardTitle className="text-lg">{isRTL ? 'قيود اليومية' : 'Journal Entries'}</CardTitle>
                <CardDescription>
                  {isRTL ? 'إدارة القيود والترحيل' : 'Manage entries and posting'}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Button className="w-full" variant="outline">
                  {isRTL ? 'فتح القيود' : 'Open Entries'}
                </Button>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-lg">{isRTL ? 'ميزان المراجعة' : 'Trial Balance'}</CardTitle>
                <CardDescription>
                  {isRTL ? 'عرض الأرصدة بعد الترحيل' : 'View balances after posting'}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Button 
                  className="w-full" 
                  variant="outline"
                  onClick={() => navigate('/accounting/trial-balance')}
                >
                  {isRTL ? 'فتح الميزان' : 'Open Trial Balance'}
                </Button>
              </CardContent>
            </Card>
          </div>

          <div className="mt-6 p-4 bg-gray-50 dark:bg-gray-900 rounded-lg">
            <h3 className="font-semibold mb-2">{isRTL ? 'معلومات الترحيل' : 'Posting Information'}</h3>
            <ul className="space-y-2 text-sm text-muted-foreground">
              <li>• {isRTL ? 'الترحيل يتم من صفحة القيود' : 'Posting is done from Journal Entries page'}</li>
              <li>• {isRTL ? 'يمكن ترحيل قيود متعددة دفعة واحدة' : 'Multiple entries can be posted at once'}</li>
              <li>• {isRTL ? 'يجب أن يكون القيد متوازن قبل الترحيل' : 'Entry must be balanced before posting'}</li>
              <li>• {isRTL ? 'بعد الترحيل لا يمكن تعديل القيد' : 'After posting, entry cannot be modified'}</li>
            </ul>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// Main Accounting Module Router
export function AccountingModule() {
  return (
    <Suspense fallback={<LoadingSpinner />}>
      <Routes>
        <Route path="/" element={<AccountingOverview />} />
        <Route path="/overview" element={<AccountingOverview />} />
        <Route path="/journal-entries" element={<JournalEntries />} />
        <Route path="/trial-balance" element={<TrialBalance />} />
        <Route path="/account-statement" element={<AccountStatement />} />
        <Route path="/posting" element={<PostingPage />} />
        <Route path="/reconciliation" element={<ReconciliationPage />} />
        <Route path="*" element={<Navigate to="/accounting" replace />} />
      </Routes>
    </Suspense>
  );
}

