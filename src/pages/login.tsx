// src/pages/login.tsx
// تم إنشاؤه: 28 أكتوبر 2025
// الهدف: صفحة تسجيل الدخول للنظام

import { useState, useEffect } from 'react';
import { useNavigate, useLocation, Link } from 'react-router-dom';
import { getSupabase } from '@/lib/supabase';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Loader2, LogIn, AlertCircle } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';

export function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useAuth();
  
  // معالجة رابط استعادة كلمة المرور من البريد الإلكتروني
  useEffect(() => {
    const handleRecovery = async () => {
      const hash = window.location.hash;
      if (hash && hash.includes('type=recovery')) {
        setLoading(true);
        setMessage('جارٍ تسجيل الدخول...');
        
        try {
          const supabase = getSupabase();
          const { data, error } = await supabase.auth.getSession();
          
          if (error) throw error;
          
          if (data.session) {
            setMessage('✅ تم تسجيل الدخول بنجاح! جارٍ التوجيه...');
            setTimeout(() => {
              navigate('/dashboard', { replace: true });
            }, 1000);
          }
        } catch (err: any) {
          console.error('خطأ في معالجة رابط الاستعادة:', err);
          setError('خطأ في معالجة رابط الاستعادة. يرجى المحاولة مرة أخرى.');
        } finally {
          setLoading(false);
        }
      }
    };
    
    handleRecovery();
  }, [navigate]);
  
  // إذا كان المستخدم مسجل دخول مسبقاً، إعادة توجيه للصفحة الرئيسية
  useEffect(() => {
    if (user) {
      const from = (location.state as any)?.from?.pathname || '/dashboard';
      navigate(from, { replace: true });
    }
  }, [user, navigate, location]);
  
  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    
    try {
      const supabase = getSupabase();
      const { data, error } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password
      });
      
      if (error) {
        throw error;
      }
      
      if (data.user) {
        // تسجيل الدخول ناجح، AuthContext سيتولى التحديث
        console.log('✅ تسجيل دخول ناجح:', data.user.email);
        
        // الانتقال للصفحة المطلوبة أو الرئيسية
        const from = (location.state as any)?.from?.pathname || '/dashboard';
        navigate(from, { replace: true });
      }
    } catch (err: any) {
      console.error('❌ خطأ في تسجيل الدخول:', err);
      
      // رسائل خطأ مخصصة
      let errorMessage = 'فشل تسجيل الدخول. يرجى المحاولة مرة أخرى.';
      
      if (err.message?.includes('Invalid login credentials')) {
        errorMessage = 'البريد الإلكتروني أو كلمة المرور غير صحيحة';
      } else if (err.message?.includes('Email not confirmed')) {
        errorMessage = 'يرجى تأكيد بريدك الإلكتروني أولاً';
      } else if (err.message?.includes('Network')) {
        errorMessage = 'خطأ في الاتصال. يرجى التحقق من اتصالك بالإنترنت';
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
      <Card className="w-full max-w-md shadow-2xl">
        <CardHeader className="space-y-1 text-center">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-primary/10">
            <LogIn className="h-8 w-8 text-primary" />
          </div>
          <CardTitle className="text-3xl font-bold">
            نظام وردة ERP
          </CardTitle>
          <CardDescription className="text-base">
            مرحباً بك! يرجى تسجيل الدخول للمتابعة
          </CardDescription>
        </CardHeader>
        
        <CardContent>
          <form onSubmit={handleLogin} className="space-y-5">
            {/* حقل البريد الإلكتروني */}
            <div className="space-y-2">
              <label 
                htmlFor="email" 
                className="block text-sm font-medium text-foreground"
              >
                البريد الإلكتروني
              </label>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="admin@wardah.sa"
                required
                disabled={loading}
                className="text-right"
                autoComplete="email"
                autoFocus
              />
            </div>
            
            {/* حقل كلمة المرور */}
            <div className="space-y-2">
              <label 
                htmlFor="password" 
                className="block text-sm font-medium text-foreground"
              >
                كلمة المرور
              </label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                required
                disabled={loading}
                className="text-right"
                autoComplete="current-password"
              />
            </div>
            
            {/* رسالة النجاح */}
            {message && (
              <Alert className="bg-green-50 text-green-900 border-green-200">
                <AlertDescription className="text-right">
                  {message}
                </AlertDescription>
              </Alert>
            )}
            
            {/* رسالة الخطأ */}
            {error && (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription className="text-right">
                  {error}
                </AlertDescription>
              </Alert>
            )}
            
            {/* زر تسجيل الدخول */}
            <Button 
              type="submit" 
              className="w-full text-lg py-6" 
              disabled={loading}
            >
              {loading ? (
                <>
                  <Loader2 className="ml-2 h-5 w-5 animate-spin" />
                  جارٍ تسجيل الدخول...
                </>
              ) : (
                <>
                  <LogIn className="ml-2 h-5 w-5" />
                  تسجيل الدخول
                </>
              )}
            </Button>
          </form>
          
          {/* معلومات تجريبية */}
          <div className="mt-6 p-4 bg-muted rounded-lg">
            <p className="text-sm text-muted-foreground text-center mb-2">
              <strong>بيانات تجريبية:</strong>
            </p>
            <div className="text-xs text-muted-foreground space-y-1">
              <p className="text-center">📧 admin@wardah.sa</p>
              <p className="text-center">🔑 admin123</p>
            </div>
          </div>

          {/* Sign Up Link */}
          <div className="mt-6 text-center">
            <p className="text-sm text-muted-foreground">
              ليس لديك حساب؟{' '}
              <Link to="/signup" className="font-medium text-primary hover:underline">
                إنشاء حساب جديد
              </Link>
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
