// src/components/auth/ProtectedComponent.tsx
// بسم الله الرحمن الرحيم
// مكون لحماية العناصر بناءً على الصلاحيات

import { ReactNode } from 'react';
import { usePermissions } from '@/hooks/usePermissions';
import { Skeleton } from '@/components/ui/skeleton';
import { Lock } from 'lucide-react';

// =====================================
// Types
// =====================================

interface ProtectedComponentProps {
  children: ReactNode;
  /** المديول المطلوب */
  module?: string;
  /** الإجراء المطلوب */
  action?: string;
  /** قائمة صلاحيات (أي واحدة منها تكفي) */
  anyOf?: Array<{ module: string; action: string }>;
  /** قائمة صلاحيات (يجب توفر جميعها) */
  allOf?: Array<{ module: string; action: string }>;
  /** يتطلب أن يكون مسؤول منظمة */
  requireOrgAdmin?: boolean;
  /** يتطلب أن يكون Super Admin */
  requireSuperAdmin?: boolean;
  /** ما يظهر أثناء التحميل */
  loadingComponent?: ReactNode;
  /** ما يظهر عند عدم وجود صلاحية */
  fallback?: ReactNode;
  /** إخفاء المكون بدلاً من عرض fallback */
  hide?: boolean;
}

// =====================================
// ProtectedComponent
// =====================================

export function ProtectedComponent({
  children,
  module,
  action,
  anyOf,
  allOf,
  requireOrgAdmin = false,
  requireSuperAdmin = false,
  loadingComponent,
  fallback,
  hide = false,
}: ProtectedComponentProps) {
  const {
    hasPermission,
    hasAnyPermission,
    hasAllPermissions,
    isOrgAdmin,
    isSuperAdmin,
    loading,
  } = usePermissions();

  // Loading state
  if (loading) {
    if (loadingComponent) return <>{loadingComponent}</>;
    return <Skeleton className="h-8 w-full bg-slate-800" />;
  }

  // Check permissions
  let hasAccess = true;

  // Super Admin check
  if (requireSuperAdmin && !isSuperAdmin) {
    hasAccess = false;
  }

  // Org Admin check
  if (hasAccess && requireOrgAdmin && !isOrgAdmin && !isSuperAdmin) {
    hasAccess = false;
  }

  // Single permission check
  if (hasAccess && module && action) {
    hasAccess = hasPermission(module, action);
  }

  // Any of permissions check
  if (hasAccess && anyOf && anyOf.length > 0) {
    hasAccess = hasAnyPermission(anyOf);
  }

  // All of permissions check
  if (hasAccess && allOf && allOf.length > 0) {
    hasAccess = hasAllPermissions(allOf);
  }

  // Render based on access
  if (!hasAccess) {
    if (hide) return null;
    if (fallback) return <>{fallback}</>;
    return null;
  }

  return <>{children}</>;
}

// =====================================
// RequireOrgAdmin - مختصر لطلب صلاحية مسؤول منظمة
// =====================================

export function RequireOrgAdmin({
  children,
  fallback,
  hide = true,
}: {
  children: ReactNode;
  fallback?: ReactNode;
  hide?: boolean;
}) {
  return (
    <ProtectedComponent
      requireOrgAdmin
      fallback={fallback}
      hide={hide}
    >
      {children}
    </ProtectedComponent>
  );
}

// =====================================
// RequireSuperAdmin - مختصر لطلب صلاحية Super Admin
// =====================================

export function RequireSuperAdmin({
  children,
  fallback,
  hide = true,
}: {
  children: ReactNode;
  fallback?: ReactNode;
  hide?: boolean;
}) {
  return (
    <ProtectedComponent
      requireSuperAdmin
      fallback={fallback}
      hide={hide}
    >
      {children}
    </ProtectedComponent>
  );
}

// =====================================
// PermissionGate - بوابة صلاحيات مع رسالة
// =====================================

export function PermissionGate({
  children,
  module,
  action,
  message,
}: {
  children: ReactNode;
  module: string;
  action: string;
  message?: string;
}) {
  return (
    <ProtectedComponent
      module={module}
      action={action}
      fallback={
        <div className="flex items-center gap-2 p-4 rounded-lg bg-slate-900/50 border border-slate-800 text-slate-400">
          <Lock className="h-4 w-4" />
          <span>{message || 'ليس لديك صلاحية الوصول لهذا القسم'}</span>
        </div>
      }
    >
      {children}
    </ProtectedComponent>
  );
}

// =====================================
// withPermission - HOC للحماية
// =====================================

export function withPermission<P extends object>(
  WrappedComponent: React.ComponentType<P>,
  options: {
    module?: string;
    action?: string;
    requireOrgAdmin?: boolean;
    requireSuperAdmin?: boolean;
  }
) {
  return function PermissionWrappedComponent(props: P) {
    return (
      <ProtectedComponent {...options} hide>
        <WrappedComponent {...props} />
      </ProtectedComponent>
    );
  };
}

export default ProtectedComponent;

