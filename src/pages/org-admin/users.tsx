// src/pages/org-admin/users.tsx
// بسم الله الرحمن الرحيم
// Org Admin - Users Management

import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import {
  getOrgUsers,
  toggleUserStatus,
  setUserAsOrgAdmin,
  removeUserFromOrg,
  getOrgRolesWithStats,
  updateUserRoles,
  OrgUser,
  OrgRole,
} from '@/services/org-admin-service';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import {
  ArrowLeft,
  Users,
  Search,
  UserPlus,
  Shield,
  ShieldCheck,
  Trash2,
  MoreVertical,
  RefreshCw,
  UserCog,
} from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { toast } from 'sonner';

export default function OrgAdminUsers() {
  const { currentOrgId, user } = useAuth();
  const navigate = useNavigate();
  const [users, setUsers] = useState<OrgUser[]>([]);
  const [roles, setRoles] = useState<OrgRole[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [filter, setFilter] = useState<'all' | 'active' | 'inactive'>('all');

  // Role assignment dialog
  const [roleDialogOpen, setRoleDialogOpen] = useState(false);
  const [selectedUser, setSelectedUser] = useState<OrgUser | null>(null);
  const [selectedRoleIds, setSelectedRoleIds] = useState<string[]>([]);
  const [savingRoles, setSavingRoles] = useState(false);

  useEffect(() => {
    loadData();
  }, [currentOrgId]);

  async function loadData() {
    if (!currentOrgId) return;
    
    setLoading(true);
    try {
      const [usersData, rolesData] = await Promise.all([
        getOrgUsers(currentOrgId),
        getOrgRolesWithStats(currentOrgId),
      ]);
      setUsers(usersData);
      setRoles(rolesData);
    } catch (error) {
      console.error('Error loading data:', error);
      toast.error('فشل تحميل البيانات');
    } finally {
      setLoading(false);
    }
  }

  async function handleToggleStatus(userId: string, currentStatus: boolean) {
    if (!currentOrgId) return;
    
    const result = await toggleUserStatus(userId, currentOrgId, !currentStatus);
    if (result.success) {
      setUsers(users.map(u =>
        u.user_id === userId ? { ...u, is_active: !currentStatus } : u
      ));
      toast.success(currentStatus ? 'تم تعطيل المستخدم' : 'تم تفعيل المستخدم');
    } else {
      toast.error(result.error || 'فشل تحديث الحالة');
    }
  }

  async function handleToggleAdmin(userId: string, currentStatus: boolean) {
    if (!currentOrgId) return;
    
    const result = await setUserAsOrgAdmin(userId, currentOrgId, !currentStatus);
    if (result.success) {
      setUsers(users.map(u =>
        u.user_id === userId ? { ...u, is_org_admin: !currentStatus } : u
      ));
      toast.success(currentStatus ? 'تم إزالة صلاحية المسؤول' : 'تم تعيين كمسؤول');
    } else {
      toast.error(result.error || 'فشل تحديث الصلاحية');
    }
  }

  async function handleRemoveUser(userId: string) {
    if (!currentOrgId) return;
    
    const result = await removeUserFromOrg(userId, currentOrgId);
    if (result.success) {
      setUsers(users.filter(u => u.user_id !== userId));
      toast.success('تم إزالة المستخدم');
    } else {
      toast.error(result.error || 'فشل إزالة المستخدم');
    }
  }

  function openRoleDialog(u: OrgUser) {
    setSelectedUser(u);
    setSelectedRoleIds(u.roles?.map(r => r.id) || []);
    setRoleDialogOpen(true);
  }

  async function handleSaveRoles() {
    if (!currentOrgId || !selectedUser) return;
    
    setSavingRoles(true);
    try {
      const result = await updateUserRoles(selectedUser.user_id, currentOrgId, selectedRoleIds);
      if (result.success) {
        // Update local state
        setUsers(users.map(u => {
          if (u.user_id === selectedUser.user_id) {
            return {
              ...u,
              roles: roles.filter(r => selectedRoleIds.includes(r.id)),
            };
          }
          return u;
        }));
        toast.success('تم تحديث الأدوار');
        setRoleDialogOpen(false);
      } else {
        toast.error(result.error || 'فشل تحديث الأدوار');
      }
    } catch (error) {
      toast.error('حدث خطأ');
    } finally {
      setSavingRoles(false);
    }
  }

  const filteredUsers = users.filter(u => {
    const matchesSearch = 
      (u.user_profile?.full_name || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
      (u.user_profile?.full_name_ar || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
      (u.email || '').toLowerCase().includes(searchTerm.toLowerCase());

    const matchesFilter =
      filter === 'all' ||
      (filter === 'active' && u.is_active) ||
      (filter === 'inactive' && !u.is_active);

    return matchesSearch && matchesFilter;
  });

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
                onClick={() => navigate('/org-admin')}
                className="text-slate-400 hover:text-white"
              >
                <ArrowLeft className="h-5 w-5" />
              </Button>
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center">
                  <Users className="h-5 w-5 text-white" />
                </div>
                <div>
                  <h1 className="text-xl font-bold text-white">إدارة المستخدمين</h1>
                  <p className="text-sm text-slate-400">{users.length} مستخدم</p>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <Button
                variant="outline"
                size="icon"
                onClick={loadData}
                className="border-slate-700 text-slate-400 hover:text-white"
              >
                <RefreshCw className="h-4 w-4" />
              </Button>
              <Link to="/org-admin/invitations">
                <Button className="bg-gradient-to-r from-teal-600 to-cyan-600 hover:from-teal-500 hover:to-cyan-500">
                  <UserPlus className="h-4 w-4 ml-2" />
                  دعوة مستخدم
                </Button>
              </Link>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-8">
        {/* Filters */}
        <Card className="bg-slate-900/50 border-slate-800 mb-6">
          <CardContent className="p-4">
            <div className="flex flex-wrap items-center gap-4">
              <div className="flex-1 min-w-[200px]">
                <div className="relative">
                  <Search className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                  <Input
                    placeholder="البحث بالاسم أو البريد..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="pr-10 bg-slate-950 border-slate-800 text-white"
                  />
                </div>
              </div>
              <div className="flex items-center gap-2">
                {(['all', 'active', 'inactive'] as const).map(f => (
                  <Button
                    key={f}
                    variant={filter === f ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => setFilter(f)}
                    className={filter === f
                      ? 'bg-teal-600'
                      : 'border-slate-700 text-slate-400 hover:text-white'
                    }
                  >
                    {f === 'all' ? 'الكل' : f === 'active' ? 'النشطين' : 'المعطلين'}
                  </Button>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Users Table */}
        <Card className="bg-slate-900/50 border-slate-800">
          <CardContent className="p-0">
            {loading ? (
              <div className="p-6 space-y-4">
                {[1, 2, 3].map(i => (
                  <Skeleton key={i} className="h-16 w-full bg-slate-800" />
                ))}
              </div>
            ) : filteredUsers.length === 0 ? (
              <div className="p-12 text-center">
                <Users className="h-12 w-12 mx-auto text-slate-600 mb-4" />
                <h3 className="text-lg font-semibold text-white mb-2">لا يوجد مستخدمين</h3>
                <p className="text-slate-400 mb-4">
                  {searchTerm ? 'لم يتم العثور على نتائج' : 'قم بدعوة مستخدمين للانضمام للمنظمة'}
                </p>
                <Link to="/org-admin/invitations">
                  <Button className="bg-gradient-to-r from-teal-600 to-cyan-600">
                    <UserPlus className="h-4 w-4 ml-2" />
                    دعوة مستخدم
                  </Button>
                </Link>
              </div>
            ) : (
              <div className="divide-y divide-slate-800">
                {filteredUsers.map(u => (
                  <div
                    key={u.id}
                    className="p-4 flex items-center gap-4 hover:bg-slate-800/30 transition-colors"
                  >
                    {/* Avatar */}
                    <div className="w-12 h-12 rounded-full bg-gradient-to-br from-slate-700 to-slate-600 flex items-center justify-center text-white font-bold">
                      {u.user_profile?.full_name?.charAt(0) || u.user_profile?.full_name_ar?.charAt(0) || '?'}
                    </div>

                    {/* Info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <h3 className="font-semibold text-white truncate">
                          {u.user_profile?.full_name_ar || u.user_profile?.full_name || 'مستخدم'}
                        </h3>
                        {u.is_org_admin && (
                          <Badge className="bg-purple-600/20 text-purple-400 border-purple-500/30">
                            <ShieldCheck className="h-3 w-3 ml-1" />
                            مسؤول
                          </Badge>
                        )}
                        {!u.is_active && (
                          <Badge variant="destructive" className="bg-rose-600/20 text-rose-400 border-rose-500/30">
                            معطل
                          </Badge>
                        )}
                      </div>
                      <p className="text-sm text-slate-400 truncate">{u.email}</p>
                    </div>

                    {/* Roles */}
                    <div className="hidden md:flex items-center gap-2 flex-wrap max-w-[200px]">
                      {(u.roles || []).slice(0, 2).map(role => (
                        <Badge
                          key={role.id}
                          variant="outline"
                          className="border-slate-700 text-slate-300"
                        >
                          {role.name_ar || role.name}
                        </Badge>
                      ))}
                      {(u.roles?.length || 0) > 2 && (
                        <Badge variant="outline" className="border-slate-700 text-slate-400">
                          +{u.roles!.length - 2}
                        </Badge>
                      )}
                    </div>

                    {/* Status Toggle */}
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-slate-500">{u.is_active ? 'نشط' : 'معطل'}</span>
                      <Switch
                        checked={u.is_active}
                        onCheckedChange={() => handleToggleStatus(u.user_id, u.is_active)}
                        disabled={u.user_id === user?.id}
                      />
                    </div>

                    {/* Actions */}
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" className="text-slate-400">
                          <MoreVertical className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="bg-slate-900 border-slate-800">
                        <DropdownMenuItem
                          onClick={() => openRoleDialog(u)}
                          className="text-slate-300 focus:text-white focus:bg-slate-800"
                        >
                          <UserCog className="h-4 w-4 ml-2" />
                          إدارة الأدوار
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={() => handleToggleAdmin(u.user_id, u.is_org_admin)}
                          className="text-slate-300 focus:text-white focus:bg-slate-800"
                          disabled={u.user_id === user?.id}
                        >
                          <Shield className="h-4 w-4 ml-2" />
                          {u.is_org_admin ? 'إزالة صلاحية المسؤول' : 'تعيين كمسؤول'}
                        </DropdownMenuItem>
                        <DropdownMenuSeparator className="bg-slate-800" />
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <DropdownMenuItem
                              onSelect={(e) => e.preventDefault()}
                              className="text-rose-400 focus:text-rose-300 focus:bg-rose-950/50"
                              disabled={u.user_id === user?.id}
                            >
                              <Trash2 className="h-4 w-4 ml-2" />
                              إزالة من المنظمة
                            </DropdownMenuItem>
                          </AlertDialogTrigger>
                          <AlertDialogContent className="bg-slate-900 border-slate-800">
                            <AlertDialogHeader>
                              <AlertDialogTitle className="text-white">تأكيد الإزالة</AlertDialogTitle>
                              <AlertDialogDescription className="text-slate-400">
                                هل أنت متأكد من إزالة "{u.user_profile?.full_name_ar || u.user_profile?.full_name}"؟
                                لن يتمكن من الوصول للمنظمة بعد الإزالة.
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter className="gap-2">
                              <AlertDialogCancel className="bg-slate-800 border-slate-700 text-slate-300 hover:bg-slate-700">
                                إلغاء
                              </AlertDialogCancel>
                              <AlertDialogAction
                                onClick={() => handleRemoveUser(u.user_id)}
                                className="bg-rose-600 hover:bg-rose-500"
                              >
                                إزالة
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </main>

      {/* Role Assignment Dialog */}
      <Dialog open={roleDialogOpen} onOpenChange={setRoleDialogOpen}>
        <DialogContent className="bg-slate-900 border-slate-800 max-w-md">
          <DialogHeader>
            <DialogTitle className="text-white flex items-center gap-2">
              <Shield className="h-5 w-5 text-purple-400" />
              إدارة أدوار المستخدم
            </DialogTitle>
            <DialogDescription className="text-slate-400">
              {selectedUser?.user_profile?.full_name_ar || selectedUser?.user_profile?.full_name}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            {roles.length === 0 ? (
              <p className="text-center text-slate-400 py-4">لا توجد أدوار متاحة</p>
            ) : (
              roles.map(role => (
                <div
                  key={role.id}
                  className={`p-4 rounded-lg border transition-colors cursor-pointer ${
                    selectedRoleIds.includes(role.id)
                      ? 'border-teal-500 bg-teal-950/30'
                      : 'border-slate-800 bg-slate-950/50 hover:border-slate-700'
                  }`}
                  onClick={() => {
                    if (selectedRoleIds.includes(role.id)) {
                      setSelectedRoleIds(selectedRoleIds.filter(id => id !== role.id));
                    } else {
                      setSelectedRoleIds([...selectedRoleIds, role.id]);
                    }
                  }}
                >
                  <div className="flex items-center gap-3">
                    <Checkbox
                      checked={selectedRoleIds.includes(role.id)}
                      className="border-slate-600"
                    />
                    <div className="flex-1">
                      <Label className="text-white font-medium cursor-pointer">
                        {role.name_ar || role.name}
                      </Label>
                      {role.description_ar || role.description ? (
                        <p className="text-xs text-slate-400 mt-1">
                          {role.description_ar || role.description}
                        </p>
                      ) : null}
                    </div>
                    <Badge variant="outline" className="border-slate-700 text-slate-400">
                      {role.permissions_count} صلاحية
                    </Badge>
                  </div>
                </div>
              ))
            )}
          </div>

          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              onClick={() => setRoleDialogOpen(false)}
              className="border-slate-700 text-slate-300"
            >
              إلغاء
            </Button>
            <Button
              onClick={handleSaveRoles}
              disabled={savingRoles}
              className="bg-gradient-to-r from-teal-600 to-cyan-600"
            >
              {savingRoles ? 'جاري الحفظ...' : 'حفظ التغييرات'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

