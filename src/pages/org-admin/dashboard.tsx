// src/pages/org-admin/dashboard.tsx
// بسم الله الرحمن الرحيم
// Org Admin Dashboard

import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { getOrgStats, OrgStats } from '@/services/org-admin-service';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Users,
  UserPlus,
  Shield,
  Mail,
  Settings,
  ArrowLeft,
  Activity,
  Building2,
} from 'lucide-react';

export default function OrgAdminDashboard() {
  const { currentOrgId, organizations } = useAuth();
  const navigate = useNavigate();
  const [stats, setStats] = useState<OrgStats | null>(null);
  const [loading, setLoading] = useState(true);

  const currentOrg = organizations?.find(o => o.org_id === currentOrgId);

  useEffect(() => {
    async function loadStats() {
      if (!currentOrgId) return;
      
      setLoading(true);
      try {
        const data = await getOrgStats(currentOrgId);
        setStats(data);
      } catch (error) {
        console.error('Error loading stats:', error);
      } finally {
        setLoading(false);
      }
    }

    loadStats();
  }, [currentOrgId]);

  const statCards = [
    {
      title: 'إجمالي المستخدمين',
      value: stats?.totalUsers || 0,
      icon: Users,
      color: 'from-blue-600 to-indigo-600',
      link: '/org-admin/users',
    },
    {
      title: 'المستخدمين النشطين',
      value: stats?.activeUsers || 0,
      icon: Activity,
      color: 'from-emerald-600 to-teal-600',
      link: '/org-admin/users',
    },
    {
      title: 'الدعوات المعلقة',
      value: stats?.pendingInvitations || 0,
      icon: Mail,
      color: 'from-amber-500 to-orange-500',
      link: '/org-admin/invitations',
    },
    {
      title: 'الأدوار',
      value: stats?.totalRoles || 0,
      icon: Shield,
      color: 'from-purple-600 to-pink-600',
      link: '/org-admin/roles',
    },
  ];

  const quickActions = [
    {
      title: 'إدارة المستخدمين',
      description: 'عرض وإدارة مستخدمي المنظمة',
      icon: Users,
      link: '/org-admin/users',
      color: 'hover:border-blue-500/50',
    },
    {
      title: 'دعوة مستخدم جديد',
      description: 'إرسال دعوة للانضمام للمنظمة',
      icon: UserPlus,
      link: '/org-admin/invitations',
      color: 'hover:border-emerald-500/50',
    },
    {
      title: 'إدارة الأدوار',
      description: 'تخصيص الأدوار والصلاحيات',
      icon: Shield,
      link: '/org-admin/roles',
      color: 'hover:border-purple-500/50',
    },
    {
      title: 'إعدادات المنظمة',
      description: 'تعديل بيانات المنظمة',
      icon: Settings,
      link: '/org-admin/settings',
      color: 'hover:border-slate-500/50',
    },
  ];

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950">
      {/* Header */}
      <header className="bg-slate-900/80 backdrop-blur-xl border-b border-slate-800 sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <Button
                variant="ghost"
                size="icon"
                onClick={() => navigate('/')}
                className="text-slate-400 hover:text-white"
              >
                <ArrowLeft className="h-5 w-5" />
              </Button>
              <div>
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-teal-500 to-cyan-600 flex items-center justify-center">
                    <Building2 className="h-5 w-5 text-white" />
                  </div>
                  <div>
                    <h1 className="text-xl font-bold text-white">لوحة إدارة المنظمة</h1>
                    <p className="text-sm text-slate-400">
                      {currentOrg?.organization?.name_ar || currentOrg?.organization?.name || 'المنظمة الحالية'}
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-8">
        {/* Stats Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
          {statCards.map((stat) => (
            <Link key={stat.title} to={stat.link}>
              <Card className="bg-slate-900/50 border-slate-800 hover:border-slate-700 transition-all cursor-pointer group">
                <CardContent className="p-6">
                  <div className="flex items-center justify-between">
                    <div>
                      {loading ? (
                        <>
                          <Skeleton className="h-8 w-20 mb-2 bg-slate-800" />
                          <Skeleton className="h-4 w-32 bg-slate-800" />
                        </>
                      ) : (
                        <>
                          <p className="text-3xl font-bold text-white mb-1">{stat.value}</p>
                          <p className="text-sm text-slate-400">{stat.title}</p>
                        </>
                      )}
                    </div>
                    <div className={`p-3 rounded-xl bg-gradient-to-br ${stat.color} opacity-80 group-hover:opacity-100 transition-opacity`}>
                      <stat.icon className="h-6 w-6 text-white" />
                    </div>
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>

        {/* Quick Actions */}
        <Card className="bg-slate-900/50 border-slate-800">
          <CardHeader>
            <CardTitle className="text-white flex items-center gap-2">
              <Activity className="h-5 w-5 text-teal-400" />
              إجراءات سريعة
            </CardTitle>
            <CardDescription className="text-slate-400">
              الوصول السريع لأهم الوظائف الإدارية
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              {quickActions.map((action) => (
                <Link key={action.title} to={action.link}>
                  <div className={`p-6 rounded-xl border border-slate-800 ${action.color} transition-all bg-slate-950/50 hover:bg-slate-900/50 group`}>
                    <div className="flex items-center gap-4">
                      <div className="p-3 rounded-lg bg-slate-800 group-hover:bg-slate-700 transition-colors">
                        <action.icon className="h-5 w-5 text-slate-300" />
                      </div>
                      <div>
                        <h3 className="font-semibold text-white mb-1">{action.title}</h3>
                        <p className="text-xs text-slate-400">{action.description}</p>
                      </div>
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Info Section */}
        <div className="mt-8 p-6 rounded-2xl bg-gradient-to-r from-teal-950/50 to-cyan-950/50 border border-teal-800/30">
          <div className="flex items-start gap-4">
            <div className="p-3 rounded-lg bg-teal-900/50">
              <Shield className="h-6 w-6 text-teal-400" />
            </div>
            <div>
              <h3 className="text-lg font-semibold text-white mb-2">صلاحياتك كمسؤول منظمة</h3>
              <ul className="text-slate-300 text-sm space-y-1">
                <li>• إدارة المستخدمين وتفعيل/تعطيل حساباتهم</li>
                <li>• إنشاء وإرسال الدعوات للمستخدمين الجدد</li>
                <li>• تعيين الأدوار والصلاحيات للمستخدمين</li>
                <li>• إنشاء أدوار مخصصة بصلاحيات محددة</li>
                <li>• تعديل إعدادات المنظمة الأساسية</li>
              </ul>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}

