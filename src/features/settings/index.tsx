import { Routes, Route, Navigate, Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'
import { PageHeader } from '@/components/ui/page-header'
import {
  Settings as SettingsIcon,
  Building,
  Users,
  Shield,
  Cog,
  Plug,
  Database,
} from 'lucide-react'
import { CompanySettings } from './CompanySettings'
import { SystemSettingsPage } from './SystemSettingsPage'
import { BackupSettingsPage } from './BackupSettingsPage'

export function SettingsModule() {
  return (
    <Routes>
      <Route path="/" element={<SettingsOverview />} />
      <Route path="/company" element={<CompanySettings />} />
      <Route path="/users" element={<Navigate to="/org-admin/users" replace />} />
      <Route path="/permissions" element={<Navigate to="/org-admin/roles" replace />} />
      <Route path="/system" element={<SystemSettingsPage />} />
      <Route path="/integrations" element={<Navigate to="/settings" replace />} />
      <Route path="/backup" element={<BackupSettingsPage />} />
      <Route path="*" element={<Navigate to="/settings" replace />} />
    </Routes>
  )
}

function SettingsOverview() {
  const { i18n } = useTranslation()
  const isRTL = (i18n.resolvedLanguage ?? i18n.language).toLowerCase().startsWith('ar')
  const tr = (ar: string, en: string) => isRTL ? ar : en

  const settingsCategories = [
    {
      title: tr('بيانات الشركة', 'Company Profile'),
      description: tr('إعدادات الشركة والمعلومات الأساسية', 'Company settings and core information'),
      icon: Building,
      href: '/settings/company',
      color: 'text-blue-600',
      bgColor: 'bg-blue-50',
      options: [
        tr('معلومات الشركة', 'Company information'),
        tr('عنوان المراسلة', 'Mailing address'),
        tr('الشعار والهوية', 'Logo and branding'),
      ],
    },
    {
      title: tr('إدارة المؤسسة', 'Organization Management'),
      description: tr('إدارة المستخدمين والأدوار والصلاحيات', 'Manage users, roles and permissions'),
      icon: Users,
      href: '/org-admin',
      color: 'text-green-600',
      bgColor: 'bg-green-50',
      options: [
        tr('إدارة المستخدمين', 'User management'),
        tr('الأدوار والصلاحيات', 'Roles and permissions'),
        tr('الدعوات', 'Invitations'),
      ],
    },
    {
      title: tr('الأمان والوصول', 'Security & Access'),
      description: tr('إعدادات الأمان وسياسات الوصول', 'Security settings and access policies'),
      icon: Shield,
      href: '/org-admin/roles',
      color: 'text-red-600',
      bgColor: 'bg-red-50',
      options: [
        tr('الأدوار', 'Roles'),
        tr('مصفوفة الصلاحيات', 'Permission matrix'),
        tr('سياسات الوصول', 'Access policies'),
      ],
    },
    {
      title: tr('إعدادات النظام', 'System Settings'),
      description: tr('إعدادات عامة للنظام', 'General system settings'),
      icon: Cog,
      href: '/settings/system',
      color: 'text-purple-600',
      bgColor: 'bg-purple-50',
      options: [
        tr('تنسيق الأرقام', 'Number format'),
        tr('التقويم', 'Calendar'),
        tr('المخزن الافتراضي', 'Default warehouse'),
      ],
    },
    {
      title: tr('التكاملات', 'Integrations'),
      description: tr('ربط النظام مع الخدمات الخارجية', 'Connect the system to external services'),
      icon: Plug,
      href: '/settings/integrations',
      color: 'text-orange-600',
      bgColor: 'bg-orange-50',
      options: [
        tr('بريد إلكتروني', 'Email'),
        tr('أنظمة محاسبية', 'Accounting systems'),
        tr('الخدمات السحابية', 'Cloud services'),
      ],
    },
    {
      title: tr('النسخ الاحتياطي', 'Backup & Export'),
      description: tr('نسخ واستعادة بيانات النظام', 'Back up and restore system data'),
      icon: Database,
      href: '/settings/backup',
      color: 'text-indigo-600',
      bgColor: 'bg-indigo-50',
      options: [
        tr('نسخ تلقائي', 'Automatic backup'),
        tr('استعادة بيانات', 'Restore data'),
        tr('جدولة النسخ', 'Backup scheduling'),
      ],
    },
  ]

  const quickInfo = [
    { value: '5', label: tr('مستخدمون نشطون', 'Active users'), valueClass: 'text-blue-600' },
    { value: '12', label: tr('تكاملات نشطة', 'Active integrations'), valueClass: 'text-green-600' },
    { value: '24h', label: tr('آخر نسخة احتياطية', 'Last backup'), valueClass: 'text-purple-600' },
    { value: '99.9%', label: tr('وقت تشغيل النظام', 'System uptime'), valueClass: 'text-orange-600' },
  ]

  const statusItems = [
    tr('الخادم يعمل بشكل طبيعي', 'Server is operating normally'),
    tr('قاعدة البيانات متصلة', 'Database is connected'),
    tr('جميع الخدمات متاحة', 'All services are available'),
  ]

  return (
    <div className="space-y-8" dir={isRTL ? 'rtl' : 'ltr'}>
      <PageHeader
        title={tr('الإعدادات', 'Settings')}
        description={tr('إدارة إعدادات وتكوين النظام', 'Manage system settings and configuration')}
        hideOnPrint={false}
      />

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        {quickInfo.map((item) => (
          <div key={item.label} className="bg-card rounded-lg border p-4">
            <div className={cn('text-2xl font-bold', item.valueClass)}>{item.value}</div>
            <div className="text-sm text-muted-foreground">{item.label}</div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {settingsCategories.map((category) => {
          const Icon = category.icon
          return (
            <Link
              key={category.href}
              to={category.href}
              className="bg-card rounded-lg border hover:shadow-md transition-all duration-200"
            >
              <div className="p-6">
                <div className={cn('flex items-center gap-3 mb-4', isRTL ? 'flex-row-reverse' : '')}>
                  <div className={cn('p-2 rounded-lg', category.bgColor)}>
                    <Icon className={cn('h-6 w-6', category.color)} />
                  </div>
                  <h3 className={cn('font-semibold text-lg', isRTL ? 'text-right' : 'text-left')}>
                    {category.title}
                  </h3>
                </div>
                <p className={cn('text-muted-foreground text-sm mb-4', isRTL ? 'text-right' : 'text-left')}>
                  {category.description}
                </p>
                <div className="space-y-1">
                  {category.options.map((option) => (
                    <div
                      key={option}
                      className={cn('flex items-center gap-2 text-xs text-muted-foreground', isRTL ? 'flex-row-reverse' : '')}
                    >
                      <SettingsIcon className="h-3 w-3" />
                      <span>{option}</span>
                    </div>
                  ))}
                </div>
              </div>
            </Link>
          )
        })}
      </div>

      <div className="bg-card rounded-lg border">
        <div className="p-6 border-b">
          <h3 className="text-lg font-semibold">{tr('حالة النظام', 'System Status')}</h3>
        </div>
        <div className="p-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {statusItems.map((item) => (
              <div key={item} className="flex items-center gap-3">
                <div className="w-3 h-3 bg-green-500 rounded-full" />
                <span className="text-sm">{item}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
