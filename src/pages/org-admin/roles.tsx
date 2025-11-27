// src/pages/org-admin/roles.tsx
// بسم الله الرحمن الرحيم
// Org Admin - Roles & Permissions Management

import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { 
  getOrgRolesWithStats, 
  OrgRole, 
  getRoleTemplates, 
  createRoleFromTemplate, 
  RoleTemplate 
} from '@/services/org-admin-service';
import { getSupabase } from '@/lib/supabase';
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
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  ArrowLeft,
  Shield,
  Plus,
  RefreshCw,
  Settings,
  Edit2,
  Trash2,
  Lock,
  Key,
  Check,
  ChevronDown,
  ChevronUp,
  FileText,
  Copy,
  Sparkles,
} from 'lucide-react';
import { toast } from 'sonner';

interface Permission {
  id: string;
  module_id: string;
  action: string;
  name: string;
  name_ar: string;
  description?: string;
  description_ar?: string;
}

interface Module {
  id: string;
  code: string;
  name: string;
  name_ar: string;
  permissions: Permission[];
}

interface RoleFormData {
  name: string;
  name_ar: string;
  description: string;
  description_ar: string;
  permission_ids: string[];
}

export default function OrgAdminRoles() {
  const { currentOrgId } = useAuth();
  const navigate = useNavigate();
  const [roles, setRoles] = useState<OrgRole[]>([]);
  const [modules, setModules] = useState<Module[]>([]);
  const [loading, setLoading] = useState(true);
  
  // Templates state
  const [templates, setTemplates] = useState<RoleTemplate[]>([]);
  const [activeTab, setActiveTab] = useState<'roles' | 'templates'>('roles');
  const [creatingFromTemplate, setCreatingFromTemplate] = useState<string | null>(null);

  // Form state
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingRole, setEditingRole] = useState<OrgRole | null>(null);
  const [formData, setFormData] = useState<RoleFormData>({
    name: '',
    name_ar: '',
    description: '',
    description_ar: '',
    permission_ids: [],
  });
  const [saving, setSaving] = useState(false);

  // Expanded modules for permission selection
  const [expandedModules, setExpandedModules] = useState<string[]>([]);

  useEffect(() => {
    loadData();
  }, [currentOrgId]);

  async function loadData() {
    if (!currentOrgId) return;
    
    setLoading(true);
    try {
      const supabase = getSupabase();

      // Load roles
      const rolesData = await getOrgRolesWithStats(currentOrgId);
      setRoles(rolesData);

      // Load templates
      const templatesData = await getRoleTemplates();
      setTemplates(templatesData);

      // Load modules with permissions
      const { data: modulesData } = await supabase
        .from('modules')
        .select(`
          *,
          permissions(*)
        `)
        .order('display_order');

      setModules(modulesData || []);
    } catch (error) {
      console.error('Error loading data:', error);
      toast.error('فشل تحميل البيانات');
    } finally {
      setLoading(false);
    }
  }

  async function handleCreateFromTemplate(templateId: string) {
    if (!currentOrgId) return;

    setCreatingFromTemplate(templateId);
    try {
      const result = await createRoleFromTemplate(currentOrgId, templateId);
      
      if (result.success) {
        toast.success('تم إنشاء الدور من القالب بنجاح');
        loadData();
        setActiveTab('roles');
      } else {
        toast.error(result.error || 'فشل إنشاء الدور');
      }
    } catch (error: any) {
      console.error('Error creating role from template:', error);
      toast.error(error.message || 'فشل إنشاء الدور');
    } finally {
      setCreatingFromTemplate(null);
    }
  }

  function getCategoryLabel(category: string): string {
    const categories: Record<string, string> = {
      accounting: 'المحاسبة',
      manufacturing: 'التصنيع',
      sales: 'المبيعات',
      inventory: 'المخزون',
      hr: 'الموارد البشرية',
      general: 'عام',
    };
    return categories[category] || category;
  }

  function getCategoryColor(category: string): string {
    const colors: Record<string, string> = {
      accounting: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
      manufacturing: 'bg-amber-500/20 text-amber-400 border-amber-500/30',
      sales: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
      inventory: 'bg-purple-500/20 text-purple-400 border-purple-500/30',
      hr: 'bg-pink-500/20 text-pink-400 border-pink-500/30',
      general: 'bg-slate-500/20 text-slate-400 border-slate-500/30',
    };
    return colors[category] || colors.general;
  }

  function openNewRoleDialog() {
    setEditingRole(null);
    setFormData({
      name: '',
      name_ar: '',
      description: '',
      description_ar: '',
      permission_ids: [],
    });
    setExpandedModules([]);
    setDialogOpen(true);
  }

  async function openEditRoleDialog(role: OrgRole) {
    const supabase = getSupabase();
    
    // Get role permissions
    const { data: rolePerms } = await supabase
      .from('role_permissions')
      .select('permission_id')
      .eq('role_id', role.id);

    setEditingRole(role);
    setFormData({
      name: role.name,
      name_ar: role.name_ar,
      description: role.description || '',
      description_ar: role.description_ar || '',
      permission_ids: (rolePerms || []).map(rp => rp.permission_id),
    });
    setDialogOpen(true);
  }

  async function handleSaveRole(e: React.FormEvent) {
    e.preventDefault();
    if (!currentOrgId) return;

    if (!formData.name_ar) {
      toast.error('اسم الدور مطلوب');
      return;
    }

    setSaving(true);
    try {
      const supabase = getSupabase();

      if (editingRole) {
        // Update role
        const { error: roleError } = await supabase
          .from('roles')
          .update({
            name: formData.name || formData.name_ar,
            name_ar: formData.name_ar,
            description: formData.description,
            description_ar: formData.description_ar,
          })
          .eq('id', editingRole.id);

        if (roleError) throw roleError;

        // Delete existing permissions
        await supabase
          .from('role_permissions')
          .delete()
          .eq('role_id', editingRole.id);

        // Add new permissions
        if (formData.permission_ids.length > 0) {
          const rolePerms = formData.permission_ids.map(permId => ({
            role_id: editingRole.id,
            permission_id: permId,
          }));

          await supabase.from('role_permissions').insert(rolePerms);
        }

        toast.success('تم تحديث الدور');
      } else {
        // Create new role
        const { data: newRole, error: roleError } = await supabase
          .from('roles')
          .insert({
            org_id: currentOrgId,
            name: formData.name || formData.name_ar,
            name_ar: formData.name_ar,
            description: formData.description,
            description_ar: formData.description_ar,
            is_system_role: false,
            is_active: true,
          })
          .select()
          .single();

        if (roleError) throw roleError;

        // Add permissions
        if (formData.permission_ids.length > 0) {
          const rolePerms = formData.permission_ids.map(permId => ({
            role_id: newRole.id,
            permission_id: permId,
          }));

          await supabase.from('role_permissions').insert(rolePerms);
        }

        toast.success('تم إنشاء الدور');
      }

      setDialogOpen(false);
      loadData();
    } catch (error: any) {
      console.error('Error saving role:', error);
      toast.error(error.message || 'فشل حفظ الدور');
    } finally {
      setSaving(false);
    }
  }

  async function handleDeleteRole(roleId: string) {
    try {
      const supabase = getSupabase();

      // Delete role permissions first
      await supabase
        .from('role_permissions')
        .delete()
        .eq('role_id', roleId);

      // Delete user roles
      await supabase
        .from('user_roles')
        .delete()
        .eq('role_id', roleId);

      // Delete role
      const { error } = await supabase
        .from('roles')
        .delete()
        .eq('id', roleId);

      if (error) throw error;

      setRoles(roles.filter(r => r.id !== roleId));
      toast.success('تم حذف الدور');
    } catch (error: any) {
      console.error('Error deleting role:', error);
      toast.error(error.message || 'فشل حذف الدور');
    }
  }

  function toggleModule(moduleId: string) {
    if (expandedModules.includes(moduleId)) {
      setExpandedModules(expandedModules.filter(id => id !== moduleId));
    } else {
      setExpandedModules([...expandedModules, moduleId]);
    }
  }

  function toggleModulePermissions(module: Module, select: boolean) {
    if (select) {
      const modulePermIds = module.permissions.map(p => p.id);
      setFormData({
        ...formData,
        permission_ids: [...new Set([...formData.permission_ids, ...modulePermIds])],
      });
    } else {
      const modulePermIds = new Set(module.permissions.map(p => p.id));
      setFormData({
        ...formData,
        permission_ids: formData.permission_ids.filter(id => !modulePermIds.has(id)),
      });
    }
  }

  function getModuleSelectedCount(module: Module) {
    return module.permissions.filter(p => formData.permission_ids.includes(p.id)).length;
  }

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
                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-purple-500 to-pink-600 flex items-center justify-center">
                  <Shield className="h-5 w-5 text-white" />
                </div>
                <div>
                  <h1 className="text-xl font-bold text-white">إدارة الأدوار</h1>
                  <p className="text-sm text-slate-400">{roles.length} دور</p>
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
              <Button
                onClick={openNewRoleDialog}
                className="bg-gradient-to-r from-teal-600 to-cyan-600 hover:from-teal-500 hover:to-cyan-500"
              >
                <Plus className="h-4 w-4 ml-2" />
                دور جديد
              </Button>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-8">
        {/* Tabs */}
        <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as 'roles' | 'templates')} className="mb-6">
          <TabsList className="bg-slate-800/50 border border-slate-700">
            <TabsTrigger 
              value="roles" 
              className="data-[state=active]:bg-slate-700 data-[state=active]:text-white"
            >
              <Shield className="h-4 w-4 ml-2" />
              الأدوار ({roles.length})
            </TabsTrigger>
            <TabsTrigger 
              value="templates"
              className="data-[state=active]:bg-slate-700 data-[state=active]:text-white"
            >
              <Sparkles className="h-4 w-4 ml-2" />
              قوالب جاهزة ({templates.length})
            </TabsTrigger>
          </TabsList>

          {/* Roles Tab */}
          <TabsContent value="roles" className="mt-6">
            {loading ? (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {[1, 2, 3].map(i => (
                  <Skeleton key={i} className="h-48 w-full bg-slate-800 rounded-xl" />
                ))}
              </div>
            ) : roles.length === 0 ? (
              <Card className="bg-slate-900/50 border-slate-800">
                <CardContent className="p-12 text-center">
                  <Shield className="h-12 w-12 mx-auto text-slate-600 mb-4" />
                  <h3 className="text-lg font-semibold text-white mb-2">لا توجد أدوار</h3>
                  <p className="text-slate-400 mb-4">قم بإنشاء دور جديد أو استخدم قالب جاهز</p>
                  <div className="flex items-center justify-center gap-3">
                    <Button
                      onClick={openNewRoleDialog}
                      className="bg-gradient-to-r from-teal-600 to-cyan-600"
                    >
                      <Plus className="h-4 w-4 ml-2" />
                      إنشاء دور
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() => setActiveTab('templates')}
                      className="border-slate-700"
                    >
                      <Sparkles className="h-4 w-4 ml-2" />
                      استخدام قالب
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {roles.map(role => (
              <Card
                key={role.id}
                className="bg-slate-900/50 border-slate-800 hover:border-slate-700 transition-all group"
              >
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between">
                    <div>
                      <CardTitle className="text-white flex items-center gap-2">
                        {role.is_system_role && (
                          <Lock className="h-4 w-4 text-amber-400" />
                        )}
                        {role.name_ar || role.name}
                      </CardTitle>
                      {role.description_ar || role.description ? (
                        <CardDescription className="text-slate-400 mt-1">
                          {role.description_ar || role.description}
                        </CardDescription>
                      ) : null}
                    </div>
                    {!role.is_system_role && (
                      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => openEditRoleDialog(role)}
                          className="text-slate-400 hover:text-white h-8 w-8"
                        >
                          <Edit2 className="h-4 w-4" />
                        </Button>
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="text-rose-400 hover:text-rose-300 h-8 w-8"
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent className="bg-slate-900 border-slate-800">
                            <AlertDialogHeader>
                              <AlertDialogTitle className="text-white">حذف الدور</AlertDialogTitle>
                              <AlertDialogDescription className="text-slate-400">
                                هل أنت متأكد من حذف "{role.name_ar || role.name}"؟
                                سيتم إزالة هذا الدور من جميع المستخدمين.
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter className="gap-2">
                              <AlertDialogCancel className="bg-slate-800 border-slate-700 text-slate-300">
                                إلغاء
                              </AlertDialogCancel>
                              <AlertDialogAction
                                onClick={() => handleDeleteRole(role.id)}
                                className="bg-rose-600 hover:bg-rose-500"
                              >
                                حذف
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </div>
                    )}
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="flex items-center gap-4">
                    <div className="flex items-center gap-2 text-slate-400">
                      <Key className="h-4 w-4" />
                      <span className="text-sm">{role.permissions_count || 0} صلاحية</span>
                    </div>
                    {role.is_system_role && (
                      <Badge className="bg-amber-600/20 text-amber-400 border-amber-500/30">
                        دور نظامي
                      </Badge>
                    )}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
          </TabsContent>

          {/* Templates Tab */}
          <TabsContent value="templates" className="mt-6">
            {loading ? (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {[1, 2, 3].map(i => (
                  <Skeleton key={i} className="h-48 w-full bg-slate-800 rounded-xl" />
                ))}
              </div>
            ) : templates.length === 0 ? (
              <Card className="bg-slate-900/50 border-slate-800">
                <CardContent className="p-12 text-center">
                  <Sparkles className="h-12 w-12 mx-auto text-slate-600 mb-4" />
                  <h3 className="text-lg font-semibold text-white mb-2">لا توجد قوالب</h3>
                  <p className="text-slate-400">لم يتم إعداد قوالب أدوار جاهزة بعد</p>
                </CardContent>
              </Card>
            ) : (
              <div className="space-y-6">
                <p className="text-slate-400 text-sm">
                  اختر قالباً جاهزاً لإنشاء دور بسرعة مع الصلاحيات المناسبة
                </p>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                  {templates.map(template => (
                    <Card
                      key={template.id}
                      className="bg-slate-900/50 border-slate-800 hover:border-slate-700 transition-all group"
                    >
                      <CardHeader className="pb-3">
                        <div className="flex items-start justify-between">
                          <div>
                            <CardTitle className="text-white flex items-center gap-2">
                              <FileText className="h-4 w-4 text-cyan-400" />
                              {template.name_ar || template.name}
                            </CardTitle>
                            {template.description_ar || template.description ? (
                              <CardDescription className="text-slate-400 mt-1">
                                {template.description_ar || template.description}
                              </CardDescription>
                            ) : null}
                          </div>
                        </div>
                      </CardHeader>
                      <CardContent>
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            {template.category && (
                              <Badge className={getCategoryColor(template.category)}>
                                {getCategoryLabel(template.category)}
                              </Badge>
                            )}
                            <span className="text-xs text-slate-500">
                              {template.permission_keys?.length || 0} صلاحية
                            </span>
                          </div>
                          <Button
                            size="sm"
                            onClick={() => handleCreateFromTemplate(template.id)}
                            disabled={creatingFromTemplate === template.id}
                            className="bg-gradient-to-r from-cyan-600 to-teal-600 hover:from-cyan-500 hover:to-teal-500"
                          >
                            {creatingFromTemplate === template.id ? (
                              <RefreshCw className="h-4 w-4 animate-spin" />
                            ) : (
                              <>
                                <Copy className="h-4 w-4 ml-1" />
                                استخدام
                              </>
                            )}
                          </Button>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </div>
            )}
          </TabsContent>
        </Tabs>
      </main>

      {/* Role Form Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="bg-slate-900 border-slate-800 max-w-3xl max-h-[90vh] overflow-hidden flex flex-col">
          <form onSubmit={handleSaveRole} className="flex flex-col h-full">
            <DialogHeader>
              <DialogTitle className="text-white flex items-center gap-2">
                <Shield className="h-5 w-5 text-purple-400" />
                {editingRole ? 'تعديل الدور' : 'إنشاء دور جديد'}
              </DialogTitle>
              <DialogDescription className="text-slate-400">
                حدد صلاحيات الدور لكل موديول
              </DialogDescription>
            </DialogHeader>

            <div className="flex-1 overflow-y-auto py-4 space-y-6">
              {/* Basic Info */}
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label className="text-slate-300">الاسم بالعربية *</Label>
                  <Input
                    placeholder="مثال: محاسب"
                    value={formData.name_ar}
                    onChange={(e) => setFormData({ ...formData, name_ar: e.target.value })}
                    className="bg-slate-950 border-slate-800 text-white"
                  />
                </div>
                <div className="space-y-2">
                  <Label className="text-slate-300">الاسم بالإنجليزية</Label>
                  <Input
                    placeholder="e.g. Accountant"
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    className="bg-slate-950 border-slate-800 text-white"
                    dir="ltr"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label className="text-slate-300">الوصف</Label>
                <Textarea
                  placeholder="وصف مختصر للدور..."
                  value={formData.description_ar}
                  onChange={(e) => setFormData({ ...formData, description_ar: e.target.value })}
                  className="bg-slate-950 border-slate-800 text-white resize-none"
                  rows={2}
                />
              </div>

              {/* Permissions Matrix */}
              <div className="space-y-3">
                <Label className="text-slate-300 flex items-center gap-2">
                  <Key className="h-4 w-4" />
                  الصلاحيات
                  <Badge variant="outline" className="border-slate-700 text-slate-400">
                    {formData.permission_ids.length} محددة
                  </Badge>
                </Label>

                <div className="space-y-2">
                  {modules.map(module => {
                    const isExpanded = expandedModules.includes(module.id);
                    const selectedCount = getModuleSelectedCount(module);
                    const allSelected = selectedCount === module.permissions.length;

                    return (
                      <div
                        key={module.id}
                        className="border border-slate-800 rounded-lg overflow-hidden"
                      >
                        {/* Module Header */}
                        <div
                          className="flex items-center justify-between p-3 bg-slate-950/50 cursor-pointer hover:bg-slate-900/50 transition-colors"
                          onClick={() => toggleModule(module.id)}
                        >
                          <div className="flex items-center gap-3">
                            <Checkbox
                              checked={allSelected}
                              onCheckedChange={(checked) => {
                                toggleModulePermissions(module, !!checked);
                              }}
                              onClick={(e) => e.stopPropagation()}
                              className="border-slate-600"
                            />
                            <span className="font-medium text-white">
                              {module.name_ar || module.name}
                            </span>
                            <Badge variant="outline" className="border-slate-700 text-slate-400 text-xs">
                              {selectedCount}/{module.permissions.length}
                            </Badge>
                          </div>
                          {isExpanded ? (
                            <ChevronUp className="h-4 w-4 text-slate-400" />
                          ) : (
                            <ChevronDown className="h-4 w-4 text-slate-400" />
                          )}
                        </div>

                        {/* Permissions List */}
                        {isExpanded && (
                          <div className="p-3 border-t border-slate-800 grid grid-cols-2 gap-2">
                            {module.permissions.map(perm => (
                              <div
                                key={perm.id}
                                className={`flex items-center gap-2 p-2 rounded-lg transition-colors cursor-pointer ${
                                  formData.permission_ids.includes(perm.id)
                                    ? 'bg-teal-950/50 border border-teal-500/30'
                                    : 'bg-slate-950/50 border border-transparent hover:border-slate-700'
                                }`}
                                onClick={() => {
                                  if (formData.permission_ids.includes(perm.id)) {
                                    setFormData({
                                      ...formData,
                                      permission_ids: formData.permission_ids.filter(id => id !== perm.id),
                                    });
                                  } else {
                                    setFormData({
                                      ...formData,
                                      permission_ids: [...formData.permission_ids, perm.id],
                                    });
                                  }
                                }}
                              >
                                <Checkbox
                                  checked={formData.permission_ids.includes(perm.id)}
                                  className="border-slate-600"
                                />
                                <span className="text-sm text-slate-300">
                                  {perm.name_ar || perm.name}
                                </span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>

            <DialogFooter className="gap-2 pt-4 border-t border-slate-800">
              <Button
                type="button"
                variant="outline"
                onClick={() => setDialogOpen(false)}
                className="border-slate-700 text-slate-300"
              >
                إلغاء
              </Button>
              <Button
                type="submit"
                disabled={saving}
                className="bg-gradient-to-r from-teal-600 to-cyan-600"
              >
                {saving ? 'جاري الحفظ...' : editingRole ? 'حفظ التغييرات' : 'إنشاء الدور'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

