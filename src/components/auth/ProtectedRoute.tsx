// src/components/auth/ProtectedRoute.tsx
// تم إنشاؤه: 28 أكتوبر 2025
// الهدف: حماية المسارات من الوصول غير المصرح

import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { Loader2 } from 'lucide-react';

export function ProtectedRoute() {
  const { user, loading } = useAuth();
  const location = useLocation();
  
  // عرض loader أثناء التحقق من الجلسة
  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-background">
        <div className="text-center space-y-4">
          <Loader2 className="h-12 w-12 animate-spin text-primary mx-auto" />
          <div className="space-y-2">
            <p className="text-lg font-semibold text-foreground">
              جارٍ التحميل...
            </p>
            <p className="text-sm text-muted-foreground">
              يرجى الانتظار قليلاً
            </p>
          </div>
        </div>
      </div>
    );
  }
  
  // إذا لم يكن المستخدم مسجل دخول، إعادة توجيه لصفحة تسجيل الدخول
  if (!user) {
    // حفظ المسار الحالي للعودة إليه بعد تسجيل الدخول
    return <Navigate to="/login" state={{ from: location }} replace />;
  }
  
  // إذا كان المستخدم مسجل دخول، عرض المحتوى المحمي
  return <Outlet />;
}

// Component بديل مع رسالة خطأ
export function ProtectedRouteWithMessage() {
  const { user, loading } = useAuth();
  const location = useLocation();
  
  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-background">
        <div className="text-center space-y-4 p-8">
          <div className="flex justify-center">
            <div className="animate-spin rounded-full h-16 w-16 border-b-4 border-primary"></div>
          </div>
          <div className="space-y-2">
            <h2 className="text-2xl font-bold text-foreground">
              جارٍ التحقق من الجلسة
            </h2>
            <p className="text-muted-foreground">
              يرجى الانتظار لحظة...
            </p>
          </div>
        </div>
      </div>
    );
  }
  
  if (!user) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-background">
        <div className="text-center space-y-6 p-8 max-w-md">
          <div className="space-y-2">
            <h2 className="text-3xl font-bold text-foreground">
              🔒 وصول محظور
            </h2>
            <p className="text-lg text-muted-foreground">
              يجب عليك تسجيل الدخول للوصول إلى هذه الصفحة
            </p>
          </div>
          <div className="pt-4">
            <Navigate to="/login" state={{ from: location }} replace />
          </div>
        </div>
      </div>
    );
  }
  
  return <Outlet />;
}
