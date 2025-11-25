// src/pages/org-admin/audit-log.tsx
// بسم الله الرحمن الرحيم
// صفحة سجل التدقيق

import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/contexts/AuthContext';
import { getSupabase } from '@/lib/supabase';
import { 
  FileText, 
  Search, 
  Filter, 
  Download, 
  RefreshCw,
  User,
  Settings,
  Shield,
  Package,
  DollarSign,
  Factory,
  Clock,
  ChevronLeft,
  ChevronRight,
  Calendar,
  AlertCircle
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

// =====================================
// Types
// =====================================

interface AuditLogEntry {
  id: string;
  user_id: string;
  user_email?: string;
  action: string;
  entity_type: string;
  entity_id: string;
  old_data: any;
  new_data: any;
  ip_address?: string;
  user_agent?: string;
  created_at: string;
  org_id: string;
}

// =====================================
// Helper Functions
// =====================================

const getActionColor = (action: string) => {
  switch (action.toLowerCase()) {
    case 'create':
    case 'insert':
      return 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30';
    case 'update':
    case 'edit':
      return 'bg-amber-500/20 text-amber-400 border-amber-500/30';
    case 'delete':
    case 'remove':
      return 'bg-rose-500/20 text-rose-400 border-rose-500/30';
    case 'login':
    case 'logout':
      return 'bg-blue-500/20 text-blue-400 border-blue-500/30';
    default:
      return 'bg-slate-500/20 text-slate-400 border-slate-500/30';
  }
};

const getEntityIcon = (entityType: string) => {
  switch (entityType.toLowerCase()) {
    case 'user':
    case 'users':
      return User;
    case 'settings':
    case 'config':
      return Settings;
    case 'role':
    case 'roles':
    case 'permission':
      return Shield;
    case 'inventory':
    case 'item':
      return Package;
    case 'sales':
    case 'invoice':
      return DollarSign;
    case 'manufacturing':
    case 'production':
      return Factory;
    default:
      return FileText;
  }
};

const formatDate = (dateString: string, isRTL: boolean) => {
  const date = new Date(dateString);
  return date.toLocaleString(isRTL ? 'ar-SA' : 'en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
};

const getActionLabel = (action: string, isRTL: boolean) => {
  const labels: Record<string, { ar: string; en: string }> = {
    create: { ar: 'إنشاء', en: 'Create' },
    insert: { ar: 'إضافة', en: 'Insert' },
    update: { ar: 'تحديث', en: 'Update' },
    edit: { ar: 'تعديل', en: 'Edit' },
    delete: { ar: 'حذف', en: 'Delete' },
    remove: { ar: 'إزالة', en: 'Remove' },
    login: { ar: 'تسجيل دخول', en: 'Login' },
    logout: { ar: 'تسجيل خروج', en: 'Logout' },
    approve: { ar: 'اعتماد', en: 'Approve' },
    reject: { ar: 'رفض', en: 'Reject' },
  };
  const label = labels[action.toLowerCase()];
  return label ? (isRTL ? label.ar : label.en) : action;
};

// =====================================
// Audit Log Page Component
// =====================================

export default function OrgAdminAuditLog() {
  const { t, i18n } = useTranslation();
  const { currentOrgId } = useAuth();
  const isRTL = i18n.language === 'ar';

  const [logs, setLogs] = useState<AuditLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  // Filters
  const [searchQuery, setSearchQuery] = useState('');
  const [actionFilter, setActionFilter] = useState<string>('all');
  const [entityFilter, setEntityFilter] = useState<string>('all');
  const [dateFilter, setDateFilter] = useState<string>('7'); // Last 7 days
  
  // Pagination
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const pageSize = 20;

  // =====================================
  // Load Audit Logs
  // =====================================

  const loadAuditLogs = async () => {
    if (!currentOrgId) return;

    setLoading(true);
    setError(null);

    try {
      const supabase = getSupabase();
      
      // Calculate date range
      const endDate = new Date();
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - parseInt(dateFilter));

      let query = supabase
        .from('audit_logs')
        .select('*', { count: 'exact' })
        .eq('org_id', currentOrgId)
        .gte('created_at', startDate.toISOString())
        .lte('created_at', endDate.toISOString())
        .order('created_at', { ascending: false });

      // Apply filters
      if (actionFilter !== 'all') {
        query = query.ilike('action', `%${actionFilter}%`);
      }
      if (entityFilter !== 'all') {
        query = query.ilike('entity_type', `%${entityFilter}%`);
      }
      if (searchQuery) {
        query = query.or(`entity_id.ilike.%${searchQuery}%,action.ilike.%${searchQuery}%`);
      }

      // Pagination
      const from = (page - 1) * pageSize;
      const to = from + pageSize - 1;
      query = query.range(from, to);

      const { data, error: queryError, count } = await query;

      if (queryError) throw queryError;

      setLogs(data || []);
      setTotalPages(Math.ceil((count || 0) / pageSize));
    } catch (err: any) {
      console.error('Error loading audit logs:', err);
      setError(err.message || 'فشل تحميل سجل التدقيق');
      // Set empty logs on error
      setLogs([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadAuditLogs();
  }, [currentOrgId, page, actionFilter, entityFilter, dateFilter]);

  // =====================================
  // Export Logs
  // =====================================

  const exportLogs = () => {
    const csvContent = [
      ['ID', 'Action', 'Entity Type', 'Entity ID', 'Date', 'User ID'].join(','),
      ...logs.map(log => [
        log.id,
        log.action,
        log.entity_type,
        log.entity_id,
        log.created_at,
        log.user_id
      ].join(','))
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `audit_log_${new Date().toISOString().split('T')[0]}.csv`;
    link.click();
  };

  // =====================================
  // Render
  // =====================================

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="p-3 rounded-xl bg-gradient-to-br from-violet-500/20 to-purple-500/20 border border-violet-500/30">
            <FileText className="h-6 w-6 text-violet-400" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-white">
              {isRTL ? 'سجل التدقيق' : 'Audit Log'}
            </h1>
            <p className="text-slate-400 text-sm">
              {isRTL ? 'تتبع جميع الأنشطة والتغييرات في النظام' : 'Track all activities and changes in the system'}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={loadAuditLogs}
            disabled={loading}
            className="border-slate-700"
          >
            <RefreshCw className={`h-4 w-4 ${isRTL ? 'ml-2' : 'mr-2'} ${loading ? 'animate-spin' : ''}`} />
            {isRTL ? 'تحديث' : 'Refresh'}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={exportLogs}
            disabled={logs.length === 0}
            className="border-slate-700"
          >
            <Download className={`h-4 w-4 ${isRTL ? 'ml-2' : 'mr-2'}`} />
            {isRTL ? 'تصدير' : 'Export'}
          </Button>
        </div>
      </div>

      {/* Filters */}
      <Card className="bg-slate-900/50 border-slate-800">
        <CardContent className="p-4">
          <div className="flex flex-col md:flex-row gap-4">
            {/* Search */}
            <div className="relative flex-1">
              <Search className={`absolute top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400 ${isRTL ? 'right-3' : 'left-3'}`} />
              <Input
                placeholder={isRTL ? 'بحث...' : 'Search...'}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className={`bg-slate-800 border-slate-700 ${isRTL ? 'pr-10' : 'pl-10'}`}
                onKeyDown={(e) => e.key === 'Enter' && loadAuditLogs()}
              />
            </div>

            {/* Action Filter */}
            <Select value={actionFilter} onValueChange={setActionFilter}>
              <SelectTrigger className="w-[150px] bg-slate-800 border-slate-700">
                <SelectValue placeholder={isRTL ? 'الإجراء' : 'Action'} />
              </SelectTrigger>
              <SelectContent className="bg-slate-800 border-slate-700">
                <SelectItem value="all">{isRTL ? 'الكل' : 'All'}</SelectItem>
                <SelectItem value="create">{isRTL ? 'إنشاء' : 'Create'}</SelectItem>
                <SelectItem value="update">{isRTL ? 'تحديث' : 'Update'}</SelectItem>
                <SelectItem value="delete">{isRTL ? 'حذف' : 'Delete'}</SelectItem>
                <SelectItem value="login">{isRTL ? 'تسجيل دخول' : 'Login'}</SelectItem>
              </SelectContent>
            </Select>

            {/* Entity Filter */}
            <Select value={entityFilter} onValueChange={setEntityFilter}>
              <SelectTrigger className="w-[150px] bg-slate-800 border-slate-700">
                <SelectValue placeholder={isRTL ? 'النوع' : 'Entity'} />
              </SelectTrigger>
              <SelectContent className="bg-slate-800 border-slate-700">
                <SelectItem value="all">{isRTL ? 'الكل' : 'All'}</SelectItem>
                <SelectItem value="user">{isRTL ? 'المستخدمين' : 'Users'}</SelectItem>
                <SelectItem value="role">{isRTL ? 'الأدوار' : 'Roles'}</SelectItem>
                <SelectItem value="inventory">{isRTL ? 'المخزون' : 'Inventory'}</SelectItem>
                <SelectItem value="sales">{isRTL ? 'المبيعات' : 'Sales'}</SelectItem>
                <SelectItem value="settings">{isRTL ? 'الإعدادات' : 'Settings'}</SelectItem>
              </SelectContent>
            </Select>

            {/* Date Filter */}
            <Select value={dateFilter} onValueChange={setDateFilter}>
              <SelectTrigger className="w-[150px] bg-slate-800 border-slate-700">
                <Calendar className={`h-4 w-4 ${isRTL ? 'ml-2' : 'mr-2'} text-slate-400`} />
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-slate-800 border-slate-700">
                <SelectItem value="1">{isRTL ? 'اليوم' : 'Today'}</SelectItem>
                <SelectItem value="7">{isRTL ? 'آخر 7 أيام' : 'Last 7 days'}</SelectItem>
                <SelectItem value="30">{isRTL ? 'آخر 30 يوم' : 'Last 30 days'}</SelectItem>
                <SelectItem value="90">{isRTL ? 'آخر 3 أشهر' : 'Last 3 months'}</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* Logs List */}
      <Card className="bg-slate-900/50 border-slate-800">
        <CardContent className="p-0">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <RefreshCw className="h-8 w-8 animate-spin text-violet-500" />
            </div>
          ) : error ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <AlertCircle className="h-12 w-12 text-amber-500 mb-4" />
              <p className="text-slate-400">{error}</p>
              <Button
                variant="outline"
                size="sm"
                onClick={loadAuditLogs}
                className="mt-4 border-slate-700"
              >
                {isRTL ? 'إعادة المحاولة' : 'Retry'}
              </Button>
            </div>
          ) : logs.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <FileText className="h-12 w-12 text-slate-600 mb-4" />
              <p className="text-slate-400">
                {isRTL ? 'لا توجد سجلات' : 'No logs found'}
              </p>
              <p className="text-slate-500 text-sm mt-1">
                {isRTL ? 'سيتم عرض الأنشطة هنا عند حدوثها' : 'Activities will appear here when they occur'}
              </p>
            </div>
          ) : (
            <div className="divide-y divide-slate-800">
              {logs.map((log) => {
                const EntityIcon = getEntityIcon(log.entity_type);
                return (
                  <div
                    key={log.id}
                    className="p-4 hover:bg-slate-800/50 transition-colors"
                  >
                    <div className="flex items-start gap-4">
                      {/* Icon */}
                      <div className="p-2 rounded-lg bg-slate-800">
                        <EntityIcon className="h-5 w-5 text-slate-400" />
                      </div>

                      {/* Content */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <Badge className={`${getActionColor(log.action)} border`}>
                            {getActionLabel(log.action, isRTL)}
                          </Badge>
                          <span className="text-white font-medium">
                            {log.entity_type}
                          </span>
                          {log.entity_id && (
                            <code className="text-xs bg-slate-800 px-2 py-0.5 rounded text-slate-400">
                              {log.entity_id.substring(0, 8)}...
                            </code>
                          )}
                        </div>
                        
                        <div className="flex items-center gap-4 mt-2 text-sm text-slate-500">
                          <span className="flex items-center gap-1">
                            <Clock className="h-3 w-3" />
                            {formatDate(log.created_at, isRTL)}
                          </span>
                          {log.user_email && (
                            <span className="flex items-center gap-1">
                              <User className="h-3 w-3" />
                              {log.user_email}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between p-4 border-t border-slate-800">
              <p className="text-sm text-slate-400">
                {isRTL ? `صفحة ${page} من ${totalPages}` : `Page ${page} of ${totalPages}`}
              </p>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage(p => Math.max(1, p - 1))}
                  disabled={page === 1}
                  className="border-slate-700"
                >
                  {isRTL ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                  disabled={page === totalPages}
                  className="border-slate-700"
                >
                  {isRTL ? <ChevronLeft className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

