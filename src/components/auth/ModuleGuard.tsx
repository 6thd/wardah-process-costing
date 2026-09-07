// src/components/auth/ModuleGuard.tsx
// بسم الله الرحمن الرحيم
// مكون لحماية الموديولات بناءً على الصلاحيات

import { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { usePermissions } from '@/hooks/usePermissions';
import { getModuleConfig } from '@/config/module-permissions';
import { resolveRoutePermission, satisfiesRouteRequirement } from '@/config/route-permissions';
import { Loader2, Lock, ShieldAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useTranslation } from 'react-i18next';
import {
  PermissionRevalidationBoundary,
  usePermissionRecoveryBlock,
} from './PermissionRevalidationBoundary';

interface ModuleGuardProps {
  readonly children: ReactNode;
  readonly moduleCode?: string;
  readonly action?: string;
  readonly requireOrgAdmin?: boolean;
  readonly requireSuperAdmin?: boolean;
  readonly redirectTo?: string;
  readonly showAccessDenied?: boolean;
}

function AccessDeniedPage() {
  const { t } = useTranslation()
  return (
    <div className="min-h-[60vh] flex items-center justify-center">
      <div className="text-center space-y-6 p-8 max-w-md">
        <div className="mx-auto w-20 h-20 rounded-full bg-destructive/10 flex items-center justify-center">
          <ShieldAlert className="w-10 h-10 text-destructive" />
        </div>
        <div className="space-y-2">
          <h1 className="text-2xl font-bold text-foreground">{t('auth.accessDenied')}</h1>
          <p className="text-muted-foreground">{t('auth.accessDeniedDescription')}</p>
        </div>
        <div className="flex flex-col sm:flex-row gap-3 justify-center">
          <Button variant="outline" onClick={() => globalThis.history.back()}>
            <Lock className="w-4 h-4 mr-2" />
            {t('auth.goBack')}
          </Button>
          <Button onClick={() => { globalThis.location.href = '/dashboard'; }}>
            {t('auth.goToDashboard')}
          </Button>
        </div>
      </div>
    </div>
  );
}

function LoadingState() {
  const { t } = useTranslation();
  return (
    <div className="min-h-[60vh] flex items-center justify-center">
      <div className="text-center space-y-4">
        <Loader2 className="h-10 w-10 animate-spin text-primary mx-auto" />
        <p className="text-muted-foreground">{t('auth.checkingPermissions')}</p>
      </div>
    </div>
  );
}

export function ModuleGuard({
  children,
  moduleCode,
  action,
  requireOrgAdmin = false,
  requireSuperAdmin = false,
  redirectTo,
  showAccessDenied = true,
}: ModuleGuardProps) {
  const location = useLocation();
  const {
    hasPermission,
    hasPermissionKey,
    isOrgAdmin,
    isSuperAdmin,
    loading,
    error,
    permissionIdentityKey,
  } = usePermissions();

  let hasAccess = true;

  if (requireSuperAdmin && !isSuperAdmin) {
    hasAccess = false;
  }

  if (hasAccess && requireOrgAdmin && !isOrgAdmin && !isSuperAdmin) {
    hasAccess = false;
  }

  if (hasAccess && moduleCode) {
    if (action) {
      hasAccess = hasPermission(moduleCode, action);
    } else {
      const basePath = getModuleConfig(moduleCode)?.path ?? `/${moduleCode}`;
      const subPath =
        location.pathname === basePath
          ? '/'
          : location.pathname.startsWith(`${basePath}/`)
            ? location.pathname.slice(basePath.length)
            : location.pathname;
      const requirement = resolveRoutePermission(moduleCode, subPath);
      hasAccess = requirement != null && satisfiesRouteRequirement(requirement, hasPermissionKey);
    }
  }

  const recoveryBlocked = usePermissionRecoveryBlock({
    hasAccess,
    loading,
    error,
    identityKey: permissionIdentityKey,
  });

  if (loading && !recoveryBlocked) {
    return <LoadingState />;
  }

  if (!hasAccess && !recoveryBlocked) {
    if (redirectTo) {
      return <Navigate to={redirectTo} state={{ from: location }} replace />;
    }
    if (showAccessDenied) {
      return <AccessDeniedPage />;
    }
    return <Navigate to="/dashboard" state={{ from: location }} replace />;
  }

  return (
    <PermissionRevalidationBoundary blocked={recoveryBlocked}>
      {children}
    </PermissionRevalidationBoundary>
  );
}

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
