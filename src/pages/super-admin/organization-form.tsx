// src/pages/super-admin/organization-form.tsx
// بسم الله الرحمن الرحيم
// نموذج إنشاء/تعديل منظمة

import { useEffect, useState } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Switch } from '@/components/ui/switch';
import {
  Building2,
  ArrowLeft,
  Save,
  Loader2,
  User,
  Mail,
  Lock,
  Globe,
  CreditCard,
  Settings,
} from 'lucide-react';
import {
  createOrganization,
  updateOrganization,
  getOrganizationById,
  CreateOrganizationInput,
  Organization,
} from '@/services/super-admin-service';
import { toast } from 'sonner';
import { VALIDATION_MESSAGES } from '@/constants/validationMessages';
import { Skeleton } from '@/components/ui/skeleton';

// =====================================
// Form State
// =====================================

interface FormState {
  // Organization Info
  name: string;
  name_ar: string;
  code: string;
  plan_type: 'trial' | 'basic' | 'pro' | 'enterprise';
  max_users: number;
  industry: string;
  country: string;
  currency: string;
  timezone: string;
  tax_id: string;
  is_active: boolean;

  // Admin Info (for new org)
  admin_name: string;
  admin_email: string;
  admin_password: string;
  admin_password_confirm: string;
}

const initialState: FormState = {
  name: '',
  name_ar: '',
  code: '',
  plan_type: 'trial',
  max_users: 5,
  industry: '',
  country: 'SA',
  currency: 'SAR',
  timezone: 'Asia/Riyadh',
  tax_id: '',
  is_active: true,
  admin_name: '',
  admin_email: '',
  admin_password: '',
  admin_password_confirm: '',
};

// =====================================
// Constants
// =====================================

const PLANS = [
  { value: 'trial', label: 'تجريبي (14 يوم)', maxUsers: 5 },
  { value: 'basic', label: 'أساسي', maxUsers: 20 },
  { value: 'pro', label: 'احترافي', maxUsers: 100 },
  { value: 'enterprise', label: 'مؤسسي', maxUsers: 999 },
];

const COUNTRIES = [
  { value: 'SA', label: 'السعودية' },
  { value: 'AE', label: 'الإمارات' },
  { value: 'KW', label: 'الكويت' },
  { value: 'QA', label: 'قطر' },
  { value: 'BH', label: 'البحرين' },
  { value: 'OM', label: 'عمان' },
  { value: 'EG', label: 'مصر' },
  { value: 'JO', label: 'الأردن' },
];

const CURRENCIES = [
  { value: 'SAR', label: 'ريال سعودي (SAR)' },
  { value: 'AED', label: 'درهم إماراتي (AED)' },
  { value: 'KWD', label: 'دينار كويتي (KWD)' },
  { value: 'QAR', label: 'ريال قطري (QAR)' },
  { value: 'USD', label: 'دولار أمريكي (USD)' },
  { value: 'EUR', label: 'يورو (EUR)' },
];

const INDUSTRIES = [
  { value: 'manufacturing', label: 'التصنيع' },
  { value: 'retail', label: 'التجزئة' },
  { value: 'services', label: 'الخدمات' },
  { value: 'construction', label: 'البناء والتشييد' },
  { value: 'food', label: 'الأغذية والمشروبات' },
  { value: 'healthcare', label: 'الرعاية الصحية' },
  { value: 'education', label: 'التعليم' },
  { value: 'technology', label: 'التقنية' },
  { value: 'other', label: 'أخرى' },
];

// =====================================
// Organization Form
// =====================================

