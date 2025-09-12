import { Routes, Route, Navigate, Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useState } from 'react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { 
  Settings as SettingsIcon, 
  Building, 
  Users, 
  Shield, 
  Cog, 
  Plug, 
  Database,
  Bell,
  Palette,
  Globe,
  Key,
  FileText,
  Monitor
} from 'lucide-react'

export function SettingsModule() {
  return (
    <Routes>
      <Route path="/" element={<SettingsOverview />} />
      <Route path="/company" element={<CompanySettings />} />
      <Route path="/users" element={<UserManagement />} />
      <Route path="/permissions" element={<PermissionsManagement />} />
      <Route path="/system" element={<SystemSettings />} />
      <Route path="/integrations" element={<IntegrationsSettings />} />
      <Route path="/backup" element={<BackupSettings />} />
      <Route path="*" element={<Navigate to="/settings" replace />} />
    </Routes>
  )
}

function SettingsOverview() {
  const { t, i18n } = useTranslation()
  const isRTL = i18n.language === 'ar'
  
  const settingsCategories = [
    {
      title: 'بيانات الشركة',
      description: 'إعدادات الشركة والمعلومات الأساسية',
      icon: Building,
      href: '/settings/company',
      color: 'text-blue-600',
      bgColor: 'bg-blue-50',
      options: ['معلومات الشركة', 'عنوان المراسلة', 'الشعار والهوية']
    },
    {
      title: 'إدارة المستخدمين',
      description: 'إضافة وإدارة حسابات المستخدمين',
      icon: Users,
      href: '/settings/users',
      color: 'text-green-600',
      bgColor: 'bg-green-50',
      options: ['إضافة مستخدمين', 'إدارة الأدوار', 'فرق العمل']
    },
    {
      title: 'الصلاحيات والأمان',
      description: 'إدارة صلاحيات الوصول والأمان',
      icon: Shield,
      href: '/settings/permissions',
      color: 'text-red-600',
      bgColor: 'bg-red-50',
      options: ['صلاحيات الوصول', 'أمان البيانات', 'مراجعة العمليات']
    },
    {
      title: 'إعدادات النظام',
      description: 'إعدادات عامة للنظام',
      icon: Cog,
      href: '/settings/system',
      color: 'text-purple-600',
      bgColor: 'bg-purple-50',
      options: ['عام', 'إشعارات', 'وظائف مجدولة']
    },
    {
      title: 'التكاملات',
      description: 'ربط النظام مع الخدمات الخارجية',
      icon: Plug,
      href: '/settings/integrations',
      color: 'text-orange-600',
      bgColor: 'bg-orange-50',
      options: ['بريد إلكتروني', 'أنظمة محاسبية', 'الخدمات السحابية']
    },
    {
      title: 'النسخ الاحتياطي',
      description: 'نسخ واستعادة بيانات النظام',
      icon: Database,
      href: '/settings/backup',
      color: 'text-indigo-600',
      bgColor: 'bg-indigo-50',
      options: ['نسخ تلقائي', 'استعادة بيانات', 'جدولة النسخ']
    }
  ]
  
  return (
    <div className="space-y-8">
      <div className={cn(isRTL ? "text-right" : "text-left")}>
        <h1 className="text-3xl font-bold">{t('settings.title')}</h1>
        <p className="text-muted-foreground mt-2">
          إدارة إعدادات وتكوين النظام
        </p>
      </div>

      {/* Quick Info */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-card rounded-lg border p-4">
          <div className="text-2xl font-bold text-blue-600">5</div>
          <div className="text-sm text-muted-foreground">مستخدمين نشطين</div>
        </div>
        <div className="bg-card rounded-lg border p-4">
          <div className="text-2xl font-bold text-green-600">12</div>
          <div className="text-sm text-muted-foreground">تكاملات نشطة</div>
        </div>
        <div className="bg-card rounded-lg border p-4">
          <div className="text-2xl font-bold text-purple-600">24h</div>
          <div className="text-sm text-muted-foreground">آخر نسخة احتياطية</div>
        </div>
        <div className="bg-card rounded-lg border p-4">
          <div className="text-2xl font-bold text-orange-600">99.9%</div>
          <div className="text-sm text-muted-foreground">وقت تشغيل النظام</div>
        </div>
      </div>

      {/* Settings Categories Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {settingsCategories.map((category) => {
          const Icon = category.icon
          return (
            <Link key={category.href} to={category.href} className="bg-card rounded-lg border hover:shadow-md transition-all duration-200">
              <div className="p-6">
                <div className={cn("flex items-center gap-3 mb-4", isRTL ? "flex-row-reverse" : "")}>
                  <div className={cn("p-2 rounded-lg", category.bgColor)}>
                    <Icon className={cn("h-6 w-6", category.color)} />
                  </div>
                  <h3 className={cn("font-semibold text-lg", isRTL ? "text-right" : "text-left")}>
                    {category.title}
                  </h3>
                </div>
                <p className={cn("text-muted-foreground text-sm mb-4", isRTL ? "text-right" : "text-left")}>
                  {category.description}
                </p>
                <div className="space-y-1">
                  {category.options.map((option, index) => (
                    <div key={index} className={cn("flex items-center gap-2 text-xs text-muted-foreground", isRTL ? "flex-row-reverse" : "")}>
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

      {/* System Status */}
      <div className="bg-card rounded-lg border">
        <div className="p-6 border-b">
          <h3 className="text-lg font-semibold">حالة النظام</h3>
        </div>
        <div className="p-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="flex items-center gap-3">
              <div className="w-3 h-3 bg-green-500 rounded-full"></div>
              <span className="text-sm">الخادم يعمل بشكل طبيعي</span>
            </div>
            <div className="flex items-center gap-3">
              <div className="w-3 h-3 bg-green-500 rounded-full"></div>
              <span className="text-sm">قاعدة البيانات متصلة</span>
            </div>
            <div className="flex items-center gap-3">
              <div className="w-3 h-3 bg-green-500 rounded-full"></div>
              <span className="text-sm">جميع الخدمات متاحة</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

// Company Settings Component
function CompanySettings() {
  const { t, i18n } = useTranslation()
  const isRTL = i18n.language === 'ar'

  return (
    <div className="space-y-6">
      <div className={cn(isRTL ? "text-right" : "text-left")}>
        <h1 className="text-3xl font-bold">بيانات الشركة</h1>
        <p className="text-muted-foreground mt-2">
          إعدادات الشركة والمعلومات الأساسية
        </p>
      </div>
      <div className="bg-card rounded-lg border p-6">
        <p className={cn(
          "text-muted-foreground",
          isRTL ? "text-right" : "text-left"
        )}>
          قريباً - معلومات الشركة، عنوان المراسلة، الشعار والهوية
        </p>
      </div>
    </div>
  )
}

// User Management Component
function UserManagement() {
  const { t, i18n } = useTranslation()
  const isRTL = i18n.language === 'ar'

  return (
    <div className="space-y-6">
      <div className={cn(isRTL ? "text-right" : "text-left")}>
        <h1 className="text-3xl font-bold">إدارة المستخدمين</h1>
        <p className="text-muted-foreground mt-2">
          إضافة وإدارة حسابات المستخدمين
        </p>
      </div>
      <div className="bg-card rounded-lg border p-6">
        <p className={cn(
          "text-muted-foreground",
          isRTL ? "text-right" : "text-left"
        )}>
          قريباً - إضافة مستخدمين، إدارة الأدوار، فرق العمل
        </p>
      </div>
    </div>
  )
}

// Permissions Management Component
function PermissionsManagement() {
  const { t, i18n } = useTranslation()
  const isRTL = i18n.language === 'ar'

  return (
    <div className="space-y-6">
      <div className={cn(isRTL ? "text-right" : "text-left")}>
        <h1 className="text-3xl font-bold">الصلاحيات والأمان</h1>
        <p className="text-muted-foreground mt-2">
          إدارة صلاحيات الوصول وأمان النظام
        </p>
      </div>
      <div className="bg-card rounded-lg border p-6">
        <p className={cn(
          "text-muted-foreground",
          isRTL ? "text-right" : "text-left"
        )}>
          قريباً - صلاحيات الوصول، أمان البيانات، مراجعة العمليات
        </p>
      </div>
    </div>
  )
}

// System Settings Component
function SystemSettings() {
  const { t, i18n } = useTranslation()
  const isRTL = i18n.language === 'ar'

  return (
    <div className="space-y-6">
      <div className={cn(isRTL ? "text-right" : "text-left")}>
        <h1 className="text-3xl font-bold">إعدادات النظام</h1>
        <p className="text-muted-foreground mt-2">
          إعدادات عامة وتكوين النظام
        </p>
      </div>
      <div className="bg-card rounded-lg border p-6">
        <p className={cn(
          "text-muted-foreground",
          isRTL ? "text-right" : "text-left"
        )}>
          قريباً - إعدادات عامة، إشعارات، وظائف مجدولة
        </p>
      </div>
    </div>
  )
}

// Integrations Settings Component
function IntegrationsSettings() {
  const { t, i18n } = useTranslation()
  const isRTL = i18n.language === 'ar'

  return (
    <div className="space-y-6">
      <div className={cn(isRTL ? "text-right" : "text-left")}>
        <h1 className="text-3xl font-bold">التكاملات</h1>
        <p className="text-muted-foreground mt-2">
          ربط النظام مع الخدمات الخارجية
        </p>
      </div>
      <div className="bg-card rounded-lg border p-6">
        <p className={cn(
          "text-muted-foreground",
          isRTL ? "text-right" : "text-left"
        )}>
          قريباً - بريد إلكتروني، أنظمة محاسبية، الخدمات السحابية
        </p>
      </div>
    </div>
  )
}

// Backup Settings Component
function BackupSettings() {
  const { t, i18n } = useTranslation()
  const isRTL = i18n.language === 'ar'

  return (
    <div className="space-y-6">
      <div className={cn(isRTL ? "text-right" : "text-left")}>
        <h1 className="text-3xl font-bold">النسخ الاحتياطي</h1>
        <p className="text-muted-foreground mt-2">
          نسخ واستعادة بيانات النظام
        </p>
      </div>
      <div className="bg-card rounded-lg border p-6">
        <p className={cn(
          "text-muted-foreground",
          isRTL ? "text-right" : "text-left"
        )}>
          قريباً - نسخ تلقائي، استعادة بيانات، جدولة النسخ
        </p>
      </div>
    </div>
  )
}