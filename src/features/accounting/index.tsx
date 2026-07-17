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
  const { t, i18n } = useTranslation();
  const isRTL = i18n.language === 'ar';

  const localizedModules = accountingModules.map(m => getLocalizedModule(m, isRTL));

  return (
    <div className="container mx-auto p-6 space-y-6" dir={isRTL ? 'rtl' : 'ltr'}>
      <div>
        <h1 className="text-3xl font-bold mb-2">
          {t('accountingHome.title')}
        </h1>
        <p className="text-muted-foreground">
          {t('accountingHome.subtitle')}
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
  const { t, i18n } = useTranslation();
  const isRTL = i18n.language === 'ar';
  const navigate = useNavigate();

  return (
    <div className="container mx-auto p-6" dir={isRTL ? 'rtl' : 'ltr'}>
      <Card>
        <CardHeader>
          <CardTitle>{t('accountingHome.posting.title')}</CardTitle>
          <CardDescription>
            {t('accountingHome.posting.description')}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4">
            <p className="text-sm text-blue-800 dark:text-blue-200">
              {t('accountingHome.posting.tip')}
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
                <CardTitle className="text-lg">{t('accountingHome.posting.journalEntries')}</CardTitle>
                <CardDescription>
                  {t('accountingHome.posting.journalEntriesDesc')}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Button className="w-full" variant="outline">
                  {t('accountingHome.posting.openEntries')}
                </Button>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-lg">{t('accountingHome.posting.trialBalance')}</CardTitle>
                <CardDescription>
                  {t('accountingHome.posting.trialBalanceDesc')}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Button 
                  className="w-full" 
                  variant="outline"
                  onClick={() => navigate('/accounting/trial-balance')}
                >
                  {t('accountingHome.posting.openTrialBalance')}
                </Button>
              </CardContent>
            </Card>
          </div>

          <div className="mt-6 p-4 bg-muted/50 dark:bg-gray-900 rounded-lg">
            <h3 className="font-semibold mb-2">{t('accountingHome.posting.infoTitle')}</h3>
            <ul className="space-y-2 text-sm text-muted-foreground">
              <li>• {t('accountingHome.posting.info1')}</li>
              <li>• {t('accountingHome.posting.info2')}</li>
              <li>• {t('accountingHome.posting.info3')}</li>
              <li>• {t('accountingHome.posting.info4')}</li>
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

