// src/pages/super-admin/organizations.tsx
// بسم الله الرحمن الرحيم
// صفحة إدارة المنظمات

import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  Building2,
  Plus,
  Search,
  MoreHorizontal,
  Edit,
  Trash2,
  Power,
  PowerOff,
  Users,
  CheckCircle2,
  XCircle,
  ArrowLeft,
  RefreshCw,
  Eye,
} from 'lucide-react';
import {
  getOrganizations,
  toggleOrganizationStatus,
  deleteOrganization,
  Organization,
} from '@/services/super-admin-service';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from 'sonner';

// =====================================
// Plan Badge Component
// =====================================

function PlanBadge({ plan }: { plan: string }) {
  const variants: Record<string, { variant: 'default' | 'secondary' | 'destructive' | 'outline'; label: string }> = {
    trial: { variant: 'secondary', label: 'تجريبي' },
    basic: { variant: 'default', label: 'أساسي' },
    pro: { variant: 'default', label: 'احترافي' },
    enterprise: { variant: 'default', label: 'مؤسسي' },
  };

  const v = variants[plan] || variants.trial;

  return <Badge variant={v.variant}>{v.label}</Badge>;
}

// =====================================
// Organizations Page
// =====================================

export function OrganizationsPage() {
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [selectedOrg, setSelectedOrg] = useState<Organization | null>(null);

  const loadOrganizations = async () => {
    setLoading(true);
    const data = await getOrganizations();
    setOrganizations(data);
    setLoading(false);
  };

  useEffect(() => {
    loadOrganizations();
  }, []);

  // Filter organizations
  const filteredOrgs = organizations.filter((org) => {
    const query = searchQuery.toLowerCase();
    return (
      org.name.toLowerCase().includes(query) ||
      org.name_ar?.toLowerCase().includes(query) ||
      org.code.toLowerCase().includes(query)
    );
  });

  // Handle toggle status
  const handleToggleStatus = async (org: Organization) => {
    const result = await toggleOrganizationStatus(org.id, !org.is_active);
    if (result.success) {
      toast.success(org.is_active ? 'تم إيقاف المنظمة' : 'تم تفعيل المنظمة');
      loadOrganizations();
    } else {
      toast.error(result.error || 'فشل تحديث الحالة');
    }
  };

  // Handle delete
  const handleDelete = async () => {
    if (!selectedOrg) return;

    const result = await deleteOrganization(selectedOrg.id);
    if (result.success) {
      toast.success('تم حذف المنظمة بنجاح');
      loadOrganizations();
    } else {
      toast.error(result.error || 'فشل حذف المنظمة');
    }

    setDeleteDialogOpen(false);
    setSelectedOrg(null);
  };

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <div className="flex items-center gap-3 mb-2">
            <Link to="/super-admin/dashboard">
              <Button variant="ghost" size="icon">
                <ArrowLeft className="h-5 w-5" />
              </Button>
            </Link>
            <Building2 className="h-8 w-8 text-primary" />
            <h1 className="text-3xl font-bold">إدارة المنظمات</h1>
          </div>
          <p className="text-muted-foreground">
            عرض وإدارة جميع المنظمات المسجلة في النظام
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={loadOrganizations} disabled={loading}>
            <RefreshCw className={`h-4 w-4 ml-2 ${loading ? 'animate-spin' : ''}`} />
            تحديث
          </Button>
          <Link to="/super-admin/organizations/new">
            <Button className="gap-2">
              <Plus className="h-5 w-5" />
              إنشاء منظمة جديدة
            </Button>
          </Link>
        </div>
      </div>

      {/* Search */}
      <Card>
        <CardContent className="p-4">
          <div className="relative">
            <Search className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="البحث عن منظمة..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pr-10"
            />
          </div>
        </CardContent>
      </Card>

      {/* Organizations Table */}
      <Card>
        <CardHeader>
          <CardTitle>
            المنظمات ({filteredOrgs.length})
          </CardTitle>
          <CardDescription>
            قائمة بجميع المنظمات المسجلة
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="space-y-4">
              {[1, 2, 3, 4, 5].map((i) => (
                <Skeleton key={i} className="h-16 w-full" />
              ))}
            </div>
          ) : filteredOrgs.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <Building2 className="h-16 w-16 mx-auto mb-4 opacity-50" />
              <p className="text-lg font-medium">لا توجد منظمات</p>
              <p className="text-sm">ابدأ بإنشاء منظمة جديدة</p>
              <Link to="/super-admin/organizations/new">
                <Button className="mt-4 gap-2">
                  <Plus className="h-4 w-4" />
                  إنشاء منظمة
                </Button>
              </Link>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-right">المنظمة</TableHead>
                    <TableHead className="text-right">الرمز</TableHead>
                    <TableHead className="text-right">الخطة</TableHead>
                    <TableHead className="text-right">المستخدمين</TableHead>
                    <TableHead className="text-right">الحالة</TableHead>
                    <TableHead className="text-right">تاريخ الإنشاء</TableHead>
                    <TableHead className="text-center w-[50px]">إجراءات</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredOrgs.map((org) => (
                    <TableRow key={org.id}>
                      <TableCell>
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
                            {org.logo_url ? (
                              <img
                                src={org.logo_url}
                                alt={org.name}
                                className="w-8 h-8 rounded-full"
                              />
                            ) : (
                              <Building2 className="h-5 w-5 text-primary" />
                            )}
                          </div>
                          <div>
                            <p className="font-medium">{org.name_ar || org.name}</p>
                            {org.name_ar && (
                              <p className="text-xs text-muted-foreground">{org.name}</p>
                            )}
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        <code className="px-2 py-1 bg-muted rounded text-sm">
                          {org.code}
                        </code>
                      </TableCell>
                      <TableCell>
                        <PlanBadge plan={org.plan_type} />
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1">
                          <Users className="h-4 w-4 text-muted-foreground" />
                          <span>{org.current_users_count || 0}</span>
                          <span className="text-muted-foreground">/ {org.max_users}</span>
                        </div>
                      </TableCell>
                      <TableCell>
                        {org.is_active ? (
                          <div className="flex items-center gap-1 text-green-600">
                            <CheckCircle2 className="h-4 w-4" />
                            <span>نشط</span>
                          </div>
                        ) : (
                          <div className="flex items-center gap-1 text-red-600">
                            <XCircle className="h-4 w-4" />
                            <span>موقف</span>
                          </div>
                        )}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {new Date(org.created_at).toLocaleDateString('ar-SA')}
                      </TableCell>
                      <TableCell>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon">
                              <MoreHorizontal className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuLabel>الإجراءات</DropdownMenuLabel>
                            <DropdownMenuSeparator />
                            <Link to={`/super-admin/organizations/${org.id}`}>
                              <DropdownMenuItem>
                                <Eye className="h-4 w-4 ml-2" />
                                عرض التفاصيل
                              </DropdownMenuItem>
                            </Link>
                            <Link to={`/super-admin/organizations/${org.id}`}>
                              <DropdownMenuItem>
                                <Edit className="h-4 w-4 ml-2" />
                                تعديل
                              </DropdownMenuItem>
                            </Link>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem onClick={() => handleToggleStatus(org)}>
                              {org.is_active ? (
                                <>
                                  <PowerOff className="h-4 w-4 ml-2" />
                                  إيقاف
                                </>
                              ) : (
                                <>
                                  <Power className="h-4 w-4 ml-2" />
                                  تفعيل
                                </>
                              )}
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              className="text-destructive"
                              onClick={() => {
                                setSelectedOrg(org);
                                setDeleteDialogOpen(true);
                              }}
                            >
                              <Trash2 className="h-4 w-4 ml-2" />
                              حذف
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>تأكيد الحذف</AlertDialogTitle>
            <AlertDialogDescription>
              هل أنت متأكد من حذف المنظمة "{selectedOrg?.name_ar || selectedOrg?.name}"؟
              {selectedOrg?.current_users_count && selectedOrg.current_users_count > 0 ? (
                <span className="block mt-2 text-warning">
                  ⚠️ هذه المنظمة تحتوي على {selectedOrg.current_users_count} مستخدم. سيتم إيقافها بدلاً من حذفها.
                </span>
              ) : (
                <span className="block mt-2">
                  هذا الإجراء لا يمكن التراجع عنه.
                </span>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>إلغاء</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              className="bg-destructive text-destructive-foreground"
            >
              حذف
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

export default OrganizationsPage;

