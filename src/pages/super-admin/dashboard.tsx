// src/pages/super-admin/dashboard.tsx
// بسم الله الرحمن الرحيم
// Super Admin Dashboard

import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { 
  Building2, 
  Users, 
  Plus, 
  TrendingUp, 
  Clock,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  ArrowRight,
  Shield,
  BarChart3,
  Settings
} from 'lucide-react';
import { getDashboardStats, DashboardStats } from '@/services/super-admin-service';
import { Skeleton } from '@/components/ui/skeleton';

// =====================================
// Stats Card Component
// =====================================

interface StatsCardProps {
  title: string;
  value: number | string;
  icon: React.ReactNode;
  description?: string;
  trend?: 'up' | 'down' | 'neutral';
  color?: 'default' | 'success' | 'warning' | 'danger';
}

function StatsCard({ title, value, icon, description, color = 'default' }: StatsCardProps) {
  const colorClasses = {
    default: 'bg-primary/10 text-primary',
    success: 'bg-green-100 text-green-600 dark:bg-green-900/20 dark:text-green-400',
    warning: 'bg-yellow-100 text-yellow-600 dark:bg-yellow-900/20 dark:text-yellow-400',
    danger: 'bg-red-100 text-red-600 dark:bg-red-900/20 dark:text-red-400',
  };

  return (
    <Card className="hover:shadow-lg transition-shadow">
      <CardContent className="p-6">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-muted-foreground mb-1">{title}</p>
            <p className="text-3xl font-bold">{value}</p>
            {description && (
              <p className="text-xs text-muted-foreground mt-1">{description}</p>
            )}
          </div>
          <div className={`p-3 rounded-full ${colorClasses[color]}`}>
            {icon}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// =====================================
// Plan Badge Component
// =====================================

function PlanBadge({ plan }: { plan: string }) {
  const variants: Record<string, { class: string; label: string }> = {
    trial: { class: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300', label: 'تجريبي' },
    basic: { class: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400', label: 'أساسي' },
    pro: { class: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400', label: 'احترافي' },
    enterprise: { class: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400', label: 'مؤسسي' },
  };

  const variant = variants[plan] || variants.trial;

  return (
    <span className={`px-2 py-1 rounded-full text-xs font-medium ${variant.class}`}>
      {variant.label}
    </span>
  );
}

// =====================================
// Main Dashboard
// =====================================

export function SuperAdminDashboard() {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadStats = async () => {
      const data = await getDashboardStats();
      setStats(data);
      setLoading(false);
    };

    loadStats();
  }, []);

  if (loading) {
    return (
      <div className="p-6 space-y-6">
        <div className="flex items-center justify-between">
          <Skeleton className="h-10 w-64" />
          <Skeleton className="h-10 w-40" />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          {[1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-32 w-full" />
          ))}
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Skeleton className="h-80 w-full" />
          <Skeleton className="h-80 w-full" />
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <div className="flex items-center gap-3 mb-2">
            <Shield className="h-8 w-8 text-primary" />
            <h1 className="text-3xl font-bold">لوحة تحكم Super Admin</h1>
          </div>
          <p className="text-muted-foreground">
            إدارة جميع المنظمات والمستخدمين في النظام
          </p>
        </div>
        <Link to="/super-admin/organizations/new">
          <Button size="lg" className="gap-2">
            <Plus className="h-5 w-5" />
            إنشاء منظمة جديدة
          </Button>
        </Link>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <StatsCard
          title="إجمالي المنظمات"
          value={stats?.totalOrganizations || 0}
          icon={<Building2 className="h-6 w-6" />}
          color="default"
        />
        <StatsCard
          title="المنظمات النشطة"
          value={stats?.activeOrganizations || 0}
          icon={<CheckCircle2 className="h-6 w-6" />}
          color="success"
        />
        <StatsCard
          title="إجمالي المستخدمين"
          value={stats?.totalUsers || 0}
          icon={<Users className="h-6 w-6" />}
          color="default"
        />
        <StatsCard
          title="تنتهي قريباً"
          value={stats?.expiringSoon.length || 0}
          icon={<AlertTriangle className="h-6 w-6" />}
          color={stats?.expiringSoon.length ? 'warning' : 'success'}
          description="خلال 30 يوم"
        />
      </div>

      {/* Plans Distribution */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card className="bg-gray-50 dark:bg-gray-900/50">
          <CardContent className="p-4 text-center">
            <p className="text-2xl font-bold">{stats?.trialOrgs || 0}</p>
            <p className="text-sm text-muted-foreground">تجريبي</p>
          </CardContent>
        </Card>
        <Card className="bg-blue-50 dark:bg-blue-900/20">
          <CardContent className="p-4 text-center">
            <p className="text-2xl font-bold text-blue-600">{stats?.basicOrgs || 0}</p>
            <p className="text-sm text-blue-600/70">أساسي</p>
          </CardContent>
        </Card>
        <Card className="bg-purple-50 dark:bg-purple-900/20">
          <CardContent className="p-4 text-center">
            <p className="text-2xl font-bold text-purple-600">{stats?.proOrgs || 0}</p>
            <p className="text-sm text-purple-600/70">احترافي</p>
          </CardContent>
        </Card>
        <Card className="bg-amber-50 dark:bg-amber-900/20">
          <CardContent className="p-4 text-center">
            <p className="text-2xl font-bold text-amber-600">{stats?.enterpriseOrgs || 0}</p>
            <p className="text-sm text-amber-600/70">مؤسسي</p>
          </CardContent>
        </Card>
      </div>

      {/* Recent Organizations & Expiring Soon */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Recent Organizations */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Clock className="h-5 w-5" />
                آخر المنظمات المضافة
              </CardTitle>
              <CardDescription>أحدث 5 منظمات تم إنشاؤها</CardDescription>
            </div>
            <Link to="/super-admin/organizations">
              <Button variant="ghost" size="sm" className="gap-1">
                عرض الكل
                <ArrowRight className="h-4 w-4" />
              </Button>
            </Link>
          </CardHeader>
          <CardContent>
            {stats?.recentOrganizations.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <Building2 className="h-12 w-12 mx-auto mb-4 opacity-50" />
                <p>لا توجد منظمات بعد</p>
              </div>
            ) : (
              <div className="space-y-4">
                {stats?.recentOrganizations.map((org) => (
                  <div
                    key={org.id}
                    className="flex items-center justify-between p-3 bg-muted/50 rounded-lg hover:bg-muted transition-colors"
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
                        <Building2 className="h-5 w-5 text-primary" />
                      </div>
                      <div>
                        <p className="font-medium">{org.name_ar || org.name}</p>
                        <p className="text-xs text-muted-foreground">{org.code}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <PlanBadge plan={org.plan_type} />
                      {org.is_active ? (
                        <CheckCircle2 className="h-4 w-4 text-green-500" />
                      ) : (
                        <XCircle className="h-4 w-4 text-red-500" />
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Expiring Soon */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-warning" />
              اشتراكات تنتهي قريباً
            </CardTitle>
            <CardDescription>المنظمات التي ستنتهي اشتراكاتها خلال 30 يوم</CardDescription>
          </CardHeader>
          <CardContent>
            {stats?.expiringSoon.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <CheckCircle2 className="h-12 w-12 mx-auto mb-4 text-green-500 opacity-50" />
                <p>لا توجد اشتراكات تنتهي قريباً</p>
              </div>
            ) : (
              <div className="space-y-4">
                {stats?.expiringSoon.map((org) => {
                  const endDate = new Date(org.subscription_end!);
                  const daysLeft = Math.ceil(
                    (endDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24)
                  );

                  return (
                    <div
                      key={org.id}
                      className="flex items-center justify-between p-3 bg-yellow-50 dark:bg-yellow-900/20 rounded-lg"
                    >
                      <div>
                        <p className="font-medium">{org.name_ar || org.name}</p>
                        <p className="text-xs text-muted-foreground">
                          ينتهي: {endDate.toLocaleDateString('ar-SA')}
                        </p>
                      </div>
                      <Badge variant={daysLeft <= 7 ? 'destructive' : 'secondary'}>
                        {daysLeft} يوم
                      </Badge>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Quick Actions */}
      <Card>
        <CardHeader>
          <CardTitle>إجراءات سريعة</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Link to="/super-admin/organizations/new">
              <Button variant="outline" className="w-full h-24 flex-col gap-2">
                <Plus className="h-6 w-6" />
                <span>إنشاء منظمة</span>
              </Button>
            </Link>
            <Link to="/super-admin/organizations">
              <Button variant="outline" className="w-full h-24 flex-col gap-2">
                <Building2 className="h-6 w-6" />
                <span>إدارة المنظمات</span>
              </Button>
            </Link>
            <Button variant="outline" className="w-full h-24 flex-col gap-2" disabled>
              <BarChart3 className="h-6 w-6" />
              <span>التقارير</span>
            </Button>
            <Button variant="outline" className="w-full h-24 flex-col gap-2" disabled>
              <Settings className="h-6 w-6" />
              <span>الإعدادات</span>
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export default SuperAdminDashboard;

