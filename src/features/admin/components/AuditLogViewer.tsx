/**
 * Audit Log Viewer Component
 * 
 * Displays audit logs with filtering and export capabilities
 */

import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuditLog } from '@/hooks/useAuditLog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { CalendarIcon, Download, Filter, Search } from 'lucide-react';
import { format } from 'date-fns';
import { ar } from 'date-fns/locale';
import type { AuditLogEntry, AuditAction, AuditEntityType } from '@/lib/audit/audit-types';

export function AuditLogViewer() {
  const { queryLogs } = useAuditLog();
  
  const [filters, setFilters] = useState({
    action: '' as AuditAction | '',
    entity_type: '' as AuditEntityType | '',
    user_id: '',
    entity_id: '',
    start_date: '',
    end_date: '',
    search: '',
  });
  
  const [page, setPage] = useState(0);
  const pageSize = 50;

  // Query audit logs
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['audit-logs', filters, page],
    queryFn: async () => {
      return await queryLogs({
        action: filters.action || undefined,
        entity_type: filters.entity_type || undefined,
        user_id: filters.user_id || undefined,
        entity_id: filters.entity_id || undefined,
        start_date: filters.start_date || undefined,
        end_date: filters.end_date || undefined,
        limit: pageSize,
        offset: page * pageSize,
      });
    },
  });

  // Export function
  const handleExport = async () => {
    try {
      const allLogs = await queryLogs({
        action: filters.action || undefined,
        entity_type: filters.entity_type || undefined,
        user_id: filters.user_id || undefined,
        entity_id: filters.entity_id || undefined,
        start_date: filters.start_date || undefined,
        end_date: filters.end_date || undefined,
        limit: 10000, // Large limit for export
      });

      // Convert to CSV
      const headers = ['Date', 'User', 'Action', 'Entity Type', 'Entity ID', 'Details'];
      const rows = allLogs.data.map(log => [
        log.created_at || '',
        log.user_id || '',
        log.action,
        log.entity_type,
        log.entity_id || '',
        JSON.stringify(log.changes || log.new_data || {}),
      ]);

      const csv = [
        headers.join(','),
        ...rows.map(row => row.map(cell => `"${cell}"`).join(',')),
      ].join('\n');

      // Download
      const blob = new Blob([csv], { type: 'text/csv' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `audit-logs-${format(new Date(), 'yyyy-MM-dd')}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Export failed:', error);
    }
  };

  const getActionColor = (action: AuditAction) => {
    switch (action) {
      case 'create':
        return 'bg-green-100 text-green-800';
      case 'update':
        return 'bg-blue-100 text-blue-800';
      case 'delete':
        return 'bg-red-100 text-red-800';
      case 'view':
        return 'bg-gray-100 text-gray-800';
      case 'export':
        return 'bg-purple-100 text-purple-800';
      case 'login':
      case 'logout':
        return 'bg-yellow-100 text-yellow-800';
      default:
        return 'bg-gray-100 text-gray-800';
    }
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>سجل الأنشطة</CardTitle>
              <CardDescription>
                عرض جميع العمليات والأنشطة في النظام
              </CardDescription>
            </div>
            <Button onClick={handleExport} variant="outline">
              <Download className="mr-2 h-4 w-4" />
              تصدير
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {/* Filters */}
          <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-4 gap-4 mb-6">
            <Select
              value={filters.action}
              onValueChange={(value) => setFilters({ ...filters, action: value as AuditAction })}
            >
              <SelectTrigger>
                <SelectValue placeholder="نوع العملية" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="">الكل</SelectItem>
                <SelectItem value="create">إنشاء</SelectItem>
                <SelectItem value="update">تحديث</SelectItem>
                <SelectItem value="delete">حذف</SelectItem>
                <SelectItem value="view">عرض</SelectItem>
                <SelectItem value="export">تصدير</SelectItem>
                <SelectItem value="login">تسجيل دخول</SelectItem>
                <SelectItem value="logout">تسجيل خروج</SelectItem>
              </SelectContent>
            </Select>

            <Select
              value={filters.entity_type}
              onValueChange={(value) => setFilters({ ...filters, entity_type: value as AuditEntityType })}
            >
              <SelectTrigger>
                <SelectValue placeholder="نوع الكيان" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="">الكل</SelectItem>
                <SelectItem value="manufacturing_order">أمر تصنيع</SelectItem>
                <SelectItem value="inventory_item">مخزون</SelectItem>
                <SelectItem value="gl_account">حساب محاسبي</SelectItem>
                <SelectItem value="journal_entry">قيد محاسبي</SelectItem>
                <SelectItem value="sales_order">أمر بيع</SelectItem>
                <SelectItem value="user">مستخدم</SelectItem>
              </SelectContent>
            </Select>

            <Input
              placeholder="معرف الكيان"
              value={filters.entity_id}
              onChange={(e) => setFilters({ ...filters, entity_id: e.target.value })}
            />

            <Input
              placeholder="معرف المستخدم"
              value={filters.user_id}
              onChange={(e) => setFilters({ ...filters, user_id: e.target.value })}
            />
          </div>

          {/* Date Range */}
          <div className="grid grid-cols-2 gap-4 mb-6">
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" className="w-full justify-start text-left font-normal">
                  <CalendarIcon className="mr-2 h-4 w-4" />
                  {filters.start_date ? format(new Date(filters.start_date), 'yyyy-MM-dd') : 'من تاريخ'}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0">
                <Calendar
                  mode="single"
                  selected={filters.start_date ? new Date(filters.start_date) : undefined}
                  onSelect={(date) => setFilters({ ...filters, start_date: date ? format(date, 'yyyy-MM-dd') : '' })}
                />
              </PopoverContent>
            </Popover>

            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" className="w-full justify-start text-left font-normal">
                  <CalendarIcon className="mr-2 h-4 w-4" />
                  {filters.end_date ? format(new Date(filters.end_date), 'yyyy-MM-dd') : 'إلى تاريخ'}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0">
                <Calendar
                  mode="single"
                  selected={filters.end_date ? new Date(filters.end_date) : undefined}
                  onSelect={(date) => setFilters({ ...filters, end_date: date ? format(date, 'yyyy-MM-dd') : '' })}
                />
              </PopoverContent>
            </Popover>
          </div>

          {/* Results */}
          {isLoading && <div className="text-center py-8">جاري التحميل...</div>}
          
          {error && (
            <div className="text-center py-8 text-red-600">
              خطأ في تحميل السجلات: {error instanceof Error ? error.message : 'خطأ غير معروف'}
            </div>
          )}

          {data && (
            <>
              <div className="mb-4 text-sm text-muted-foreground">
                عرض {data.data.length} من {data.count} سجل
              </div>

              <div className="border rounded-lg">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>التاريخ</TableHead>
                      <TableHead>المستخدم</TableHead>
                      <TableHead>العملية</TableHead>
                      <TableHead>نوع الكيان</TableHead>
                      <TableHead>معرف الكيان</TableHead>
                      <TableHead>التفاصيل</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.data.map((log) => (
                      <TableRow key={log.id}>
                        <TableCell>
                          {log.created_at
                            ? format(new Date(log.created_at), 'yyyy-MM-dd HH:mm', { locale: ar })
                            : '-'}
                        </TableCell>
                        <TableCell className="font-mono text-xs">
                          {log.user_id?.substring(0, 8)}...
                        </TableCell>
                        <TableCell>
                          <Badge className={getActionColor(log.action)}>
                            {log.action}
                          </Badge>
                        </TableCell>
                        <TableCell>{log.entity_type}</TableCell>
                        <TableCell className="font-mono text-xs">
                          {log.entity_id?.substring(0, 8)}...
                        </TableCell>
                        <TableCell>
                          {log.changes ? (
                            <details className="text-xs">
                              <summary className="cursor-pointer text-blue-600">
                                عرض التغييرات
                              </summary>
                              <pre className="mt-2 p-2 bg-muted rounded text-xs overflow-auto">
                                {JSON.stringify(log.changes, null, 2)}
                              </pre>
                            </details>
                          ) : (
                            '-'
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              {/* Pagination */}
              <div className="flex items-center justify-between mt-4">
                <Button
                  variant="outline"
                  onClick={() => setPage(p => Math.max(0, p - 1))}
                  disabled={page === 0}
                >
                  السابق
                </Button>
                <span className="text-sm text-muted-foreground">
                  صفحة {page + 1}
                </span>
                <Button
                  variant="outline"
                  onClick={() => setPage(p => p + 1)}
                  disabled={!data.has_more}
                >
                  التالي
                </Button>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export default AuditLogViewer;

