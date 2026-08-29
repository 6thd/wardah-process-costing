/**
 * Accounting Module Configuration
 * Extracted to reduce complexity in AccountingOverview component
 */

import { FileText, Scale, Receipt, BookOpen, CheckCircle2, BarChart3, type LucideIcon } from 'lucide-react';

export interface AccountingModule {
  titleAr: string;
  titleEn: string;
  descriptionAr: string;
  descriptionEn: string;
  icon: LucideIcon;
  href: string;
  color: string;
  bgColor: string;
  featuresAr: string[];
  featuresEn: string[];
  /**
   * أي مفتاح من هذه القائمة كافٍ لإظهار البطاقة — يطابق متطلب المسار الفعلي
   * لـhref في src/config/route-permissions.ts. بعض البطاقات تقود إلى موديول
   * آخر (general_ledger، reports)، فمفتاحها من كتالوج ذلك الموديول لا accounting.
   */
  requiredKeys: string[];
}

export const accountingModules: AccountingModule[] = [
  {
    titleAr: 'قيود اليومية',
    titleEn: 'Journal Entries',
    descriptionAr: 'إنشاء وإدارة القيود المحاسبية',
    descriptionEn: 'Create and manage accounting journal entries',
    icon: FileText,
    href: '/accounting/journal-entries',
    color: 'text-blue-600',
    bgColor: 'bg-blue-50',
    featuresAr: ['إضافة قيود جديدة', 'ترحيل مجمع', 'نظام الموافقات', 'المرفقات والتعليقات'],
    featuresEn: ['Add new entries', 'Batch posting', 'Approval workflow', 'Attachments & comments'],
    requiredKeys: ['accounting.journals.read'],
  },
  {
    titleAr: 'ميزان المراجعة',
    titleEn: 'Trial Balance',
    descriptionAr: 'عرض الأرصدة والحركات المحاسبية',
    descriptionEn: 'View account balances and movements',
    icon: Scale,
    href: '/accounting/trial-balance',
    color: 'text-green-600',
    bgColor: 'bg-green-50',
    featuresAr: ['أرصدة افتتاحية وختامية', 'حركة الفترة', 'تصدير Excel/PDF', 'فلترة متقدمة'],
    featuresEn: ['Opening & closing balances', 'Period movement', 'Export Excel/PDF', 'Advanced filtering'],
    requiredKeys: ['reports.financial.read'],
  },
  {
    titleAr: 'كشف حساب',
    titleEn: 'Account Statement',
    descriptionAr: 'كشف حساب تفصيلي مع جميع الحركات',
    descriptionEn: 'Detailed account statement with all transactions',
    icon: Receipt,
    href: '/accounting/account-statement',
    color: 'text-purple-600',
    bgColor: 'bg-purple-50',
    featuresAr: ['حركات تفصيلية', 'رصيد متحرك', 'تصدير Excel/PDF', 'فلترة حسب الفترة'],
    featuresEn: ['Detailed transactions', 'Running balance', 'Export Excel/PDF', 'Period filtering'],
    requiredKeys: ['accounting.entries.read', 'accounting.accounts.read', 'general_ledger.account_statement.view'],
  },
  {
    titleAr: 'دليل الحسابات',
    titleEn: 'Chart of Accounts',
    descriptionAr: 'إدارة شجرة الحسابات المحاسبية',
    descriptionEn: 'Manage accounting chart of accounts',
    icon: BookOpen,
    href: '/general-ledger/accounts',
    color: 'text-orange-600',
    bgColor: 'bg-orange-50',
    featuresAr: ['شجرة هرمية', 'إضافة/تعديل/حذف', 'دعم ثنائي اللغة', 'بحث متقدم'],
    featuresEn: ['Hierarchical tree', 'Add/Edit/Delete', 'Bilingual support', 'Advanced search'],
    // موديول آخر (general_ledger) — مفتاحه لا accounting.
    requiredKeys: ['general_ledger.chart_of_accounts.view'],
  },
  {
    titleAr: 'الترحيل',
    titleEn: 'Posting',
    descriptionAr: 'ترحيل القيود إلى دفتر الأستاذ',
    descriptionEn: 'Post entries to general ledger',
    icon: CheckCircle2,
    href: '/accounting/posting',
    color: 'text-indigo-600',
    bgColor: 'bg-indigo-50',
    featuresAr: ['ترحيل فردي', 'ترحيل مجمع', 'التحقق من التوازن', 'سجل الترحيل'],
    featuresEn: ['Individual posting', 'Batch posting', 'Balance verification', 'Posting log'],
    // صفحة روابط ثابتة بلا بيانات خاصة بها — نفس متطلب نظرة accounting العامة.
    requiredKeys: ['accounting.journals.read', 'accounting.entries.read', 'accounting.accounts.read', 'accounting.cost_centers.read'],
  },
  {
    titleAr: 'التقارير المالية',
    titleEn: 'Financial Reports',
    descriptionAr: 'تقارير مالية شاملة ومتقدمة',
    descriptionEn: 'Comprehensive and advanced financial reports',
    icon: BarChart3,
    href: '/reports/financial',
    color: 'text-red-600',
    bgColor: 'bg-red-50',
    featuresAr: ['قائمة الدخل', 'الميزانية العمومية', 'التدفقات النقدية', 'تقارير مخصصة'],
    featuresEn: ['Income Statement', 'Balance Sheet', 'Cash Flow', 'Custom reports'],
    // موديول آخر (reports) — مفتاحه لا accounting.
    requiredKeys: ['reports.financial.read'],
  }
];

/**
 * Get localized module data
 */
export function getLocalizedModule(module: AccountingModule, isRTL: boolean) {
  return {
    title: isRTL ? module.titleAr : module.titleEn,
    description: isRTL ? module.descriptionAr : module.descriptionEn,
    icon: module.icon,
    href: module.href,
    color: module.color,
    bgColor: module.bgColor,
    features: isRTL ? module.featuresAr : module.featuresEn,
    requiredKeys: module.requiredKeys,
  };
}
