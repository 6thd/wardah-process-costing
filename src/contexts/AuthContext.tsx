// src/contexts/AuthContext.tsx
// تم إنشاؤه: 28 أكتوبر 2025
// الهدف: إدارة موحدة لحالة المصادقة في التطبيق

import { createContext, useContext, useEffect, useState, useRef, useMemo, useCallback, ReactNode } from 'react';
import { User, Session } from '@supabase/supabase-js';
import { getSupabase } from '@/lib/supabase';
import { safeLocalStorage } from '@/lib/safe-storage';

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
export function AuthProvider({ children }: { readonly children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  // NOSONAR - Lazy initializer is correct pattern for localStorage access
  // eslint-disable-next-line sonarjs/prefer-immediate-return
  const [currentOrgId, setCurrentOrgIdState] = useState<string | null>(
    () => safeLocalStorage.getItem('current_org_id') || DEFAULT_ORG_ID // NOSONAR
  );
  const [organizations, setOrganizations] = useState<any[]>([]);
  
  // Refs لمنع الاستدعاءات المتكررة
  const loadingOrgsRef = useRef(false);
  const lastLoadedUserIdRef = useRef<string | null>(null);
  const isSigningOutRef = useRef(false);
  const authStateChangeHandledRef = useRef<string | null>(null);
  
  // Cache for tenantId to avoid repeated getSession() calls
  const tenantIdCacheRef = useRef<string | null>(null);
  
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
        const storedOrg = safeLocalStorage.getItem('current_org_id');
        if (!storedOrg) {
          setCurrentOrgIdState(DEFAULT_ORG_ID);
          safeLocalStorage.setItem('current_org_id', DEFAULT_ORG_ID);
        }
        return;
      }

      setOrganizations(data || []);
      lastLoadedUserIdRef.current = userId;

      // Set current org from localStorage or first available or config default
      const storedOrgId = safeLocalStorage.getItem('current_org_id');
      if (storedOrgId && data?.find((uo: any) => uo.org_id === storedOrgId)) {
        setCurrentOrgIdState(storedOrgId);
      } else if (data && data.length > 0) {
        const firstOrgId = data[0].org_id;
        setCurrentOrgIdState(firstOrgId);
        safeLocalStorage.setItem('current_org_id', firstOrgId);
      } else {
        // No organizations found, use config default
        console.log('⚠️ No organizations found, using default:', DEFAULT_ORG_ID);
        setCurrentOrgIdState(DEFAULT_ORG_ID);
        safeLocalStorage.setItem('current_org_id', DEFAULT_ORG_ID);
      }
    } catch (error) {
      console.error('❌ Error in loadOrganizations:', error);
      // Fallback to stored or default org_id
      const storedOrg = safeLocalStorage.getItem('current_org_id');
      if (!storedOrg) {
        setCurrentOrgIdState(DEFAULT_ORG_ID);
        safeLocalStorage.setItem('current_org_id', DEFAULT_ORG_ID);
      }
    } finally {
      loadingOrgsRef.current = false;
    }
  };

  useEffect(() => {
    const supabase = getSupabase();
    let mounted = true;
    
    // Get initial session (without strict timeout to avoid false errors)
    const initializeAuth = async () => {
      try {
        // Get session - allow it to take time but log if slow
        const startTime = Date.now();
        const sessionPromise = supabase.auth.getSession();
        
        // Log warning if it takes too long, but don't fail
        const logSlowSession = () => {
          const elapsed = Date.now() - startTime;
          console.warn(`⚠️ Session loading is taking longer than expected (${elapsed}ms), continuing...`);
        };
        const warningTimeout = setTimeout(logSlowSession, 8000); // 8 seconds warning
        
        const { data: { session }, error } = await sessionPromise;
        
        clearTimeout(warningTimeout);
        
        if (!mounted) return;
        
        if (error) {
          console.error('Error getting session:', error);
        }
        
        setSession(session);
        setUser(session?.user ?? null);
        
        // Cache tenantId immediately from currentOrgId or default
        if (currentOrgId) {
          tenantIdCacheRef.current = currentOrgId;
        } else {
          tenantIdCacheRef.current = DEFAULT_ORG_ID;
        }
        
        // Load organizations in parallel (don't wait for it to finish)
        if (session?.user) {
          // Don't await - let it load in background
          loadOrganizations(session.user.id).then(() => {
            // Update cache after organizations are loaded
            if (mounted && currentOrgId) {
              tenantIdCacheRef.current = currentOrgId;
            }
          }).catch(err => {
            console.warn('Failed to load organizations:', err);
          });
        }
        
        // Set loading to false immediately after session is loaded
        if (mounted) {
          setLoading(false);
        }
      } catch (error) {
        console.error('Error initializing auth:', error);
        // Set loading to false even on error
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
        
        // منع معالجة نفس الحدث مرتين
        const eventKey = `${event}-${session?.user?.id || 'null'}-${Date.now()}`;
        if (authStateChangeHandledRef.current === eventKey) {
          return;
        }
        authStateChangeHandledRef.current = eventKey;
        
        console.log('Auth state changed:', event);
        
        // منع معالجة SIGNED_OUT المتكررة
        if (event === 'SIGNED_OUT') {
          if (isSigningOutRef.current) {
            // تم التعامل معه بالفعل
            return;
          }
          isSigningOutRef.current = true;
        } else {
          isSigningOutRef.current = false;
        }
        
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
          safeLocalStorage.removeItem('current_org_id');
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
  
  const signOut = useCallback(async () => {
    // منع استدعاءات متعددة
    if (isSigningOutRef.current) {
      console.log('⏳ Already signing out, skipping...');
      return;
    }
    
    isSigningOutRef.current = true;
    
    try {
      const supabase = getSupabase();
      
      // Clear local state first to prevent re-renders
      setUser(null);
      setSession(null);
      setOrganizations([]);
      setCurrentOrgIdState(null);
      safeLocalStorage.removeItem('current_org_id');
      lastLoadedUserIdRef.current = null;
      
      const { error } = await supabase.auth.signOut();
      
      if (error) {
        console.error('Error signing out:', error);
        isSigningOutRef.current = false;
        throw error;
      }
    } catch (error) {
      console.error('Sign out error:', error);
      isSigningOutRef.current = false;
      throw error;
    } finally {
      // Reset after a short delay to allow auth state change to process
      setTimeout(() => {
        isSigningOutRef.current = false;
      }, 1000);
    }
  }, []);
  
  const refreshSession = useCallback(async () => {
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
  }, []);

  const setCurrentOrgId = useCallback((orgId: string) => {
    setCurrentOrgIdState(orgId);
    safeLocalStorage.setItem('current_org_id', orgId);
  }, []);

  const refreshOrganizations = useCallback(async () => {
    if (user) {
      await loadOrganizations(user.id, true); // force reload
    }
  }, [user]);
  
  // Get effective tenant ID (cached from currentOrgId)
  const getEffectiveTenantId = useCallback((): string | null => {
    // Use cached currentOrgId first (fastest)
    if (currentOrgId) {
      tenantIdCacheRef.current = currentOrgId;
      return currentOrgId;
    }
    
    // Fallback to cached value
    if (tenantIdCacheRef.current) {
      return tenantIdCacheRef.current;
    }
    
    // Fallback to default org ID
    return DEFAULT_ORG_ID;
  }, [currentOrgId]);
  
  const value = useMemo(() => ({
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
    getEffectiveTenantId,
  }), [user, session, loading, currentOrgId, organizations, signOut, refreshSession, setCurrentOrgId, refreshOrganizations, getEffectiveTenantId]);
  
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
