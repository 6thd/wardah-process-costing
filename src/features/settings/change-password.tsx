// src/features/settings/change-password.tsx
// صفحة تغيير كلمة المرور مع دعم HIBP validation

import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { getSupabase } from '@/lib/supabase';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Loader2, Lock, AlertCircle, CheckCircle2, ArrowRight } from 'lucide-react';
import { validatePassword, validatePasswordStrength } from '@/lib/auth/password-validator';

export function ChangePasswordPage() {
  const navigate = useNavigate();
  const [formData, setFormData] = useState({
    currentPassword: '',
    newPassword: '',
    confirmPassword: '',
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [passwordErrors, setPasswordErrors] = useState<string[]>([]);
  const [isCheckingPassword, setIsCheckingPassword] = useState(false);
  const [passwordCheckTimeout, setPasswordCheckTimeout] = useState<NodeJS.Timeout | null>(null);

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (passwordCheckTimeout) {
        clearTimeout(passwordCheckTimeout);
      }
    };
  }, [passwordCheckTimeout]);

  const handleInputChange = async (field: string, value: string) => {
    setFormData(prev => ({ ...prev, [field]: value }));
    setError('');
    setSuccess('');

    // Real-time password strength validation for new password
    if (field === 'newPassword') {
      // Clear previous timeout
      if (passwordCheckTimeout) {
        clearTimeout(passwordCheckTimeout);
      }

      // Immediate strength check
      const strengthCheck = validatePasswordStrength(value);
      setPasswordErrors(strengthCheck.errors);

      // Debounced HIBP check (only if strength check passes)
      if (strengthCheck.isValid && value.length > 0) {
        setIsCheckingPassword(true);
        
        const timeout = setTimeout(async () => {
          try {
            const fullValidation = await validatePassword(value);
            setPasswordErrors(fullValidation.errors);
          } catch (err) {
            console.error('Password validation error:', err);
          } finally {
            setIsCheckingPassword(false);
          }
        }, 800); // 800ms debounce

        setPasswordCheckTimeout(timeout);
      } else {
        setIsCheckingPassword(false);
      }
    }
  };

  const validateForm = async (): Promise<boolean> => {
    setError('');
    setSuccess('');

    // Check current password
    if (!formData.currentPassword) {
      setError('يرجى إدخال كلمة المرور الحالية');
      return false;
    }

    // Check new password
    if (!formData.newPassword) {
      setError('يرجى إدخال كلمة المرور الجديدة');
      return false;
    }

    // Validate new password strength and HIBP
    const validation = await validatePassword(formData.newPassword);
    if (!validation.isValid) {
      setPasswordErrors(validation.errors);
      setError('كلمة المرور الجديدة لا تلبي المتطلبات');
      return false;
    }

    // Check password match
    if (formData.newPassword !== formData.confirmPassword) {
      setError('كلمة المرور الجديدة وتأكيدها غير متطابقين');
      return false;
    }

    // Check if new password is different from current
    if (formData.currentPassword === formData.newPassword) {
      setError('كلمة المرور الجديدة يجب أن تكون مختلفة عن الحالية');
      return false;
    }

    return true;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccess('');
    setPasswordErrors([]);

    if (!(await validateForm())) {
      return;
    }

    setLoading(true);

    try {
      const supabase = getSupabase();

      // First, verify current password by attempting to sign in
      const { data: { user } } = await supabase.auth.getUser();
      if (!user || !user.email) {
        setError('لم يتم العثور على المستخدم الحالي');
        setLoading(false);
        return;
      }

      // Verify current password
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: user.email,
        password: formData.currentPassword,
      });

      if (signInError) {
        setError('كلمة المرور الحالية غير صحيحة');
        setLoading(false);
        return;
      }

      // Update password
      const { error: updateError } = await supabase.auth.updateUser({
        password: formData.newPassword,
      });

      if (updateError) {
        setError(updateError.message || 'فشل تحديث كلمة المرور');
        setLoading(false);
        return;
      }

      // Success
      setSuccess('تم تغيير كلمة المرور بنجاح');
      setFormData({
        currentPassword: '',
        newPassword: '',
        confirmPassword: '',
      });
      setPasswordErrors([]);

      // Redirect after 2 seconds
      setTimeout(() => {
        navigate('/settings');
      }, 2000);

    } catch (err: any) {
      console.error('Change password error:', err);
      setError(err.message || 'حدث خطأ أثناء تغيير كلمة المرور');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="container mx-auto py-8 max-w-2xl">
      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="p-2 bg-primary/10 rounded-lg">
              <Lock className="h-6 w-6 text-primary" />
            </div>
            <div>
              <CardTitle className="text-right">تغيير كلمة المرور</CardTitle>
              <CardDescription className="text-right">
                قم بتحديث كلمة المرور لحسابك لزيادة الأمان
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-6">
            {/* Current Password */}
            <div className="space-y-2">
              <label htmlFor="currentPassword" className="block text-sm font-medium text-right">
                كلمة المرور الحالية
              </label>
              <div className="relative">
                <Lock className="absolute right-3 top-3 h-5 w-5 text-muted-foreground" />
                <Input
                  id="currentPassword"
                  type="password"
                  value={formData.currentPassword}
                  onChange={(e) => handleInputChange('currentPassword', e.target.value)}
                  placeholder="••••••••"
                  required
                  disabled={loading}
                  className="text-right pr-10"
                  autoComplete="current-password"
                />
              </div>
            </div>

            {/* New Password */}
            <div className="space-y-2">
              <label htmlFor="newPassword" className="block text-sm font-medium text-right">
                كلمة المرور الجديدة
              </label>
              <div className="relative">
                <Lock className="absolute right-3 top-3 h-5 w-5 text-muted-foreground" />
                <Input
                  id="newPassword"
                  type="password"
                  value={formData.newPassword}
                  onChange={(e) => handleInputChange('newPassword', e.target.value)}
                  placeholder="••••••••"
                  required
                  disabled={loading}
                  className={`text-right pr-10 ${passwordErrors.length > 0 ? 'border-destructive' : ''}`}
                  autoComplete="new-password"
                />
                {isCheckingPassword && (
                  <div className="absolute left-3 top-3">
                    <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                  </div>
                )}
              </div>
              {passwordErrors.length > 0 && (
                <div className="space-y-1">
                  {passwordErrors.map((error, index) => (
                    <p key={index} className="text-xs text-destructive text-right">
                      {error}
                    </p>
                  ))}
                </div>
              )}
              {formData.newPassword.length > 0 && passwordErrors.length === 0 && !isCheckingPassword && (
                <p className="text-xs text-green-600 text-right">
                  ✓ كلمة المرور آمنة
                </p>
              )}
            </div>

            {/* Confirm Password */}
            <div className="space-y-2">
              <label htmlFor="confirmPassword" className="block text-sm font-medium text-right">
                تأكيد كلمة المرور الجديدة
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
              {formData.confirmPassword && formData.newPassword !== formData.confirmPassword && (
                <p className="text-xs text-destructive text-right">
                  كلمة المرور غير متطابقة
                </p>
              )}
              {formData.confirmPassword && formData.newPassword === formData.confirmPassword && formData.newPassword.length > 0 && (
                <p className="text-xs text-green-600 text-right">
                  ✓ كلمة المرور متطابقة
                </p>
              )}
            </div>

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

            {/* Password Requirements Info */}
            <div className="bg-muted/50 rounded-lg p-4 space-y-2">
              <p className="text-sm font-medium text-right">متطلبات كلمة المرور:</p>
              <ul className="text-xs text-muted-foreground space-y-1 text-right list-disc list-inside">
                <li>8 أحرف على الأقل</li>
                <li>حرف كبير واحد على الأقل (A-Z)</li>
                <li>حرف صغير واحد على الأقل (a-z)</li>
                <li>رقم واحد على الأقل (0-9)</li>
                <li>رمز خاص واحد على الأقل (!@#$%...)</li>
                <li>يتم التحقق من كلمة المرور ضد قاعدة بيانات الخروقات الأمنية</li>
              </ul>
            </div>

            {/* Submit Button */}
            <div className="flex gap-3 justify-end">
              <Button
                type="button"
                variant="outline"
                onClick={() => navigate('/settings')}
                disabled={loading}
              >
                إلغاء
              </Button>
              <Button
                type="submit"
                disabled={loading || passwordErrors.length > 0}
                className="min-w-[120px]"
              >
                {loading ? (
                  <>
                    <Loader2 className="ml-2 h-4 w-4 animate-spin" />
                    جارٍ التحديث...
                  </>
                ) : (
                  <>
                    <ArrowRight className="ml-2 h-4 w-4" />
                    تحديث كلمة المرور
                  </>
                )}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

