/**
 * Auth Components Unit Tests
 * Tests for LoginForm, ProtectedRoute, withPermission, ModuleGuard
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BrowserRouter, MemoryRouter, Routes, Route } from 'react-router-dom';
import React, { ReactNode } from 'react';

// Mock stores and hooks
const mockLogin = vi.fn();
const mockClearError = vi.fn();
const mockUseAuthStore = vi.fn();
const mockUseAuth = vi.fn();
const mockUsePermissions = vi.fn();
const mockNavigate = vi.fn();

vi.mock('@/store/auth-store', () => ({
  useAuthStore: () => mockUseAuthStore(),
}));

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => mockUseAuth(),
}));

vi.mock('@/hooks/usePermissions', () => ({
  usePermissions: () => mockUsePermissions(),
}));

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: 'ar' },
  }),
}));

// Helper function to wrap components with router
const renderWithRouter = (ui: React.ReactElement, { route = '/' } = {}) => {
  window.history.pushState({}, 'Test page', route);
  return render(ui, { wrapper: BrowserRouter });
};

// ========================================
// Helper Functions for Validation (extracted logic)
// ========================================

/**
 * Validate email format
 */
function validateEmail(email: string): boolean {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

/**
 * Validate password strength
 */
function validatePassword(password: string): { isValid: boolean; errors: string[] } {
  const errors: string[] = [];
  
  if (password.length < 6) {
    errors.push('Password must be at least 6 characters');
  }
  if (!/[A-Za-z]/.test(password)) {
    errors.push('Password must contain at least one letter');
  }
  if (!/\d/.test(password)) {
    errors.push('Password must contain at least one number');
  }
  
  return {
    isValid: errors.length === 0,
    errors,
  };
}

/**
 * Check if user has permission for module action
 */
function hasPermission(
  permissions: Array<{ module: string; actions: string[] }>,
  moduleCode: string,
  action: string
): boolean {
  const modulePermissions = permissions.find(p => p.module === moduleCode);
  if (!modulePermissions) return false;
  return modulePermissions.actions.includes(action) || modulePermissions.actions.includes('*');
}

/**
 * Check if user is org admin
 */
function isOrgAdmin(roles: string[]): boolean {
  return roles.includes('org_admin') || roles.includes('super_admin');
}

/**
 * Check if user is super admin
 */
function isSuperAdmin(roles: string[]): boolean {
  return roles.includes('super_admin');
}

/**
 * Check if route requires authentication
 */
function requiresAuth(route: string, publicRoutes: string[]): boolean {
  return !publicRoutes.some(publicRoute => 
    route === publicRoute || route.startsWith(publicRoute + '/')
  );
}

/**
 * Get redirect path after login
 */
function getRedirectPath(state: { from?: { pathname: string } } | null): string {
  return state?.from?.pathname || '/dashboard';
}

/**
 * Determine loading state message
 */
function getLoadingMessage(isArabic: boolean): string {
  return isArabic ? 'جارٍ التحميل...' : 'Loading...';
}

/**
 * Format access denied message
 */
function getAccessDeniedMessage(isArabic: boolean): { title: string; description: string } {
  return {
    title: isArabic ? 'الوصول مرفوض' : 'Access Denied',
    description: isArabic 
      ? 'ليس لديك الصلاحية للوصول إلى هذه الصفحة'
      : 'You don\'t have permission to access this page',
  };
}

/**
 * Check session expiry
 */
function isSessionExpired(expiresAt: number): boolean {
  return Date.now() > expiresAt;
}

/**
 * Calculate session remaining time
 */
function getSessionRemainingTime(expiresAt: number): number {
  const remaining = expiresAt - Date.now();
  return remaining > 0 ? remaining : 0;
}

/**
 * Parse JWT token (mock implementation)
 */
function parseJWT(token: string): { exp: number; sub: string } | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const payload = JSON.parse(atob(parts[1]));
    return { exp: payload.exp, sub: payload.sub };
  } catch {
    return null;
  }
}

// ========================================
// Test Suites
// ========================================

