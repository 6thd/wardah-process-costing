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
  readonly children: ReactNode;
  /** المديول المطلوب */
  readonly module?: string;
  /** الإجراء المطلوب */
  readonly action?: string;
  /** قائمة صلاحيات (أي واحدة منها تكفي) */
  readonly anyOf?: ReadonlyArray<{ readonly module: string; readonly action: string }>;
  /** قائمة صلاحيات (يجب توفر جميعها) */
  readonly allOf?: ReadonlyArray<{ readonly module: string; readonly action: string }>;
  /** يتطلب أن يكون مسؤول منظمة */
  readonly requireOrgAdmin?: boolean;
  /** يتطلب أن يكون Super Admin */
  readonly requireSuperAdmin?: boolean;
  /** ما يظهر أثناء التحميل */
  readonly loadingComponent?: ReactNode;
  /** ما يظهر عند عدم وجود صلاحية */
  readonly fallback?: ReactNode;
  /** إخفاء المكون بدلاً من عرض fallback */
  readonly hide?: boolean;
}

// =====================================
// ProtectedComponent
// =====================================

// NOSONAR - Cognitive complexity is acceptable due to permission logic separation
// Helper function to check admin permissions
function checkAdminPermissions(
  requireSuperAdmin: boolean,
  requireOrgAdmin: boolean,
  isSuperAdmin: boolean,
  isOrgAdmin: boolean
): boolean {
  if (requireSuperAdmin && !isSuperAdmin) {
    return false;
  }
  if (requireOrgAdmin && !isOrgAdmin && !isSuperAdmin) {
    return false;
  }
  return true;
}

// Helper function to check module permissions
function checkModulePermissions(
  module: string | undefined,
  action: string | undefined,
  anyOf: ReadonlyArray<{ readonly module: string; readonly action: string }> | undefined,
  allOf: ReadonlyArray<{ readonly module: string; readonly action: string }> | undefined,
  hasPermission: (module: string, action: string) => boolean,
  hasAnyPermission: (permissions: Array<{ module: string; action: string }>) => boolean,
  hasAllPermissions: (permissions: Array<{ module: string; action: string }>) => boolean
): boolean {
  if (module && action && !hasPermission(module, action)) {
    return false;
  }
  if (anyOf && anyOf.length > 0 && !hasAnyPermission(anyOf as Array<{ module: string; action: string }>)) {
    return false;
  }
  if (allOf && allOf.length > 0 && !hasAllPermissions(allOf as Array<{ module: string; action: string }>)) {
    return false;
  }
  return true;
}

// NOSONAR - Props are effectively read-only in React functional components
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

  // Helper function to get fallback content
  const getFallbackContent = (): ReactNode | null => {
    if (hide) {
      return null;
    }
    return fallback ? <>{fallback}</> : null;
  };

  // Check admin permissions
  const hasAdminAccess = checkAdminPermissions(requireSuperAdmin, requireOrgAdmin, isSuperAdmin, isOrgAdmin);
  if (!hasAdminAccess) {
    return getFallbackContent();
  }

  // Check module permissions
  const hasModuleAccess = checkModulePermissions(
    module,
    action,
    anyOf,
    allOf,
    hasPermission,
    hasAnyPermission,
    hasAllPermissions
  );

  if (!hasModuleAccess) {
    return getFallbackContent();
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
  readonly children: ReactNode;
  readonly fallback?: ReactNode;
  readonly hide?: boolean;
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
  readonly children: ReactNode;
  readonly fallback?: ReactNode;
  readonly hide?: boolean;
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
  readonly children: ReactNode;
  readonly module: string;
  readonly action: string;
  readonly message?: string;
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

