/**
 * withPermission HOC
 * 
 * Higher-Order Component to protect routes/components based on permissions
 */

import { ComponentType } from 'react';
import { usePermissions } from '@/hooks/usePermissions';
import { Lock } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

interface WithPermissionOptions {
  module: string;
  action: string;
  fallback?: ComponentType;
  showError?: boolean;
}

/**
 * HOC to protect components with permission checks
 */
export function withPermission<P extends object>(
  Component: ComponentType<P>,
  options: WithPermissionOptions
): ComponentType<P> {
  const { module, action, fallback: Fallback, showError = true } = options;

  return function ProtectedComponent(props: P) {
    const { hasPermission, loading } = usePermissions();

    // Show loading state
    if (loading) {
      return (
        <div className="flex items-center justify-center min-h-[400px]">
          <div className="text-center">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-4"></div>
            <p className="text-muted-foreground">جاري التحقق من الصلاحيات...</p>
          </div>
        </div>
      );
    }

    // Check permission
    if (!hasPermission(module, action)) {
      // Use custom fallback if provided
      if (Fallback) {
        return <Fallback {...props} />;
      }

      // Default error message
      if (showError) {
        return (
          <div className="flex items-center justify-center min-h-[400px] p-8">
            <Card className="max-w-md">
              <CardHeader>
                <div className="flex items-center gap-2">
                  <Lock className="h-6 w-6 text-destructive" />
                  <CardTitle>ليس لديك صلاحية</CardTitle>
                </div>
                <CardDescription>
                  ليس لديك صلاحية للوصول إلى هذه الصفحة
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-2 text-sm text-muted-foreground">
                  <p>
                    <strong>المطلوب:</strong> {module}.{action}
                  </p>
                  <p>
                    يرجى التواصل مع المسؤول للحصول على الصلاحية المطلوبة.
                  </p>
                </div>
              </CardContent>
            </Card>
          </div>
        );
      }

      // Return null if error should not be shown
      return null;
    }

    // User has permission, render component
    return <Component {...props} />;
  };
}

/**
 * Hook-based permission check (alternative to HOC)
 */
export function useRequirePermission(module: string, action: string): boolean {
  const { hasPermission, loading } = usePermissions();

  if (loading) {
    return false; // Wait for permissions to load
  }

  return hasPermission(module, action);
}

/**
 * Permission Guard component
 */
interface PermissionGuardProps {
  module: string;
  action: string;
  children: React.ReactNode;
  fallback?: React.ReactNode;
}

export function PermissionGuard({ module, action, children, fallback }: PermissionGuardProps) {
  const { hasPermission, loading } = usePermissions();

  if (loading) {
    return (
      <div className="flex items-center justify-center p-4">
        <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary"></div>
      </div>
    );
  }

  if (!hasPermission(module, action)) {
    return fallback || null;
  }

  return <>{children}</>;
}

export default withPermission;

