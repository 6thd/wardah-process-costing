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
  signOut: () => Promise<void>;
  refreshSession: () => Promise<void>;
}

// إنشاء السياق
const AuthContext = createContext<AuthContextType | undefined>(undefined);

// Provider Component
export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  
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
  
  const value = {
    user,
    session,
    loading,
    signOut,
    refreshSession
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
