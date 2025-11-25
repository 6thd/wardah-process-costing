// src/pages/org-admin/invitations.tsx
// بسم الله الرحمن الرحيم
// Org Admin - Invitations Management

import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import {
  getInvitations,
  createInvitation,
  resendInvitation,
  revokeInvitation,
  getOrgRolesWithStats,
  CreateInvitationInput,
  Invitation,
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
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
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
import {
  ArrowLeft,
  Mail,
  Send,
  RefreshCw,
  Clock,
  CheckCircle2,
  XCircle,
  AlertCircle,
  Copy,
  RotateCcw,
  Trash2,
  UserPlus,
} from 'lucide-react';
import { toast } from 'sonner';

export default function OrgAdminInvitations() {
  const { currentOrgId, user, organizations } = useAuth();
  const navigate = useNavigate();
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [roles, setRoles] = useState<OrgRole[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | 'pending' | 'accepted' | 'expired'>('all');

  // New invitation form
  const [dialogOpen, setDialogOpen] = useState(false);
  const [formData, setFormData] = useState<CreateInvitationInput>({
    email: '',
    role_ids: [],
    message: '',
  });
  const [creating, setCreating] = useState(false);

  // Get org name and inviter name
  const currentOrg = organizations.find(o => o.org_id === currentOrgId);
  const orgName = currentOrg?.organization?.name_ar || currentOrg?.organization?.name || 'المنظمة';
  const inviterName = user?.email?.split('@')[0] || 'مدير النظام';

  useEffect(() => {
    loadData();
  }, [currentOrgId]);

  async function loadData() {
    if (!currentOrgId) return;
    
    setLoading(true);
    try {
      const [invitationsData, rolesData] = await Promise.all([
        getInvitations(currentOrgId),
        getOrgRolesWithStats(currentOrgId),
      ]);
      setInvitations(invitationsData);
      setRoles(rolesData);
    } catch (error) {
      console.error('Error loading data:', error);
      toast.error('فشل تحميل البيانات');
    } finally {
      setLoading(false);
    }
  }

  async function handleCreateInvitation(e: React.FormEvent) {
    e.preventDefault();
    if (!currentOrgId) return;

    if (!formData.email) {
      toast.error('البريد الإلكتروني مطلوب');
      return;
    }

    if (!formData.email.includes('@')) {
      toast.error('البريد الإلكتروني غير صالح');
      return;
    }

    setCreating(true);
    try {
      const result = await createInvitation(currentOrgId, formData, orgName, inviterName);
      if (result.success && result.invitation) {
        setInvitations([result.invitation, ...invitations]);
        setDialogOpen(false);
        setFormData({ email: '', role_ids: [], message: '' });
        toast.success('تم إنشاء الدعوة وإرسال البريد بنجاح');
      } else {
        toast.error(result.error || 'فشل إنشاء الدعوة');
      }
    } catch (error) {
      toast.error('حدث خطأ');
    } finally {
      setCreating(false);
    }
  }

  async function handleResend(invitationId: string) {
    const result = await resendInvitation(invitationId, orgName, inviterName);
    if (result.success) {
      toast.success('تم إعادة إرسال الدعوة بنجاح');
      loadData();
    } else {
      toast.error(result.error || 'فشل إعادة الإرسال');
    }
  }

  async function handleRevoke(invitationId: string) {
    const result = await revokeInvitation(invitationId);
    if (result.success) {
      setInvitations(invitations.map(inv =>
        inv.id === invitationId ? { ...inv, status: 'revoked' } : inv
      ));
      toast.success('تم إلغاء الدعوة');
    } else {
      toast.error(result.error || 'فشل الإلغاء');
    }
  }

  async function copyInviteLink(token: string) {
    const link = `${window.location.origin}/signup?invite=${token}`;
    
    try {
      // Try modern clipboard API first
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(link);
        toast.success('تم نسخ رابط الدعوة');
      } else {
        // Fallback for older browsers or non-HTTPS
        const textArea = document.createElement('textarea');
        textArea.value = link;
        textArea.style.position = 'fixed';
        textArea.style.left = '-999999px';
        textArea.style.top = '-999999px';
        document.body.appendChild(textArea);
        textArea.focus();
        textArea.select();
        
        const successful = document.execCommand('copy');
        document.body.removeChild(textArea);
        
        if (successful) {
          toast.success('تم نسخ رابط الدعوة');
        } else {
          // Show the link in a toast if copy fails
          toast.info(`رابط الدعوة: ${link}`, { duration: 10000 });
        }
      }
    } catch (err) {
      console.error('Failed to copy:', err);
      // Show the link if all else fails
      toast.info(`رابط الدعوة: ${link}`, { duration: 10000 });
    }
  }

  function getStatusConfig(status: string) {
    switch (status) {
      case 'pending':
        return { icon: Clock, color: 'text-amber-400', bg: 'bg-amber-600/20', label: 'قيد الانتظار' };
      case 'accepted':
        return { icon: CheckCircle2, color: 'text-emerald-400', bg: 'bg-emerald-600/20', label: 'مقبولة' };
      case 'expired':
        return { icon: AlertCircle, color: 'text-slate-400', bg: 'bg-slate-600/20', label: 'منتهية' };
      case 'revoked':
        return { icon: XCircle, color: 'text-rose-400', bg: 'bg-rose-600/20', label: 'ملغاة' };
      default:
        return { icon: Clock, color: 'text-slate-400', bg: 'bg-slate-600/20', label: status };
    }
  }

  const filteredInvitations = invitations.filter(inv =>
    filter === 'all' || inv.status === filter
  );

  const pendingCount = invitations.filter(i => i.status === 'pending').length;

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
                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-amber-500 to-orange-600 flex items-center justify-center">
                  <Mail className="h-5 w-5 text-white" />
                </div>
                <div>
                  <h1 className="text-xl font-bold text-white">الدعوات</h1>
                  <p className="text-sm text-slate-400">{pendingCount} دعوة معلقة</p>
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
              <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
                <DialogTrigger asChild>
                  <Button className="bg-gradient-to-r from-teal-600 to-cyan-600 hover:from-teal-500 hover:to-cyan-500">
                    <UserPlus className="h-4 w-4 ml-2" />
                    دعوة جديدة
                  </Button>
                </DialogTrigger>
                <DialogContent className="bg-slate-900 border-slate-800 max-w-md">
                  <form onSubmit={handleCreateInvitation}>
                    <DialogHeader>
                      <DialogTitle className="text-white flex items-center gap-2">
                        <Send className="h-5 w-5 text-teal-400" />
                        دعوة مستخدم جديد
                      </DialogTitle>
                      <DialogDescription className="text-slate-400">
                        سيتم إرسال رابط دعوة للبريد المحدد
                      </DialogDescription>
                    </DialogHeader>

                    <div className="space-y-4 py-6">
                      {/* Email */}
                      <div className="space-y-2">
                        <Label className="text-slate-300">البريد الإلكتروني *</Label>
                        <Input
                          type="email"
                          placeholder="user@example.com"
                          value={formData.email}
                          onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                          className="bg-slate-950 border-slate-800 text-white"
                          dir="ltr"
                        />
                      </div>

                      {/* Roles */}
                      <div className="space-y-2">
                        <Label className="text-slate-300">الأدوار</Label>
                        <div className="space-y-2 max-h-[200px] overflow-y-auto pr-2">
                          {roles.map(role => (
                            <div
                              key={role.id}
                              className={`p-3 rounded-lg border transition-colors cursor-pointer ${
                                formData.role_ids.includes(role.id)
                                  ? 'border-teal-500 bg-teal-950/30'
                                  : 'border-slate-800 bg-slate-950/50 hover:border-slate-700'
                              }`}
                              onClick={() => {
                                if (formData.role_ids.includes(role.id)) {
                                  setFormData({
                                    ...formData,
                                    role_ids: formData.role_ids.filter(id => id !== role.id),
                                  });
                                } else {
                                  setFormData({
                                    ...formData,
                                    role_ids: [...formData.role_ids, role.id],
                                  });
                                }
                              }}
                            >
                              <div className="flex items-center gap-3">
                                <Checkbox
                                  checked={formData.role_ids.includes(role.id)}
                                  className="border-slate-600"
                                />
                                <span className="text-white text-sm">
                                  {role.name_ar || role.name}
                                </span>
                              </div>
                            </div>
                          ))}
                          {roles.length === 0 && (
                            <p className="text-slate-500 text-sm text-center py-4">
                              لا توجد أدوار متاحة
                            </p>
                          )}
                        </div>
                      </div>

                      {/* Message */}
                      <div className="space-y-2">
                        <Label className="text-slate-300">رسالة (اختياري)</Label>
                        <Textarea
                          placeholder="رسالة ترحيبية للمستخدم..."
                          value={formData.message}
                          onChange={(e) => setFormData({ ...formData, message: e.target.value })}
                          className="bg-slate-950 border-slate-800 text-white resize-none"
                          rows={3}
                        />
                      </div>
                    </div>

                    <DialogFooter className="gap-2">
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
                        disabled={creating}
                        className="bg-gradient-to-r from-teal-600 to-cyan-600"
                      >
                        {creating ? 'جاري الإرسال...' : 'إرسال الدعوة'}
                      </Button>
                    </DialogFooter>
                  </form>
                </DialogContent>
              </Dialog>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-8">
        {/* Filters */}
        <div className="flex items-center gap-2 mb-6">
          {(['all', 'pending', 'accepted', 'expired'] as const).map(f => (
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
              {f === 'all' ? 'الكل' :
               f === 'pending' ? 'قيد الانتظار' :
               f === 'accepted' ? 'مقبولة' : 'منتهية'}
            </Button>
          ))}
        </div>

        {/* Invitations List */}
        <Card className="bg-slate-900/50 border-slate-800">
          <CardContent className="p-0">
            {loading ? (
              <div className="p-6 space-y-4">
                {[1, 2, 3].map(i => (
                  <Skeleton key={i} className="h-20 w-full bg-slate-800" />
                ))}
              </div>
            ) : filteredInvitations.length === 0 ? (
              <div className="p-12 text-center">
                <Mail className="h-12 w-12 mx-auto text-slate-600 mb-4" />
                <h3 className="text-lg font-semibold text-white mb-2">لا توجد دعوات</h3>
                <p className="text-slate-400 mb-4">قم بإنشاء دعوة لمستخدم جديد</p>
                <Button
                  onClick={() => setDialogOpen(true)}
                  className="bg-gradient-to-r from-teal-600 to-cyan-600"
                >
                  <UserPlus className="h-4 w-4 ml-2" />
                  دعوة جديدة
                </Button>
              </div>
            ) : (
              <div className="divide-y divide-slate-800">
                {filteredInvitations.map(inv => {
                  const statusConfig = getStatusConfig(inv.status);
                  const StatusIcon = statusConfig.icon;
                  const isExpired = new Date(inv.expires_at) < new Date() && inv.status === 'pending';

                  return (
                    <div
                      key={inv.id}
                      className="p-4 hover:bg-slate-800/30 transition-colors"
                    >
                      <div className="flex items-start gap-4">
                        {/* Icon */}
                        <div className={`p-3 rounded-lg ${statusConfig.bg}`}>
                          <StatusIcon className={`h-5 w-5 ${statusConfig.color}`} />
                        </div>

                        {/* Info */}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <h3 className="font-semibold text-white" dir="ltr">
                              {inv.email}
                            </h3>
                            <Badge className={`${statusConfig.bg} ${statusConfig.color} border-0`}>
                              {isExpired ? 'منتهية' : statusConfig.label}
                            </Badge>
                          </div>

                          <div className="flex flex-wrap items-center gap-2 mt-2">
                            {(inv.roles || []).map(role => (
                              <Badge
                                key={role.id}
                                variant="outline"
                                className="border-slate-700 text-slate-300 text-xs"
                              >
                                {role.name_ar || role.name}
                              </Badge>
                            ))}
                          </div>

                          <p className="text-xs text-slate-500 mt-2">
                            أرسلت: {new Date(inv.invited_at).toLocaleDateString('ar-SA')}
                            {' • '}
                            تنتهي: {new Date(inv.expires_at).toLocaleDateString('ar-SA')}
                          </p>
                        </div>

                        {/* Actions */}
                        <div className="flex items-center gap-2">
                          {inv.status === 'pending' && !isExpired && (
                            <>
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => copyInviteLink(inv.token)}
                                className="text-slate-400 hover:text-white"
                                title="نسخ الرابط"
                              >
                                <Copy className="h-4 w-4" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => handleResend(inv.id)}
                                className="text-slate-400 hover:text-white"
                                title="إعادة الإرسال"
                              >
                                <RotateCcw className="h-4 w-4" />
                              </Button>
                              <AlertDialog>
                                <AlertDialogTrigger asChild>
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className="text-rose-400 hover:text-rose-300"
                                    title="إلغاء"
                                  >
                                    <Trash2 className="h-4 w-4" />
                                  </Button>
                                </AlertDialogTrigger>
                                <AlertDialogContent className="bg-slate-900 border-slate-800">
                                  <AlertDialogHeader>
                                    <AlertDialogTitle className="text-white">إلغاء الدعوة</AlertDialogTitle>
                                    <AlertDialogDescription className="text-slate-400">
                                      هل أنت متأكد من إلغاء الدعوة؟ لن يتمكن المستخدم من استخدام هذه الدعوة.
                                    </AlertDialogDescription>
                                  </AlertDialogHeader>
                                  <AlertDialogFooter className="gap-2">
                                    <AlertDialogCancel className="bg-slate-800 border-slate-700 text-slate-300">
                                      تراجع
                                    </AlertDialogCancel>
                                    <AlertDialogAction
                                      onClick={() => handleRevoke(inv.id)}
                                      className="bg-rose-600 hover:bg-rose-500"
                                    >
                                      إلغاء الدعوة
                                    </AlertDialogAction>
                                  </AlertDialogFooter>
                                </AlertDialogContent>
                              </AlertDialog>
                            </>
                          )}
                          {(inv.status === 'expired' || isExpired) && (
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => handleResend(inv.id)}
                              className="border-slate-700 text-slate-300 hover:text-white"
                            >
                              <RotateCcw className="h-4 w-4 ml-2" />
                              إعادة الإرسال
                            </Button>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </main>
    </div>
  );
}

