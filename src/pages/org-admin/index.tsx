// src/pages/org-admin/index.tsx
// بسم الله الرحمن الرحيم
// Org Admin Guard & Router

import { useEffect, useState } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { checkIsOrgAdmin } from '@/services/org-admin-service';
import { Loader2 } from 'lucide-react';

export default function OrgAdminLayout() {
  const { user, loading: authLoading, currentOrgId } = useAuth();
  const isAuthenticated = !!user;
  const [isOrgAdmin, setIsOrgAdmin] = useState<boolean | null>(null);
  const [checking, setChecking] = useState(true);
  const location = useLocation();

  useEffect(() => {
    async function checkAccess() {
      console.log('🔍 Checking org admin access...', { currentOrgId, isAuthenticated });
      
      if (!currentOrgId) {
        console.log('⚠️ No currentOrgId, allowing access temporarily');
        // السماح مؤقتاً إذا لم يتم تحميل org_id بعد
        setIsOrgAdmin(true);
        setChecking(false);
        return;
      }

      try {
        const result = await checkIsOrgAdmin(currentOrgId);
        console.log('✅ Org admin check result:', result);
        setIsOrgAdmin(result);
      } catch (error) {
        console.error('❌ Error checking org admin access:', error);
        // السماح بالوصول في حالة الخطأ مؤقتاً
        setIsOrgAdmin(true);
      } finally {
        setChecking(false);
      }
    }

    if (isAuthenticated && !authLoading) {
      checkAccess();
    } else if (!authLoading && !isAuthenticated) {
      setChecking(false);
    }
  }, [isAuthenticated, authLoading, currentOrgId]);

  if (authLoading || checking) {
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

  if (!isOrgAdmin) {
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

