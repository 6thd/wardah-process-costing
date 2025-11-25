// src/components/auth/ModuleGuard.tsx
// بسم الله الرحمن الرحيم
// مكون لحماية الموديولات بناءً على الصلاحيات

import { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { usePermissions } from '@/hooks/usePermissions';
import { Loader2, Lock, ShieldAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useTranslation } from 'react-i18next';

// =====================================
// Types
// =====================================

interface ModuleGuardProps {
  children: ReactNode;
  /** كود الموديول */
  moduleCode?: string;
  /** الإجراء المطلوب */
  action?: string;
  /** يتطلب Org Admin */
  requireOrgAdmin?: boolean;
  /** يتطلب Super Admin */
  requireSuperAdmin?: boolean;
  /** إعادة التوجيه إلى مسار معين عند عدم الصلاحية */
  redirectTo?: string;
  /** عرض رسالة بدلاً من إعادة التوجيه */
  showAccessDenied?: boolean;
}

// =====================================
// صفحة رفض الوصول
// =====================================

function AccessDeniedPage() {
  const { t, i18n } = useTranslation();
  const isRTL = i18n.language === 'ar';

  return (
    <div className="min-h-[60vh] flex items-center justify-center">
      <div className="text-center space-y-6 p-8 max-w-md">
        {/* أيقونة */}
        <div className="mx-auto w-20 h-20 rounded-full bg-destructive/10 flex items-center justify-center">
          <ShieldAlert className="w-10 h-10 text-destructive" />
        </div>

        {/* العنوان */}
        <div className="space-y-2">
          <h1 className="text-2xl font-bold text-foreground">
            {isRTL ? 'الوصول مرفوض' : 'Access Denied'}
          </h1>
          <p className="text-muted-foreground">
            {isRTL 
              ? 'ليس لديك الصلاحية للوصول إلى هذه الصفحة. يرجى التواصل مع مسؤول النظام.' 
              : 'You don\'t have permission to access this page. Please contact your administrator.'}
          </p>
        </div>

        {/* الأزرار */}
        <div className="flex flex-col sm:flex-row gap-3 justify-center">
          <Button
            variant="outline"
            onClick={() => window.history.back()}
          >
            <Lock className="w-4 h-4 mr-2" />
            {isRTL ? 'العودة' : 'Go Back'}
          </Button>
          <Button
            onClick={() => window.location.href = '/dashboard'}
          >
            {isRTL ? 'الصفحة الرئيسية' : 'Go to Dashboard'}
          </Button>
        </div>
      </div>
    </div>
  );
}

// =====================================
// مكون التحميل
// =====================================

function LoadingState() {
  const { i18n } = useTranslation();
  const isRTL = i18n.language === 'ar';

  return (
    <div className="min-h-[60vh] flex items-center justify-center">
      <div className="text-center space-y-4">
        <Loader2 className="h-10 w-10 animate-spin text-primary mx-auto" />
        <p className="text-muted-foreground">
          {isRTL ? 'جاري التحقق من الصلاحيات...' : 'Checking permissions...'}
        </p>
      </div>
    </div>
  );
}

// =====================================
// ModuleGuard Component
// =====================================

export function ModuleGuard({
  children,
  moduleCode,
  action = 'view',
  requireOrgAdmin = false,
  requireSuperAdmin = false,
  redirectTo,
  showAccessDenied = true,
}: ModuleGuardProps) {
  const location = useLocation();
  const {
    hasPermission,
    isOrgAdmin,
    isSuperAdmin,
    loading,
  } = usePermissions();

  // حالة التحميل
  if (loading) {
    return <LoadingState />;
  }

  // التحقق من الصلاحيات
  let hasAccess = true;

  // التحقق من Super Admin
  if (requireSuperAdmin && !isSuperAdmin) {
    hasAccess = false;
  }

  // التحقق من Org Admin
  if (hasAccess && requireOrgAdmin && !isOrgAdmin && !isSuperAdmin) {
    hasAccess = false;
  }

  // التحقق من صلاحية الموديول
  if (hasAccess && moduleCode && action) {
    hasAccess = hasPermission(moduleCode, action);
  }

  // إذا لم يكن لديه صلاحية
  if (!hasAccess) {
    // إعادة التوجيه
    if (redirectTo) {
      return <Navigate to={redirectTo} state={{ from: location }} replace />;
    }

    // عرض صفحة رفض الوصول
    if (showAccessDenied) {
      return <AccessDeniedPage />;
    }

    // إعادة التوجيه الافتراضية
    return <Navigate to="/dashboard" state={{ from: location }} replace />;
  }

  return <>{children}</>;
}

// =====================================
// HOC لحماية الموديولات
// =====================================

export function withModuleGuard<P extends object>(
  WrappedComponent: React.ComponentType<P>,
  options: {
    moduleCode?: string;
    action?: string;
    requireOrgAdmin?: boolean;
    requireSuperAdmin?: boolean;
  }
) {
  return function GuardedComponent(props: P) {
    return (
      <ModuleGuard {...options}>
        <WrappedComponent {...props} />
      </ModuleGuard>
    );
  };
}

export default ModuleGuard;