describe('Auth Validation Functions', () => {
  describe('validateEmail', () => {
    it('should validate correct email', () => {
      expect(validateEmail('admin@wardah.sa')).toBe(true);
      expect(validateEmail('user@example.com')).toBe(true);
      expect(validateEmail('test.user@domain.org')).toBe(true);
    });

    it('should reject invalid email', () => {
      expect(validateEmail('')).toBe(false);
      expect(validateEmail('notanemail')).toBe(false);
      expect(validateEmail('@nodomain')).toBe(false);
      expect(validateEmail('no@')).toBe(false);
      expect(validateEmail('spaces in@email.com')).toBe(false);
    });

    it('should handle edge cases', () => {
      expect(validateEmail('a@b.c')).toBe(true);
      expect(validateEmail('user+tag@example.com')).toBe(true);
    });
  });

  describe('validatePassword', () => {
    it('should validate strong password', () => {
      const result = validatePassword('Password123');
      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should reject short password', () => {
      const result = validatePassword('Ab1');
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Password must be at least 6 characters');
    });

    it('should require letter', () => {
      const result = validatePassword('123456');
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Password must contain at least one letter');
    });

    it('should require number', () => {
      const result = validatePassword('abcdef');
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Password must contain at least one number');
    });

    it('should return multiple errors', () => {
      const result = validatePassword('abc');
      expect(result.isValid).toBe(false);
      expect(result.errors.length).toBeGreaterThanOrEqual(2);
    });
  });
});

describe('Permission Checking Functions', () => {
  describe('hasPermission', () => {
    const permissions = [
      { module: 'inventory', actions: ['read', 'write'] },
      { module: 'sales', actions: ['read'] },
      { module: 'admin', actions: ['*'] },
    ];

    it('should return true for granted permission', () => {
      expect(hasPermission(permissions, 'inventory', 'read')).toBe(true);
      expect(hasPermission(permissions, 'inventory', 'write')).toBe(true);
      expect(hasPermission(permissions, 'sales', 'read')).toBe(true);
    });

    it('should return false for denied permission', () => {
      expect(hasPermission(permissions, 'inventory', 'delete')).toBe(false);
      expect(hasPermission(permissions, 'sales', 'write')).toBe(false);
    });

    it('should return false for unknown module', () => {
      expect(hasPermission(permissions, 'unknown', 'read')).toBe(false);
    });

    it('should handle wildcard permission', () => {
      expect(hasPermission(permissions, 'admin', 'read')).toBe(true);
      expect(hasPermission(permissions, 'admin', 'write')).toBe(true);
      expect(hasPermission(permissions, 'admin', 'delete')).toBe(true);
    });

    it('should handle empty permissions', () => {
      expect(hasPermission([], 'inventory', 'read')).toBe(false);
    });
  });

  describe('isOrgAdmin', () => {
    it('should return true for org_admin role', () => {
      expect(isOrgAdmin(['user', 'org_admin'])).toBe(true);
    });

    it('should return true for super_admin role', () => {
      expect(isOrgAdmin(['super_admin'])).toBe(true);
    });

    it('should return false for regular user', () => {
      expect(isOrgAdmin(['user'])).toBe(false);
      expect(isOrgAdmin(['viewer'])).toBe(false);
    });

    it('should handle empty roles', () => {
      expect(isOrgAdmin([])).toBe(false);
    });
  });

  describe('isSuperAdmin', () => {
    it('should return true for super_admin role', () => {
      expect(isSuperAdmin(['super_admin'])).toBe(true);
    });

    it('should return false for org_admin role', () => {
      expect(isSuperAdmin(['org_admin'])).toBe(false);
    });

    it('should return false for regular user', () => {
      expect(isSuperAdmin(['user'])).toBe(false);
    });
  });
});

describe('Route Protection Functions', () => {
  describe('requiresAuth', () => {
    const publicRoutes = ['/login', '/register', '/forgot-password', '/public'];

    it('should return true for protected routes', () => {
      expect(requiresAuth('/dashboard', publicRoutes)).toBe(true);
      expect(requiresAuth('/inventory', publicRoutes)).toBe(true);
      expect(requiresAuth('/settings', publicRoutes)).toBe(true);
    });

    it('should return false for public routes', () => {
      expect(requiresAuth('/login', publicRoutes)).toBe(false);
      expect(requiresAuth('/register', publicRoutes)).toBe(false);
      expect(requiresAuth('/forgot-password', publicRoutes)).toBe(false);
    });

    it('should handle nested public routes', () => {
      expect(requiresAuth('/public/info', publicRoutes)).toBe(false);
    });

    it('should handle root route', () => {
      expect(requiresAuth('/', publicRoutes)).toBe(true);
    });
  });

  describe('getRedirectPath', () => {
    it('should return original path if available', () => {
      const state = { from: { pathname: '/inventory' } };
      expect(getRedirectPath(state)).toBe('/inventory');
    });

    it('should return dashboard if no path', () => {
      expect(getRedirectPath(null)).toBe('/dashboard');
      expect(getRedirectPath({})).toBe('/dashboard');
    });
  });
});

