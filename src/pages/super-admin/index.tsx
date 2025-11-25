// src/pages/super-admin/index.tsx
// بسم الله الرحمن الرحيم
// Super Admin Dashboard

import { useEffect, useState } from 'react';
import { Routes, Route, Navigate, useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { checkIsSuperAdmin } from '@/services/super-admin-service';
import { Loader2, Shield, ShieldX } from 'lucide-react';
import { SuperAdminDashboard } from './dashboard';
import { OrganizationsPage } from './organizations';
import { OrganizationForm } from './organization-form';

// =====================================
// Super Admin Guard
// =====================================

function SuperAdminGuard({ children }: { children: React.ReactNode }) {
  const { user, loading: authLoading } = useAuth();
  const [isSuperAdmin, setIsSuperAdmin] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    const checkAccess = async () => {
      if (authLoading) return;
      
      if (!user) {
        navigate('/login');
        return;
      }

      const isAdmin = await checkIsSuperAdmin();
      setIsSuperAdmin(isAdmin);
      setLoading(false);

      if (!isAdmin) {
        // Not a super admin - redirect to dashboard
        setTimeout(() => {
          navigate('/dashboard');
        }, 3000);
      }
    };

    checkAccess();
  }, [user, authLoading, navigate]);

  if (authLoading || loading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-background">
        <div className="text-center space-y-4">
          <Shield className="h-16 w-16 text-primary mx-auto animate-pulse" />
          <Loader2 className="h-8 w-8 animate-spin text-primary mx-auto" />
          <p className="text-lg font-medium">جارٍ التحقق من الصلاحيات...</p>
        </div>
      </div>
    );
  }

  if (!isSuperAdmin) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-background">
        <div className="text-center space-y-4 p-8">
          <ShieldX className="h-20 w-20 text-destructive mx-auto" />
          <h1 className="text-2xl font-bold text-destructive">غير مصرح</h1>
          <p className="text-muted-foreground">
            ليس لديك صلاحية الوصول لهذه الصفحة
          </p>
          <p className="text-sm text-muted-foreground">
            سيتم توجيهك للصفحة الرئيسية...
          </p>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}

// =====================================
// Super Admin Module
// =====================================

export function SuperAdminModule() {
  return (
    <SuperAdminGuard>
      <Routes>
        <Route index element={<SuperAdminDashboard />} />
        <Route path="dashboard" element={<SuperAdminDashboard />} />
        <Route path="organizations" element={<OrganizationsPage />} />
        <Route path="organizations/new" element={<OrganizationForm />} />
        <Route path="organizations/:id" element={<OrganizationForm />} />
        <Route path="*" element={<Navigate to="/super-admin/dashboard" replace />} />
      </Routes>
    </SuperAdminGuard>
  );
}

export default SuperAdminModule;

