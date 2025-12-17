import { Routes, Route, Navigate, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { lazy, Suspense } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { 
  BookOpen, 
  FileText, 
  Scale, 
  Receipt,
  TrendingUp,
  DollarSign,
  BarChart3,
  Calculator,
  CheckCircle2,
  FileCheck
} from 'lucide-react';
import { Button } from '@/components/ui/button';

// Lazy load components
const JournalEntries = lazy(() => import('./journal-entries').then(m => ({ default: m.default })));
const TrialBalance = lazy(() => import('./trial-balance').then(m => ({ default: m.default })));
const AccountStatement = lazy(() => import('./account-statement').then(m => ({ default: m.AccountStatement })));

// Loading component
function LoadingSpinner() {
  return (
    <div className="flex items-center justify-center min-h-[400px]">
      <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
    </div>
  );
}

// Accounting Overview Page
function AccountingOverview() {
  const { i18n } = useTranslation();
  const isRTL = i18n.language === 'ar';
  const navigate = useNavigate();

  const modules = [
    {
      title: isRTL ? 'قيود اليومية' : 'Journal Entries',
      description: isRTL ? 'إنشاء وإدارة القيود المحاسبية' : 'Create and manage accounting journal entries',
      icon: FileText,
      href: '/accounting/journal-entries',
      color: 'text-blue-600',
      bgColor: 'bg-blue-50',
      features: [
        isRTL ? 'إضافة قيود جديدة' : 'Add new entries',
        isRTL ? 'ترحيل مجمع' : 'Batch posting',
        isRTL ? 'نظام الموافقات' : 'Approval workflow',
        isRTL ? 'المرفقات والتعليقات' : 'Attachments & comments'
      ]
    },
    {
      title: isRTL ? 'ميزان المراجعة' : 'Trial Balance',
      description: isRTL ? 'عرض الأرصدة والحركات المحاسبية' : 'View account balances and movements',
      icon: Scale,
      href: '/accounting/trial-balance',
      color: 'text-green-600',
      bgColor: 'bg-green-50',
      features: [
        isRTL ? 'أرصدة افتتاحية وختامية' : 'Opening & closing balances',
        isRTL ? 'حركة الفترة' : 'Period movement',
        isRTL ? 'تصدير Excel/PDF' : 'Export Excel/PDF',
        isRTL ? 'فلترة متقدمة' : 'Advanced filtering'
      ]
    },
    {
      title: isRTL ? 'كشف حساب' : 'Account Statement',
      description: isRTL ? 'كشف حساب تفصيلي مع جميع الحركات' : 'Detailed account statement with all transactions',
      icon: Receipt,
      href: '/accounting/account-statement',
      color: 'text-purple-600',
      bgColor: 'bg-purple-50',
      features: [
        isRTL ? 'حركات تفصيلية' : 'Detailed transactions',
        isRTL ? 'رصيد متحرك' : 'Running balance',
        isRTL ? 'تصدير Excel/PDF' : 'Export Excel/PDF',
        isRTL ? 'فلترة حسب الفترة' : 'Period filtering'
      ]
    },
    {
      title: isRTL ? 'دليل الحسابات' : 'Chart of Accounts',
      description: isRTL ? 'إدارة شجرة الحسابات المحاسبية' : 'Manage accounting chart of accounts',
      icon: BookOpen,
      href: '/general-ledger/accounts',
      color: 'text-orange-600',
      bgColor: 'bg-orange-50',
      features: [
        isRTL ? 'شجرة هرمية' : 'Hierarchical tree',
        isRTL ? 'إضافة/تعديل/حذف' : 'Add/Edit/Delete',
        isRTL ? 'دعم ثنائي اللغة' : 'Bilingual support',
        isRTL ? 'بحث متقدم' : 'Advanced search'
      ]
    },
    {
      title: isRTL ? 'الترحيل' : 'Posting',
      description: isRTL ? 'ترحيل القيود إلى دفتر الأستاذ' : 'Post entries to general ledger',
      icon: CheckCircle2,
      href: '/accounting/posting',
      color: 'text-indigo-600',
      bgColor: 'bg-indigo-50',
      features: [
        isRTL ? 'ترحيل فردي' : 'Individual posting',
        isRTL ? 'ترحيل مجمع' : 'Batch posting',
        isRTL ? 'التحقق من التوازن' : 'Balance verification',
        isRTL ? 'سجل الترحيل' : 'Posting log'
      ]
    },
    {
      title: isRTL ? 'التقارير المالية' : 'Financial Reports',
      description: isRTL ? 'تقارير مالية شاملة ومتقدمة' : 'Comprehensive and advanced financial reports',
      icon: BarChart3,
      href: '/reports/financial',
      color: 'text-red-600',
      bgColor: 'bg-red-50',
      features: [
        isRTL ? 'قائمة الدخل' : 'Income Statement',
        isRTL ? 'الميزانية العمومية' : 'Balance Sheet',
        isRTL ? 'التدفقات النقدية' : 'Cash Flow',
        isRTL ? 'تقارير مخصصة' : 'Custom reports'
      ]
    }
  ];

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
        {modules.map((module) => {
          const Icon = module.icon;
          return (
            <Card 
              key={module.href}
              className="hover:shadow-lg transition-shadow cursor-pointer group"
              onClick={() => navigate(module.href)}
            >
              <CardHeader>
                <div className="flex items-start justify-between">
                  <div className={`p-3 rounded-lg ${module.bgColor}`}>
                    <Icon className={`h-6 w-6 ${module.color}`} />
                  </div>
                </div>
                <CardTitle className="mt-4">{module.title}</CardTitle>
                <CardDescription>{module.description}</CardDescription>
              </CardHeader>
              <CardContent>
                <ul className="space-y-2 text-sm text-muted-foreground">
                  {module.features.map((feature, index) => (
                    <li key={index} className="flex items-center gap-2">
                      <div className="h-1.5 w-1.5 rounded-full bg-primary" />
                      {feature}
                    </li>
                  ))}
                </ul>
                <Button 
                  className="w-full mt-4" 
                  variant="outline"
                  onClick={(e) => {
                    e.stopPropagation();
                    navigate(module.href);
                  }}
                >
                  {isRTL ? 'فتح' : 'Open'}
                </Button>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Quick Stats - Will be populated with real data */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mt-8">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>{isRTL ? 'القيود المسودة' : 'Draft Entries'}</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-blue-600">-</div>
            <p className="text-xs text-muted-foreground mt-1">
              {isRTL ? 'في انتظار الترحيل' : 'Pending posting'}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>{isRTL ? 'القيود المرحلة' : 'Posted Entries'}</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-600">-</div>
            <p className="text-xs text-muted-foreground mt-1">
              {isRTL ? 'تم الترحيل' : 'Posted'}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>{isRTL ? 'إجمالي الحسابات' : 'Total Accounts'}</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-purple-600">-</div>
            <p className="text-xs text-muted-foreground mt-1">
              {isRTL ? 'حسابات نشطة' : 'Active accounts'}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>{isRTL ? 'آخر قيد' : 'Last Entry'}</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="text-sm text-muted-foreground">-</div>
            <p className="text-xs text-muted-foreground mt-1">
              {isRTL ? 'تاريخ آخر قيد' : 'Last entry date'}
            </p>
          </CardContent>
        </Card>
      </div>
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
            <Card className="hover:shadow-md transition-shadow cursor-pointer" onClick={() => navigate('/accounting/journal-entries')}>
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
        <Route path="*" element={<Navigate to="/accounting" replace />} />
      </Routes>
    </Suspense>
  );
}

