// src/pages/org-admin/index.tsx
// بسم الله الرحمن الرحيم
// Org Admin Guard & Router

import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { usePermissions } from '@/hooks/usePermissions';
import { Loader2 } from 'lucide-react';

export default function OrgAdminLayout() {
  const { user, loading: authLoading } = useAuth();
  const isAuthenticated = !!user;
  const {
    isOrgAdmin,
    isSuperAdmin,
    loading: permissionsLoading,
  } = usePermissions();
  const location = useLocation();

  if (authLoading || (isAuthenticated && permissionsLoading)) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-900 to-slate-800">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="h-12 w-12 animate-spin text-teal-500" />
          <p className="text-slate-400 animate-pulse">جاري التحقق من الصلاحيات...</p>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  if (!isOrgAdmin && !isSuperAdmin) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-900 to-slate-800">
        <div className="bg-slate-800/50 border border-rose-500/30 rounded-2xl p-8 text-center max-w-md">
          <div className="w-20 h-20 mx-auto mb-6 rounded-full bg-rose-500/20 flex items-center justify-center">
            <span className="text-4xl">🚫</span>
          </div>
          <h2 className="text-2xl font-bold text-white mb-3">غير مصرح بالوصول</h2>
          <p className="text-slate-400 mb-6">
            عذراً، أنت بحاجة لصلاحيات مسؤول المنظمة للوصول لهذه الصفحة
          </p>
          <a
            href="/"
            className="inline-block px-6 py-3 bg-gradient-to-r from-teal-600 to-cyan-600 text-white rounded-xl hover:from-teal-500 hover:to-cyan-500 transition-all"
          >
            العودة للرئيسية
          </a>
        </div>
      </div>
    );
  }

  return <Outlet />;
}