export function OrganizationForm() {
  const { id } = useParams();
  const navigate = useNavigate();
  const isEdit = !!id;

  const [form, setForm] = useState<FormState>(initialState);
  const [loading, setLoading] = useState(false);
  const [pageLoading, setPageLoading] = useState(isEdit);
  const [errors, setErrors] = useState<Partial<Record<keyof FormState, string>>>({});

  // Load organization for edit
  useEffect(() => {
    if (isEdit && id) {
      const loadOrg = async () => {
        const org = await getOrganizationById(id);
        if (org) {
          setForm({
            ...initialState,
            name: org.name,
            name_ar: org.name_ar || '',
            code: org.code,
            plan_type: org.plan_type,
            max_users: org.max_users,
            industry: org.industry || '',
            country: org.country,
            currency: org.currency,
            timezone: org.timezone,
            tax_id: org.tax_id || '',
            is_active: org.is_active,
          });
        } else {
          toast.error('المنظمة غير موجودة');
          navigate('/super-admin/organizations');
        }
        setPageLoading(false);
      };
      loadOrg();
    }
  }, [id, isEdit, navigate]);

  // Handle input change
  const handleChange = (field: keyof FormState, value: any) => {
    setForm((prev) => ({ ...prev, [field]: value }));
    setErrors((prev) => ({ ...prev, [field]: undefined }));
  };

  // Auto-generate code from name
  const handleNameChange = (value: string) => {
    handleChange('name', value);
    if (!isEdit && !form.code) {
      const code = value
        .toUpperCase()
        // NOSONAR S6653 - replaceAll cannot be used with regex patterns, regex is required for pattern matching
        .replace(/[^A-Z0-9]/g, '')
        .slice(0, 10);
      handleChange('code', code);
    }
  };

  // Validate form
  const validate = (): boolean => {
    const newErrors: Partial<Record<keyof FormState, string>> = {};

    if (!form.name.trim()) {
      newErrors.name = 'اسم المنظمة مطلوب';
    }

    if (!form.code.trim()) {
      newErrors.code = 'رمز المنظمة مطلوب';
    } else if (form.code.length < 3) {
      newErrors.code = 'الرمز يجب أن يكون 3 أحرف على الأقل';
    }

    if (!isEdit) {
      if (!form.admin_name.trim()) {
        newErrors.admin_name = 'اسم المدير مطلوب';
      }

      if (!form.admin_email.trim()) {
        newErrors.admin_email = VALIDATION_MESSAGES.EMAIL_REQUIRED;
      } else if (!form.admin_email.includes('@')) {
        newErrors.admin_email = VALIDATION_MESSAGES.EMAIL_INVALID_FORMAT;
      }

      if (!form.admin_password) {
        newErrors.admin_password = VALIDATION_MESSAGES.PASSWORD_REQUIRED;
      } else if (form.admin_password.length < 6) {
        newErrors.admin_password = VALIDATION_MESSAGES.PASSWORD_TOO_SHORT;
      }

      if (form.admin_password !== form.admin_password_confirm) {
        newErrors.admin_password_confirm = VALIDATION_MESSAGES.PASSWORD_MISMATCH;
      }
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  // Handle submit
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!validate()) {
      toast.error('يرجى تصحيح الأخطاء');
      return;
    }

    setLoading(true);

    try {
      if (isEdit) {
        // Update organization
        const result = await updateOrganization({
          id: id!,
          name: form.name,
          name_ar: form.name_ar,
          plan_type: form.plan_type,
          max_users: form.max_users,
          industry: form.industry,
          country: form.country,
          currency: form.currency,
          timezone: form.timezone,
          tax_id: form.tax_id,
          is_active: form.is_active,
        });

        if (result.success) {
          toast.success('تم تحديث المنظمة بنجاح');
          navigate('/super-admin/organizations');
        } else {
          toast.error(result.error || 'فشل تحديث المنظمة');
        }
      } else {
        // Create organization
        const result = await createOrganization({
          name: form.name,
          name_ar: form.name_ar,
          code: form.code.toUpperCase(),
          plan_type: form.plan_type,
          max_users: form.max_users,
          industry: form.industry,
          country: form.country,
          currency: form.currency,
          admin_name: form.admin_name,
          admin_email: form.admin_email,
          admin_password: form.admin_password,
        });

        if (result.success) {
          toast.success('تم إنشاء المنظمة بنجاح');
          navigate('/super-admin/organizations');
        } else {
          toast.error(result.error || 'فشل إنشاء المنظمة');
        }
      }
    } catch (error: any) {
      toast.error(error.message || 'حدث خطأ');
    } finally {
      setLoading(false);
    }
  };

  if (pageLoading) {
    return (
      <div className="p-6 space-y-6">
        <Skeleton className="h-10 w-64" />
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Skeleton className="h-96" />
          <Skeleton className="h-96" />
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Link to="/super-admin/organizations">
          <Button variant="ghost" size="icon">
            <ArrowLeft className="h-5 w-5" />
          </Button>
        </Link>
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-3">
            <Building2 className="h-8 w-8 text-primary" />
            {isEdit ? 'تعديل المنظمة' : 'إنشاء منظمة جديدة'}
          </h1>
          <p className="text-muted-foreground">
            {isEdit ? 'تعديل بيانات المنظمة' : 'أدخل بيانات المنظمة الجديدة ومديرها'}
          </p>
        </div>
      </div>

      <form onSubmit={handleSubmit}>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Organization Info */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Building2 className="h-5 w-5" />
                معلومات المنظمة
              </CardTitle>
              <CardDescription>البيانات الأساسية للمنظمة</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="name">اسم المنظمة (English) *</Label>
                  <Input
                    id="name"
                    value={form.name}
                    onChange={(e) => handleNameChange(e.target.value)}
                    placeholder="Wardah Manufacturing"
                    className={errors.name ? 'border-destructive' : ''}
                  />
                  {errors.name && (
                    <p className="text-xs text-destructive">{errors.name}</p>
                  )}
                </div>

                <div className="space-y-2">
                  <Label htmlFor="name_ar">اسم المنظمة (العربية)</Label>
                  <Input
                    id="name_ar"
                    value={form.name_ar}
                    onChange={(e) => handleChange('name_ar', e.target.value)}
                    placeholder="شركة وردة للتصنيع"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="code">رمز المنظمة *</Label>
                <Input
                  id="code"
                  value={form.code}
                  onChange={(e) => handleChange('code', e.target.value.toUpperCase())}
                  placeholder="WARDAH"
                  disabled={isEdit}
                  className={`uppercase ${errors.code ? 'border-destructive' : ''}`}
                />
                {errors.code && (
                  <p className="text-xs text-destructive">{errors.code}</p>
                )}
                <p className="text-xs text-muted-foreground">
                  رمز فريد للمنظمة (3-10 أحرف)
                </p>
              </div>

              <Separator />

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>الخطة</Label>
                  <Select
                    value={form.plan_type}
                    onValueChange={(v: any) => handleChange('plan_type', v)}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {PLANS.map((plan) => (
                        <SelectItem key={plan.value} value={plan.value}>
                          {plan.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="max_users">الحد الأقصى للمستخدمين</Label>
                  <Input
                    id="max_users"
                    type="number"
                    min={1}
                    value={form.max_users}
                    onChange={(e) => handleChange('max_users', Number.parseInt(e.target.value, 10) || 5)}
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label>القطاع</Label>
                <Select
                  value={form.industry}
                  onValueChange={(v) => handleChange('industry', v)}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="اختر القطاع" />
                  </SelectTrigger>
                  <SelectContent>
                    {INDUSTRIES.map((ind) => (
                      <SelectItem key={ind.value} value={ind.value}>
                        {ind.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <Separator />

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>الدولة</Label>
                  <Select
                    value={form.country}
                    onValueChange={(v) => handleChange('country', v)}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {COUNTRIES.map((c) => (
                        <SelectItem key={c.value} value={c.value}>
                          {c.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label>العملة</Label>
                  <Select
                    value={form.currency}
                    onValueChange={(v) => handleChange('currency', v)}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {CURRENCIES.map((c) => (
                        <SelectItem key={c.value} value={c.value}>
                          {c.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="tax_id">الرقم الضريبي</Label>
                <Input
                  id="tax_id"
                  value={form.tax_id}
                  onChange={(e) => handleChange('tax_id', e.target.value)}
                  placeholder="300000000000003"
                />
              </div>

              {isEdit && (
                <div className="flex items-center justify-between p-4 bg-muted rounded-lg">
                  <div>
                    <Label>حالة المنظمة</Label>
                    <p className="text-xs text-muted-foreground">
                      {form.is_active ? 'المنظمة نشطة' : 'المنظمة موقفة'}
                    </p>
                  </div>
                  <Switch
                    checked={form.is_active}
                    onCheckedChange={(v) => handleChange('is_active', v)}
                  />
                </div>
              )}
            </CardContent>
          </Card>

          {/* Admin Info (only for new) */}
          {!isEdit && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <User className="h-5 w-5" />
                  معلومات مدير المنظمة
                </CardTitle>
                <CardDescription>
                  سيتم إنشاء حساب المدير تلقائياً مع صلاحيات كاملة
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="admin_name">اسم المدير *</Label>
                  <div className="relative">
                    <User className="absolute right-3 top-3 h-4 w-4 text-muted-foreground" />
                    <Input
                      id="admin_name"
                      value={form.admin_name}
                      onChange={(e) => handleChange('admin_name', e.target.value)}
                      placeholder="أحمد محمد"
                      className={`pr-10 ${errors.admin_name ? 'border-destructive' : ''}`}
                    />
                  </div>
                  {errors.admin_name && (
                    <p className="text-xs text-destructive">{errors.admin_name}</p>
                  )}
                </div>

                <div className="space-y-2">
                  <Label htmlFor="admin_email">البريد الإلكتروني *</Label>
                  <div className="relative">
                    <Mail className="absolute right-3 top-3 h-4 w-4 text-muted-foreground" />
                    <Input
                      id="admin_email"
                      type="email"
                      value={form.admin_email}
                      onChange={(e) => handleChange('admin_email', e.target.value)}
                      placeholder="admin@company.com"
                      className={`pr-10 ${errors.admin_email ? 'border-destructive' : ''}`}
                    />
                  </div>
                  {errors.admin_email && (
                    <p className="text-xs text-destructive">{errors.admin_email}</p>
                  )}
                </div>

                <Separator />

                <div className="space-y-2">
                  <Label htmlFor="admin_password">كلمة المرور *</Label>
                  <div className="relative">
                    <Lock className="absolute right-3 top-3 h-4 w-4 text-muted-foreground" />
                    <Input
                      id="admin_password"
                      type="password"
                      value={form.admin_password}
                      onChange={(e) => handleChange('admin_password', e.target.value)}
                      placeholder="••••••••"
                      className={`pr-10 ${errors.admin_password ? 'border-destructive' : ''}`}
                    />
                  </div>
                  {errors.admin_password && (
                    <p className="text-xs text-destructive">{errors.admin_password}</p>
                  )}
                </div>

                <div className="space-y-2">
                  <Label htmlFor="admin_password_confirm">تأكيد كلمة المرور *</Label>
                  <div className="relative">
                    <Lock className="absolute right-3 top-3 h-4 w-4 text-muted-foreground" />
                    <Input
                      id="admin_password_confirm"
                      type="password"
                      value={form.admin_password_confirm}
                      onChange={(e) => handleChange('admin_password_confirm', e.target.value)}
                      placeholder="••••••••"
                      className={`pr-10 ${errors.admin_password_confirm ? 'border-destructive' : ''}`}
                    />
                  </div>
                  {errors.admin_password_confirm && (
                    <p className="text-xs text-destructive">{errors.admin_password_confirm}</p>
                  )}
                </div>

                <div className="p-4 bg-blue-50 dark:bg-blue-900/20 rounded-lg">
                  <p className="text-sm text-blue-700 dark:text-blue-300">
                    💡 سيتم إرسال بيانات الدخول للمدير على بريده الإلكتروني
                  </p>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Edit mode - placeholder for future features */}
          {isEdit && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Settings className="h-5 w-5" />
                  إعدادات إضافية
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-center py-8 text-muted-foreground">
                  <Settings className="h-12 w-12 mx-auto mb-4 opacity-50" />
                  <p>إعدادات متقدمة قريباً...</p>
                </div>
              </CardContent>
            </Card>
          )}
        </div>

        {/* Submit Button */}
        <div className="flex justify-end gap-4 mt-6">
          <Link to="/super-admin/organizations">
            <Button type="button" variant="outline">
              إلغاء
            </Button>
          </Link>
          <Button type="submit" disabled={loading} className="gap-2">
            {loading ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                جارٍ الحفظ...
              </>
            ) : (
              <>
                <Save className="h-4 w-4" />
                {isEdit ? 'حفظ التغييرات' : 'إنشاء المنظمة'}
              </>
            )}
          </Button>
        </div>
      </form>
    </div>
  );
}

export default OrganizationForm;

