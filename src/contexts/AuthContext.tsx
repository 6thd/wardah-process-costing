// src/contexts/AuthContext.tsx
// تم إنشاؤه: 28 أكتوبر 2025
// الهدف: إدارة موحدة لحالة المصادقة في التطبيق

import { createContext, useContext, useEffect, useState, useRef, ReactNode } from 'react';
import { User, Session } from '@supabase/supabase-js';
import { getSupabase } from '@/lib/supabase';

// تعريف نوع السياق
interface AuthContextType {
  user: User | null;
  session: Session | null;
  loading: boolean;
  isAuthenticated: boolean;
  currentOrgId: string | null;
  organizations: any[];
  signOut: () => Promise<void>;
  refreshSession: () => Promise<void>;
  setCurrentOrgId: (orgId: string) => void;
  refreshOrganizations: () => Promise<void>;
}

// إنشاء السياق
const AuthContext = createContext<AuthContextType | undefined>(undefined);

// Default org from config
const DEFAULT_ORG_ID = '00000000-0000-0000-0000-000000000001';

// Provider Component
export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [currentOrgId, setCurrentOrgIdState] = useState<string | null>(
    localStorage.getItem('current_org_id') || DEFAULT_ORG_ID
  );
  const [organizations, setOrganizations] = useState<any[]>([]);
  
  // Refs لمنع الاستدعاءات المتكررة
  const loadingOrgsRef = useRef(false);
  const lastLoadedUserIdRef = useRef<string | null>(null);
  
  // Load user's organizations
  const loadOrganizations = async (userId: string, force = false) => {
    // منع الاستدعاءات المتكررة
    if (loadingOrgsRef.current) {
      console.log('⏳ Already loading organizations, skipping...');
      return;
    }
    
    // منع إعادة التحميل لنفس المستخدم إلا إذا كان force
    if (!force && lastLoadedUserIdRef.current === userId) {
      console.log('✅ Organizations already loaded for this user');
      return;
    }
    
    loadingOrgsRef.current = true;
    console.log('🔄 Loading organizations for user:', userId);
    
    try {
      const supabase = getSupabase();
      
      const { data, error } = await supabase
        .from('user_organizations')
        .select(`
          *,
          organization:organizations(*)
        `)
        .eq('user_id', userId)
        .eq('is_active', true);

      console.log('📦 Organizations result:', { data, error });

      if (error) {
        console.error('❌ Error loading organizations:', error);
        // استخدام القيمة الافتراضية من localStorage أو config
        const storedOrg = localStorage.getItem('current_org_id');
        if (!storedOrg) {
          setCurrentOrgIdState(DEFAULT_ORG_ID);
          localStorage.setItem('current_org_id', DEFAULT_ORG_ID);
        }
        return;
      }

      setOrganizations(data || []);
      lastLoadedUserIdRef.current = userId;

      // Set current org from localStorage or first available or config default
      const storedOrgId = localStorage.getItem('current_org_id');
      if (storedOrgId && data?.find((uo: any) => uo.org_id === storedOrgId)) {
        setCurrentOrgIdState(storedOrgId);
      } else if (data && data.length > 0) {
        const firstOrgId = data[0].org_id;
        setCurrentOrgIdState(firstOrgId);
        localStorage.setItem('current_org_id', firstOrgId);
      } else {
        // No organizations found, use config default
        console.log('⚠️ No organizations found, using default:', DEFAULT_ORG_ID);
        setCurrentOrgIdState(DEFAULT_ORG_ID);
        localStorage.setItem('current_org_id', DEFAULT_ORG_ID);
      }
    } catch (error) {
      console.error('❌ Error in loadOrganizations:', error);
      // Fallback to stored or default org_id
      const storedOrg = localStorage.getItem('current_org_id');
      if (!storedOrg) {
        setCurrentOrgIdState(DEFAULT_ORG_ID);
        localStorage.setItem('current_org_id', DEFAULT_ORG_ID);
      }
    } finally {
      loadingOrgsRef.current = false;
    }
  };

  useEffect(() => {
    const supabase = getSupabase();
    let mounted = true;
    
    // Get initial session
    const initializeAuth = async () => {
      try {
        const { data: { session }, error } = await supabase.auth.getSession();
        
        if (!mounted) return;
        
        if (error) {
          console.error('Error getting session:', error);
        }
        
        setSession(session);
        setUser(session?.user ?? null);
        
        // Load organizations if user is authenticated
        if (session?.user) {
          await loadOrganizations(session.user.id);
        }
      } catch (error) {
        console.error('Error initializing auth:', error);
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    };
    
    initializeAuth();
    
    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        if (!mounted) return;
        
        console.log('Auth state changed:', event);
        setSession(session);
        setUser(session?.user ?? null);
        
        // فقط تحميل المنظمات عند تسجيل دخول جديد حقيقي
        if (event === 'SIGNED_IN' && session?.user) {
          // تحقق من أن هذا ليس مجرد تحديث visibility
          if (lastLoadedUserIdRef.current !== session.user.id) {
            await loadOrganizations(session.user.id);
          }
        }
        
        // Clear organizations on sign out
        if (event === 'SIGNED_OUT') {
          setOrganizations([]);
          setCurrentOrgIdState(null);
          localStorage.removeItem('current_org_id');
          lastLoadedUserIdRef.current = null;
        }
        
        setLoading(false);
      }
    );
    
    // Cleanup subscription
    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, []);
  
  const signOut = async () => {
    try {
      const supabase = getSupabase();
      const { error } = await supabase.auth.signOut();
      
      if (error) {
        console.error('Error signing out:', error);
        throw error;
      }
      
      // Clear local state
      setUser(null);
      setSession(null);
      setOrganizations([]);
      setCurrentOrgIdState(null);
      localStorage.removeItem('current_org_id');
      lastLoadedUserIdRef.current = null;
    } catch (error) {
      console.error('Sign out error:', error);
      throw error;
    }
  };
  
  const refreshSession = async () => {
    try {
      const supabase = getSupabase();
      const { data: { session }, error } = await supabase.auth.refreshSession();
      
      if (error) {
        console.error('Error refreshing session:', error);
        throw error;
      }
      
      setSession(session);
      setUser(session?.user ?? null);
    } catch (error) {
      console.error('Refresh session error:', error);
      throw error;
    }
  };

  const setCurrentOrgId = (orgId: string) => {
    setCurrentOrgIdState(orgId);
    localStorage.setItem('current_org_id', orgId);
  };

  const refreshOrganizations = async () => {
    if (user) {
      await loadOrganizations(user.id, true); // force reload
    }
  };
  
  const value = {
    user,
    session,
    loading,
    isAuthenticated: !!user,
    currentOrgId,
    organizations,
    signOut,
    refreshSession,
    setCurrentOrgId,
    refreshOrganizations,
  };
  
  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}

// Custom hook لاستخدام السياق
export function useAuth() {
  const context = useContext(AuthContext);
  
  if (context === undefined) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  
  return context;
}

// Hook مساعد للتحقق من الصلاحيات
export function useRequireAuth() {
  const { user, loading, isAuthenticated } = useAuth();
  
  return {
    user,
    loading,
    isAuthenticated
  };
}
