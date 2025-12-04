// src/pages/signup.tsx
// صفحة تسجيل حساب جديد مع دعم Multi-Tenant والدعوات

import { useState, useEffect, useCallback } from 'react';
import { useNavigate, Link, useSearchParams } from 'react-router-dom';
import { getSupabase } from '@/lib/supabase';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Loader2, UserPlus, AlertCircle, Building2, Mail, Lock, User, CheckCircle2, MailOpen } from 'lucide-react';
import { getOrganizationByCode, addUserToOrganization } from '@/services/organization-service';
import { acceptInvitation } from '@/services/org-admin-service';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';

interface InvitationData {
  id: string;
  email: string;
  org_id: string;
  org_name?: string;
  status: string;
  expires_at: string;
}

export function SignUpPage() {
  const [searchParams] = useSearchParams();
  const inviteToken = searchParams.get('invite');
  
  const [mode, setMode] = useState<'join' | 'create' | 'invite'>('join');
  const [formData, setFormData] = useState({
    fullName: '',
    email: '',
    password: '',
    confirmPassword: '',
    orgCode: '',
    newOrgName: '',
    newOrgNameAr: '',
    newOrgCode: '',
  });
  const [loading, setLoading] = useState(false);
  const [loadingInvite, setLoadingInvite] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [invitation, setInvitation] = useState<InvitationData | null>(null);
  const navigate = useNavigate();

  // Wrap loadInvitation in useCallback to stabilize the reference
  const loadInvitation = useCallback(async (token: string) => {
    setLoadingInvite(true);
    setError('');
    
    try {
      const supabase = getSupabase();
      
      const { data, error } = await supabase
        .from('invitations')
        .select(`
          id,
          email,
          org_id,
          status,
          expires_at,
          organization:organizations(name, name_ar)
        `)
        .eq('token', token)
        .single();

      if (error || !data) {
        setError('رابط الدعوة غير صالح أو منتهي الصلاحية');
        setLoadingInvite(false);
        return;
      }

      if (data.status !== 'pending') {
        setError('هذه الدعوة تم استخدامها بالفعل أو ملغاة');
        setLoadingInvite(false);
        return;
      }

      if (new Date(data.expires_at) < new Date()) {
        setError('انتهت صلاحية هذه الدعوة');
        setLoadingInvite(false);
        return;
      }

      setInvitation({
        id: data.id,
        email: data.email,
        org_id: data.org_id,
        org_name: (data.organization as any)?.name_ar || (data.organization as any)?.name,
        status: data.status,
        expires_at: data.expires_at,
      });
      
      setFormData(prev => ({ ...prev, email: data.email }));
      setMode('invite');
    } catch (err) {
      console.error('Error loading invitation:', err);
      setError('فشل تحميل بيانات الدعوة');
    } finally {
      setLoadingInvite(false);
    }
  }, []);

  // Load invitation data if token exists
  useEffect(() => {
    let isMounted = true;

    if (inviteToken && isMounted) {
      loadInvitation(inviteToken);
    } else {
      // Clear loading state if no token
      setLoadingInvite(false);
    }

    // Cleanup function to prevent state updates after unmount
    return () => {
      isMounted = false;
    };
  }, [inviteToken, loadInvitation]);

  const handleInputChange = (field: string, value: string) => {
    setFormData(prev => ({ ...prev, [field]: value }));
    setError('');
  };

  const validateForm = (): string | null => {
    const { fullName, email, password, confirmPassword, orgCode, newOrgName, newOrgCode } = formData;

    if (!fullName.trim()) return 'يرجى إدخال الاسم الكامل';
    if (!email.trim()) return 'يرجى إدخال البريد الإلكتروني';
    if (!email.includes('@')) return 'البريد الإلكتروني غير صحيح';
    if (password.length < 6) return 'كلمة المرور يجب أن تكون 6 أحرف على الأقل';
    if (password !== confirmPassword) return 'كلمتا المرور غير متطابقتين';

    if (mode === 'join') {
      if (!orgCode.trim()) return 'يرجى إدخال رمز المنظمة';
    } else if (mode === 'create') {
      if (!newOrgName.trim()) return 'يرجى إدخال اسم المنظمة';
      if (!newOrgCode.trim()) return 'يرجى إدخال رمز المنظمة';
      if (newOrgCode.length < 3) return 'رمز المنظمة يجب أن يكون 3 أحرف على الأقل';
    }
    // mode === 'invite' doesn't need org code

    return null;
  };

  const handleSignUp = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccess('');

    // Validate form
    const validationError = validateForm();
    if (validationError) {
      setError(validationError);
      return;
    }

    setLoading(true);

    try {
      const supabase = getSupabase();

      if (mode === 'invite' && invitation && inviteToken) {
        // Mode: Join via invitation
        // Verify email matches invitation
        if (formData.email.trim().toLowerCase() !== invitation.email.toLowerCase()) {
          setError(`البريد الإلكتروني يجب أن يكون ${invitation.email}`);
          setLoading(false);
          return;
        }

        const { data: authData, error: signUpError } = await supabase.auth.signUp({
          email: formData.email.trim(),
          password: formData.password,
          options: {
            data: {
              full_name: formData.fullName.trim(),
            },
          },
        });

        if (signUpError) throw signUpError;

        if (authData.user) {
          // Accept invitation (adds user to org with assigned roles)
          const result = await acceptInvitation(inviteToken, authData.user.id);
          
          if (!result.success) {
            throw new Error(result.error || 'فشل قبول الدعوة');
          }

          setSuccess(`✅ تم التسجيل بنجاح! مرحباً بك في ${invitation.org_name}`);
          setTimeout(() => navigate('/login'), 3000);
        }
      } else if (mode === 'join') {
        // Mode 1: Join existing organization by code
        const org = await getOrganizationByCode(formData.orgCode);
        if (!org) {
          setError('رمز المنظمة غير صحيح أو المنظمة غير نشطة');
          setLoading(false);
          return;
        }

        // Create user account
        const { data: authData, error: signUpError } = await supabase.auth.signUp({
          email: formData.email.trim(),
          password: formData.password,
          options: {
            data: {
              full_name: formData.fullName.trim(),
            },
          },
        });

        if (signUpError) throw signUpError;

        if (authData.user) {
          // Add user to organization
          const result = await addUserToOrganization({
            userId: authData.user.id,
            orgId: org.id,
            role: 'user',
          });

          if (!result.success) {
            throw new Error(result.error || 'فشل إضافة المستخدم للمنظمة');
          }

          setSuccess('✅ تم التسجيل بنجاح! يرجى تأكيد بريدك الإلكتروني للمتابعة');
          setTimeout(() => navigate('/login'), 3000);
        }
      } else {
        // Mode 2: Create new organization
        const supabase = getSupabase();

        // Create user account first
        const { data: authData, error: signUpError } = await supabase.auth.signUp({
          email: formData.email.trim(),
          password: formData.password,
          options: {
            data: {
              full_name: formData.fullName.trim(),
            },
          },
        });

        if (signUpError) throw signUpError;

        if (authData.user) {
          // Create organization (the service will automatically add user as admin)
          const { data: orgData, error: orgError } = await supabase
            .from('organizations')
            .insert({
              name: formData.newOrgName.trim(),
              name_ar: formData.newOrgNameAr.trim() || formData.newOrgName.trim(),
              code: formData.newOrgCode.trim().toUpperCase(),
              is_active: true,
            })
            .select()
            .single();

          if (orgError) throw orgError;

          // Add user as admin
          const { error: userOrgError } = await supabase
            .from('user_organizations')
            .insert({
              user_id: authData.user.id,
              org_id: orgData.id,
              role: 'admin',
              is_active: true,
            });

          if (userOrgError) throw userOrgError;

          setSuccess('✅ تم إنشاء المنظمة والحساب بنجاح! يرجى تأكيد بريدك الإلكتروني');
          setTimeout(() => navigate('/login'), 3000);
        }
      }
    } catch (err: any) {
      console.error('Error during sign up:', err);

      let errorMessage = 'فشل التسجيل. يرجى المحاولة مرة أخرى.';

      if (err.message?.includes('already registered')) {
        errorMessage = 'البريد الإلكتروني مسجل بالفعل';
      } else if (err.message?.includes('duplicate key')) {
        errorMessage = 'رمز المنظمة مستخدم بالفعل';
      } else if (err.message) {
        errorMessage = err.message;
      }

      setError(errorMessage);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex items-center justify-center min-h-screen bg-gradient-to-br from-background to-muted p-4">
      <Card className="w-full max-w-2xl shadow-2xl">
        <CardHeader className="space-y-1 text-center">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-primary/10">
            <UserPlus className="h-8 w-8 text-primary" />
          </div>
          <CardTitle className="text-3xl font-bold">
            إنشاء حساب جديد
          </CardTitle>
          <CardDescription className="text-base">
            انضم إلى نظام وردة ERP الآن
          </CardDescription>
        </CardHeader>

        <CardContent>
          {/* Show invitation info if available */}
          {loadingInvite ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
              <span className="mr-3">جاري تحميل بيانات الدعوة...</span>
            </div>
          ) : invitation ? (
            <div className="mb-6 p-4 rounded-lg bg-primary/10 border border-primary/20">
              <div className="flex items-center gap-3 mb-2">
                <MailOpen className="h-5 w-5 text-primary" />
                <span className="font-semibold text-primary">دعوة للانضمام</span>
              </div>
              <p className="text-sm text-muted-foreground">
                تمت دعوتك للانضمام إلى منظمة{' '}
                <Badge variant="secondary" className="mx-1">{invitation.org_name}</Badge>
              </p>
              <p className="text-xs text-muted-foreground mt-2">
                البريد: <span dir="ltr" className="font-mono">{invitation.email}</span>
              </p>
            </div>
          ) : (
            <Tabs value={mode} onValueChange={(v) => setMode(v as 'join' | 'create')} className="mb-6">
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="join" className="gap-2">
                  <Building2 className="h-4 w-4" />
                  الانضمام لمنظمة
                </TabsTrigger>
                <TabsTrigger value="create" className="gap-2">
                  <Building2 className="h-4 w-4" />
                  إنشاء منظمة جديدة
                </TabsTrigger>
              </TabsList>
            </Tabs>
          )}

          <form onSubmit={handleSignUp} className="space-y-5">
            {/* Common Fields */}
            <div className="space-y-4">
              <div className="space-y-2">
                <label htmlFor="fullName" className="block text-sm font-medium">
                  الاسم الكامل
                </label>
                <div className="relative">
                  <User className="absolute right-3 top-3 h-5 w-5 text-muted-foreground" />
                  <Input
                    id="fullName"
                    type="text"
                    value={formData.fullName}
                    onChange={(e) => handleInputChange('fullName', e.target.value)}
                    placeholder="أحمد محمد"
                    required
                    disabled={loading}
                    className="text-right pr-10"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <label htmlFor="email" className="block text-sm font-medium">
                  البريد الإلكتروني
                </label>
                <div className="relative">
                  <Mail className="absolute right-3 top-3 h-5 w-5 text-muted-foreground" />
                  <Input
                    id="email"
                    type="email"
                    value={formData.email}
                    onChange={(e) => handleInputChange('email', e.target.value)}
                    placeholder="ahmad@example.com"
                    required
                    disabled={loading || mode === 'invite'}
                    className="text-right pr-10"
                    autoComplete="email"
                  />
                </div>
                {mode === 'invite' && (
                  <p className="text-xs text-muted-foreground text-right">
                    البريد مرتبط بالدعوة ولا يمكن تغييره
                  </p>
                )}
              </div>

              <div className="space-y-2">
                <label htmlFor="password" className="block text-sm font-medium">
                  كلمة المرور
                </label>
                <div className="relative">
                  <Lock className="absolute right-3 top-3 h-5 w-5 text-muted-foreground" />
                  <Input
                    id="password"
                    type="password"
                    value={formData.password}
                    onChange={(e) => handleInputChange('password', e.target.value)}
                    placeholder="••••••••"
                    required
                    disabled={loading}
                    className="text-right pr-10"
                    autoComplete="new-password"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <label htmlFor="confirmPassword" className="block text-sm font-medium">
                  تأكيد كلمة المرور
                </label>
                <div className="relative">
                  <Lock className="absolute right-3 top-3 h-5 w-5 text-muted-foreground" />
                  <Input
                    id="confirmPassword"
                    type="password"
                    value={formData.confirmPassword}
                    onChange={(e) => handleInputChange('confirmPassword', e.target.value)}
                    placeholder="••••••••"
                    required
                    disabled={loading}
                    className="text-right pr-10"
                    autoComplete="new-password"
                  />
                </div>
              </div>
            </div>

            {/* Mode-specific fields */}
            {mode === 'invite' ? (
              // Invitation mode - no org code needed
              null
            ) : mode === 'join' ? (
              <div className="space-y-2">
                <label htmlFor="orgCode" className="block text-sm font-medium">
                  رمز المنظمة
                </label>
                <div className="relative">
                  <Building2 className="absolute right-3 top-3 h-5 w-5 text-muted-foreground" />
                  <Input
                    id="orgCode"
                    type="text"
                    value={formData.orgCode}
                    onChange={(e) => handleInputChange('orgCode', e.target.value.toUpperCase())}
                    placeholder="WARDAH"
                    required
                    disabled={loading}
                    className="text-right pr-10 uppercase"
                  />
                </div>
                <p className="text-xs text-muted-foreground text-right">
                  اطلب رمز المنظمة من المسؤول
                </p>
              </div>
            ) : (
              <div className="space-y-4 border-t pt-4">
                <p className="text-sm font-medium text-muted-foreground">معلومات المنظمة الجديدة</p>
                
                <div className="space-y-2">
                  <label htmlFor="newOrgName" className="block text-sm font-medium">
                    اسم المنظمة (English)
                  </label>
                  <Input
                    id="newOrgName"
                    type="text"
                    value={formData.newOrgName}
                    onChange={(e) => handleInputChange('newOrgName', e.target.value)}
                    placeholder="Wardah Manufacturing"
                    required
                    disabled={loading}
                    className="text-right"
                  />
                </div>

                <div className="space-y-2">
                  <label htmlFor="newOrgNameAr" className="block text-sm font-medium">
                    اسم المنظمة (بالعربية)
                  </label>
                  <Input
                    id="newOrgNameAr"
                    type="text"
                    value={formData.newOrgNameAr}
                    onChange={(e) => handleInputChange('newOrgNameAr', e.target.value)}
                    placeholder="شركة وردة للتصنيع"
                    disabled={loading}
                    className="text-right"
                  />
                </div>

                <div className="space-y-2">
                  <label htmlFor="newOrgCode" className="block text-sm font-medium">
                    رمز المنظمة (CODE)
                  </label>
                  <Input
                    id="newOrgCode"
                    type="text"
                    value={formData.newOrgCode}
                    onChange={(e) => handleInputChange('newOrgCode', e.target.value.toUpperCase())}
                    placeholder="WARDAH"
                    required
                    disabled={loading}
                    className="text-right uppercase"
                  />
                  <p className="text-xs text-muted-foreground text-right">
                    رمز فريد للمنظمة (3-10 أحرف، بالإنجليزية فقط)
                  </p>
                </div>
              </div>
            )}

            {/* Success Message */}
            {success && (
              <Alert className="bg-green-50 text-green-900 border-green-200">
                <CheckCircle2 className="h-4 w-4" />
                <AlertDescription className="text-right">
                  {success}
                </AlertDescription>
              </Alert>
            )}

            {/* Error Message */}
            {error && (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription className="text-right">
                  {error}
                </AlertDescription>
              </Alert>
            )}

            {/* Submit Button */}
            <Button 
              type="submit" 
              className="w-full text-lg py-6" 
              disabled={loading}
            >
              {loading ? (
                <>
                  <Loader2 className="ml-2 h-5 w-5 animate-spin" />
                  جارٍ التسجيل...
                </>
              ) : (
                <>
                  <UserPlus className="ml-2 h-5 w-5" />
                  إنشاء الحساب
                </>
              )}
            </Button>
          </form>

          {/* Login Link */}
          <div className="mt-6 text-center">
            <p className="text-sm text-muted-foreground">
              لديك حساب بالفعل؟{' '}
              <Link to="/login" className="font-medium text-primary hover:underline">
                تسجيل الدخول
              </Link>
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
