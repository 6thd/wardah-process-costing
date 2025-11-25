// src/contexts/AuthContext.tsx
// تم إنشاؤه: 28 أكتوبر 2025
// الهدف: إدارة موحدة لحالة المصادقة في التطبيق

import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { User, Session } from '@supabase/supabase-js';
import { getSupabase } from '@/lib/supabase';

// تعريف نوع السياق
interface AuthContextType {
  user: User | null;
  session: Session | null;
  loading: boolean;
  currentOrgId: string | null;
  organizations: any[];
  signOut: () => Promise<void>;
  refreshSession: () => Promise<void>;
  setCurrentOrgId: (orgId: string) => void;
  refreshOrganizations: () => Promise<void>;
}

// إنشاء السياق
const AuthContext = createContext<AuthContextType | undefined>(undefined);

// Provider Component
export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [currentOrgId, setCurrentOrgIdState] = useState<string | null>(null);
  const [organizations, setOrganizations] = useState<any[]>([]);
  
  // Load user's organizations
  const loadOrganizations = async (userId: string) => {
    console.log('🔄 Loading organizations for user:', userId);
    
    // Default org from config
    const configOrgId = '00000000-0000-0000-0000-000000000001';
    
    try {
      const supabase = getSupabase();
      
      // Add timeout to prevent hanging
      const timeoutPromise = new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Timeout')), 5000)
      );
      
      const queryPromise = supabase
        .from('user_organizations')
        .select(`
          *,
          organization:organizations(*)
        `)
        .eq('user_id', userId)
        .eq('is_active', true);

      const result = await Promise.race([queryPromise, timeoutPromise]) as any;
      const { data, error } = result;

      console.log('📦 Organizations result:', { data, error });

      if (error) {
        console.error('❌ Error loading organizations:', error);
        setCurrentOrgIdState(configOrgId);
        localStorage.setItem('current_org_id', configOrgId);
        return;
      }

      setOrganizations(data || []);

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
        console.log('⚠️ No organizations found, using default:', configOrgId);
        setCurrentOrgIdState(configOrgId);
        localStorage.setItem('current_org_id', configOrgId);
      }
    } catch (error) {
      console.error('❌ Error in loadOrganizations:', error);
      // Fallback to config org_id
      setCurrentOrgIdState(configOrgId);
      localStorage.setItem('current_org_id', configOrgId);
    }
  };

  useEffect(() => {
    const supabase = getSupabase();
    
    // Get initial session
    const initializeAuth = async () => {
      try {
        const { data: { session }, error } = await supabase.auth.getSession();
        
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
        setLoading(false);
      }
    };
    
    initializeAuth();
    
    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (_event, session) => {
        console.log('Auth state changed:', _event);
        setSession(session);
        setUser(session?.user ?? null);
        
        // Load organizations on sign in
        if (_event === 'SIGNED_IN' && session?.user) {
          await loadOrganizations(session.user.id);
        }
        
        // Clear organizations on sign out
        if (_event === 'SIGNED_OUT') {
          setOrganizations([]);
          setCurrentOrgIdState(null);
          localStorage.removeItem('current_org_id');
        }
        
        setLoading(false);
      }
    );
    
    // Cleanup subscription
    return () => {
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
      await loadOrganizations(user.id);
    }
  };
  
  const value = {
    user,
    session,
    loading,
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
  const { user, loading } = useAuth();
  
  return {
    user,
    loading,
    isAuthenticated: !!user
  };
}
