import { Routes, Route, Navigate, Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'
import { PageHeader } from '@/components/ui/page-header'
import { Settings as SettingsIcon, Building, Users, Shield, Cog, Database } from 'lucide-react'
import { CompanySettings } from './CompanySettings'
import { SystemSettingsPage } from './SystemSettingsPage'
import { BackupSettingsPage } from './BackupSettingsPage'

export function SettingsModule() {
  return <Routes>
    <Route path="/" element={<SettingsOverview />} />
    <Route path="/company" element={<CompanySettings />} />
    <Route path="/users" element={<Navigate to="/org-admin/users" replace />} />
    <Route path="/permissions" element={<Navigate to="/org-admin/roles" replace />} />
    <Route path="/system" element={<SystemSettingsPage />} />
    <Route path="/integrations" element={<Navigate to="/settings" replace />} />
    <Route path="/backup" element={<BackupSettingsPage />} />
    <Route path="*" element={<Navigate to="/settings" replace />} />
  </Routes>
}

function SettingsOverview() {
  const { i18n } = useTranslation()
  const isRTL = i18n.language === 'ar'
  const tr = (ar: string, en: string) => isRTL ? ar : en
  const categories = [
    { title: tr('بيانات الشركة','Company Profile'), description: tr('معلومات الشركة والهوية والإعدادات العامة','Company information, identity and general settings'), icon: Building, href:'/settings/company', options:[tr('المعلومات الأساسية','Basic information'),tr('بيانات التواصل','Contact details'),tr('الشعار والهوية','Logo and branding')] },
    { title: tr('إدارة المؤسسة','Organization Management'), description: tr('المستخدمون والأدوار والصلاحيات','Users, roles and permissions'), icon: Users, href:'/org-admin', options:[tr('إدارة المستخدمين','User management'),tr('الأدوار والصلاحيات','Roles and permissions'),tr('الدعوات','Invitations')] },
    { title: tr('الأمان والوصول','Security & Access'), description: tr('سياسات الوصول وصلاحيات الأدوار','Access policies and role permissions'), icon: Shield, href:'/org-admin/roles', options:[tr('الأدوار','Roles'),tr('مصفوفة الصلاحيات','Permission matrix'),tr('سياسات الوصول','Access policies')] },
    { title: tr('إعدادات النظام','System Settings'), description: tr('تنسيق الأرقام والتقويم وإعدادات العرض','Number, calendar and display formatting'), icon: Cog, href:'/settings/system', options:[tr('تنسيق الأرقام','Number format'),tr('التقويم','Calendar'),tr('المخزن الافتراضي','Default warehouse')] },
    { title: tr('النسخ الاحتياطي','Backup & Export'), description: tr('تصدير بيانات المؤسسة ونسخها','Export and preserve organization data'), icon: Database, href:'/settings/backup', options:[tr('تصدير JSON','JSON export'),tr('تصدير CSV','CSV export'),tr('بيانات المؤسسة','Organization data')] },
  ]
  return <div className="space-y-8" dir={isRTL ? 'rtl' : 'ltr'}>
    <PageHeader title={tr('الإعدادات','Settings')} description={tr('إدارة إعدادات وتكوين النظام','Manage system configuration')} hideOnPrint={false} />
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
      {categories.map(category => { const Icon=category.icon; return <Link key={category.href} to={category.href} className="bg-card rounded-lg border hover:shadow-md transition-all duration-200"><div className="p-6"><div className={cn('flex items-center gap-3 mb-4',isRTL?'flex-row-reverse':'')}><div className="p-2 rounded-lg bg-muted"><Icon className="h-6 w-6 text-primary" /></div><h3 className={cn('font-semibold text-lg',isRTL?'text-right':'text-left')}>{category.title}</h3></div><p className={cn('text-muted-foreground text-sm mb-4',isRTL?'text-right':'text-left')}>{category.description}</p><div className="space-y-1">{category.options.map(option=><div key={option} className={cn('flex items-center gap-2 text-xs text-muted-foreground',isRTL?'flex-row-reverse':'')}><SettingsIcon className="h-3 w-3" /><span>{option}</span></div>)}</div></div></Link> })}
    </div>
  </div>
}