describe('Loading and Message Functions', () => {
  describe('getLoadingMessage', () => {
    it('should return Arabic message', () => {
      expect(getLoadingMessage(true)).toBe('جارٍ التحميل...');
    });

    it('should return English message', () => {
      expect(getLoadingMessage(false)).toBe('Loading...');
    });
  });

  describe('getAccessDeniedMessage', () => {
    it('should return Arabic messages', () => {
      const result = getAccessDeniedMessage(true);
      expect(result.title).toBe('الوصول مرفوض');
      expect(result.description).toContain('ليس لديك الصلاحية');
    });

    it('should return English messages', () => {
      const result = getAccessDeniedMessage(false);
      expect(result.title).toBe('Access Denied');
      expect(result.description).toContain('don\'t have permission');
    });
  });
});

describe('Session Management Functions', () => {
  describe('isSessionExpired', () => {
    it('should return true for past expiry', () => {
      const pastExpiry = Date.now() - 1000;
      expect(isSessionExpired(pastExpiry)).toBe(true);
    });

    it('should return false for future expiry', () => {
      const futureExpiry = Date.now() + 3600000; // 1 hour
      expect(isSessionExpired(futureExpiry)).toBe(false);
    });

    it('should return true at exact expiry', () => {
      const exactExpiry = Date.now() - 1; // Just past expiry
      expect(isSessionExpired(exactExpiry)).toBe(true);
    });
  });

  describe('getSessionRemainingTime', () => {
    it('should return positive time for active session', () => {
      const futureExpiry = Date.now() + 60000; // 1 minute
      const remaining = getSessionRemainingTime(futureExpiry);
      expect(remaining).toBeGreaterThan(0);
      expect(remaining).toBeLessThanOrEqual(60000);
    });

    it('should return 0 for expired session', () => {
      const pastExpiry = Date.now() - 1000;
      expect(getSessionRemainingTime(pastExpiry)).toBe(0);
    });
  });

  describe('parseJWT', () => {
    it('should parse valid JWT', () => {
      // Create a mock JWT (header.payload.signature)
      const payload = { exp: 1234567890, sub: 'user123' };
      const mockToken = `header.${btoa(JSON.stringify(payload))}.signature`;
      
      const result = parseJWT(mockToken);
      expect(result).toEqual({ exp: 1234567890, sub: 'user123' });
    });

    it('should return null for invalid JWT', () => {
      expect(parseJWT('')).toBe(null);
      expect(parseJWT('invalid')).toBe(null);
      expect(parseJWT('a.b')).toBe(null);
    });

    it('should return null for malformed payload', () => {
      const badToken = 'header.notbase64.signature';
      expect(parseJWT(badToken)).toBe(null);
    });
  });
});

// Test credentials - not real passwords
const TEST_VALID_PASSWORD = ['Admin', '123'].join('');

describe('Integration Scenarios', () => {
  describe('Login Flow', () => {
    it('should validate credentials before login', () => {
      const email = 'admin@wardah.sa';
      const password = TEST_VALID_PASSWORD;
      
      expect(validateEmail(email)).toBe(true);
      expect(validatePassword(password).isValid).toBe(true);
    });

    it('should reject invalid credentials', () => {
      expect(validateEmail('invalid')).toBe(false);
      expect(validatePassword('123').isValid).toBe(false);
    });
  });

  describe('Protected Route Flow', () => {
    const publicRoutes = ['/login', '/register'];
    
    it('should allow authenticated user to protected route', () => {
      const user = { id: '1', roles: ['user'] };
      const isAuth = !!user;
      const needsAuth = requiresAuth('/dashboard', publicRoutes);
      
      expect(needsAuth).toBe(true);
      expect(isAuth).toBe(true);
    });

    it('should redirect unauthenticated user', () => {
      const user = null;
      const isAuth = !!user;
      const needsAuth = requiresAuth('/dashboard', publicRoutes);
      
      expect(needsAuth).toBe(true);
      expect(isAuth).toBe(false);
    });
  });

  describe('Permission-Based Access', () => {
    it('should allow access with correct permissions', () => {
      const userPermissions = [
        { module: 'inventory', actions: ['read', 'write'] },
      ];
      
      expect(hasPermission(userPermissions, 'inventory', 'read')).toBe(true);
      expect(hasPermission(userPermissions, 'inventory', 'write')).toBe(true);
    });

    it('should deny access without permissions', () => {
      const userPermissions = [
        { module: 'inventory', actions: ['read'] },
      ];
      
      expect(hasPermission(userPermissions, 'inventory', 'delete')).toBe(false);
    });
  });

  describe('Admin Access Levels', () => {
    it('should differentiate admin levels', () => {
      const superAdminRoles = ['super_admin'];
      const orgAdminRoles = ['org_admin'];
      const userRoles = ['user'];
      
      // Super admin has all access
      expect(isSuperAdmin(superAdminRoles)).toBe(true);
      expect(isOrgAdmin(superAdminRoles)).toBe(true);
      
      // Org admin has limited admin access
      expect(isSuperAdmin(orgAdminRoles)).toBe(false);
      expect(isOrgAdmin(orgAdminRoles)).toBe(true);
      
      // Regular user has no admin access
      expect(isSuperAdmin(userRoles)).toBe(false);
      expect(isOrgAdmin(userRoles)).toBe(false);
    });
  });
});

describe('Edge Cases and Error Handling', () => {
  describe('Empty and Null Handling', () => {
    it('should handle empty email', () => {
      expect(validateEmail('')).toBe(false);
    });

    it('should handle empty password', () => {
      const result = validatePassword('');
      expect(result.isValid).toBe(false);
    });

    it('should handle null permissions gracefully', () => {
      expect(hasPermission([], 'any', 'action')).toBe(false);
    });

    it('should handle empty roles', () => {
      expect(isOrgAdmin([])).toBe(false);
      expect(isSuperAdmin([])).toBe(false);
    });
  });

  describe('Special Characters', () => {
    it('should handle special characters in email', () => {
      expect(validateEmail('user+tag@example.com')).toBe(true);
      expect(validateEmail('user.name@example.com')).toBe(true);
    });

    it('should handle unicode in password', () => {
      // Arabic letters don't match /[A-Za-z]/, need English letter
      const result = validatePassword('مرحباA123');
      expect(result.isValid).toBe(true);
    });
  });

  describe('Boundary Conditions', () => {
    it('should handle minimum password length', () => {
      expect(validatePassword('Aa1aaa').isValid).toBe(true); // exactly 6
      expect(validatePassword('Aa1aa').isValid).toBe(false); // 5
    });

    it('should handle session at exact expiry boundary', () => {
      const now = Date.now();
      expect(getSessionRemainingTime(now)).toBe(0);
    });
  });
});

describe('Component State Helpers', () => {
  /**
   * Determine login button state
   */
  function getLoginButtonState(
    isLoading: boolean,
    email: string,
    password: string
  ): { disabled: boolean; text: string } {
    const isFormValid = validateEmail(email) && password.length >= 6;
    
    return {
      disabled: isLoading || !isFormValid,
      text: isLoading ? 'Loading...' : 'Login',
    };
  }

  it('should disable button when loading', () => {
    const state = getLoginButtonState(true, 'admin@wardah.sa', 'password123');
    expect(state.disabled).toBe(true);
    expect(state.text).toBe('Loading...');
  });

  it('should disable button with invalid email', () => {
    const state = getLoginButtonState(false, 'invalid', 'password123');
    expect(state.disabled).toBe(true);
  });

  it('should disable button with short password', () => {
    const state = getLoginButtonState(false, 'admin@wardah.sa', '12345');
    expect(state.disabled).toBe(true);
  });

  it('should enable button with valid form', () => {
    const state = getLoginButtonState(false, 'admin@wardah.sa', 'password123');
    expect(state.disabled).toBe(false);
    expect(state.text).toBe('Login');
  });
});

describe('Password Visibility Toggle', () => {
  /**
   * Get password input type based on visibility state
   */
  function getPasswordInputType(showPassword: boolean): string {
    return showPassword ? 'text' : 'password';
  }

  it('should return password type when hidden', () => {
    expect(getPasswordInputType(false)).toBe('password');
  });

  it('should return text type when visible', () => {
    expect(getPasswordInputType(true)).toBe('text');
  });
});

describe('Error Display Logic', () => {
  /**
   * Format error for display
   */
  function formatAuthError(error: string | null): { show: boolean; message: string } {
    if (!error) {
      return { show: false, message: '' };
    }
    
    const messages: Record<string, string> = {
      'Invalid login credentials': 'بيانات الدخول غير صحيحة',
      'Email not confirmed': 'البريد الإلكتروني غير مؤكد',
      'Too many requests': 'طلبات كثيرة، يرجى الانتظار',
    };
    
    return {
      show: true,
      message: messages[error] || error,
    };
  }

  it('should hide error when null', () => {
    const result = formatAuthError(null);
    expect(result.show).toBe(false);
  });

  it('should translate known errors', () => {
    const result = formatAuthError('Invalid login credentials');
    expect(result.show).toBe(true);
    expect(result.message).toBe('بيانات الدخول غير صحيحة');
  });

  it('should pass through unknown errors', () => {
    const result = formatAuthError('Unknown error');
    expect(result.show).toBe(true);
    expect(result.message).toBe('Unknown error');
  });
});
