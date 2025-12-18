/**
 * End-to-End Tests for Authentication Flow
 * Tests login, logout, password reset, and session management
 */

import { test, expect } from '@playwright/test'

test.describe('Authentication E2E', () => {
  test.describe('Login Flow', () => {
    test('should display login page', async ({ page }) => {
      await page.goto('/login')
      await page.waitForLoadState('networkidle')
      
      await expect(page.locator('[data-testid="login-form"]')).toBeVisible()
      await expect(page.locator('text=تسجيل الدخول')).toBeVisible()
    })

    test('should login with valid credentials', async ({ page }) => {
      await page.goto('/login')
      
      await page.fill('[name="email"]', 'test@example.com')
      await page.fill('[name="password"]', 'Test@123456')
      
      await page.click('[data-testid="login-btn"]')
      
      // Should redirect to dashboard
      await page.waitForURL('/dashboard')
      await expect(page.locator('text=لوحة التحكم')).toBeVisible()
    })

    test('should show error for invalid credentials', async ({ page }) => {
      await page.goto('/login')
      
      await page.fill('[name="email"]', 'wrong@example.com')
      await page.fill('[name="password"]', 'wrongpassword')
      
      await page.click('[data-testid="login-btn"]')
      
      // Should show error message
      await expect(page.locator('text=بيانات الدخول غير صحيحة')).toBeVisible()
    })

    test('should validate email format', async ({ page }) => {
      await page.goto('/login')
      
      await page.fill('[name="email"]', 'invalidemail')
      await page.fill('[name="password"]', 'Test@123456')
      
      await page.click('[data-testid="login-btn"]')
      
      // Should show validation error
      await expect(page.locator('text=البريد الإلكتروني غير صالح')).toBeVisible()
    })

    test('should require password', async ({ page }) => {
      await page.goto('/login')
      
      await page.fill('[name="email"]', 'test@example.com')
      // Don't fill password
      
      await page.click('[data-testid="login-btn"]')
      
      // Should show validation error
      await expect(page.locator('text=كلمة المرور مطلوبة')).toBeVisible()
    })

    test('should show/hide password', async ({ page }) => {
      await page.goto('/login')
      
      const passwordInput = page.locator('[name="password"]')
      await page.fill('[name="password"]', 'Test@123456')
      
      // Password should be hidden by default
      await expect(passwordInput).toHaveAttribute('type', 'password')
      
      // Click show password toggle
      await page.click('[data-testid="toggle-password-visibility"]')
      
      // Password should be visible
      await expect(passwordInput).toHaveAttribute('type', 'text')
    })
  })

  test.describe('Logout Flow', () => {
    test.beforeEach(async ({ page }) => {
      // Login first
      await page.goto('/login')
      await page.fill('[name="email"]', 'test@example.com')
      await page.fill('[name="password"]', 'Test@123456')
      await page.click('[data-testid="login-btn"]')
      await page.waitForURL('/dashboard')
    })

    test('should logout successfully', async ({ page }) => {
      await page.click('[data-testid="user-menu"]')
      await page.click('[data-testid="logout-btn"]')
      
      // Should redirect to login
      await page.waitForURL('/login')
      await expect(page.locator('[data-testid="login-form"]')).toBeVisible()
    })

    test('should clear session on logout', async ({ page }) => {
      await page.click('[data-testid="user-menu"]')
      await page.click('[data-testid="logout-btn"]')
      await page.waitForURL('/login')
      
      // Try to access protected route
      await page.goto('/dashboard')
      
      // Should redirect back to login
      await expect(page).toHaveURL('/login')
    })
  })

  test.describe('Password Reset', () => {
    test('should display forgot password link', async ({ page }) => {
      await page.goto('/login')
      
      await expect(page.locator('[data-testid="forgot-password-link"]')).toBeVisible()
    })

    test('should navigate to password reset page', async ({ page }) => {
      await page.goto('/login')
      
      await page.click('[data-testid="forgot-password-link"]')
      
      await expect(page).toHaveURL('/forgot-password')
      await expect(page.locator('text=استعادة كلمة المرور')).toBeVisible()
    })

    test('should send password reset email', async ({ page }) => {
      await page.goto('/forgot-password')
      
      await page.fill('[name="email"]', 'test@example.com')
      await page.click('[data-testid="send-reset-btn"]')
      
      // Should show success message
      await expect(page.locator('text=تم إرسال رابط استعادة كلمة المرور')).toBeVisible()
    })

    test('should validate email for password reset', async ({ page }) => {
      await page.goto('/forgot-password')
      
      await page.fill('[name="email"]', 'invalidemail')
      await page.click('[data-testid="send-reset-btn"]')
      
      // Should show validation error
      await expect(page.locator('text=البريد الإلكتروني غير صالح')).toBeVisible()
    })
  })

  test.describe('Session Management', () => {
    test('should redirect to login when not authenticated', async ({ page }) => {
      await page.goto('/dashboard')
      
      // Should redirect to login
      await expect(page).toHaveURL('/login')
    })

    test('should redirect back after login', async ({ page }) => {
      // Try to access protected route
      await page.goto('/inventory')
      
      // Should redirect to login
      await expect(page).toHaveURL(/login/)
      
      // Login
      await page.fill('[name="email"]', 'test@example.com')
      await page.fill('[name="password"]', 'Test@123456')
      await page.click('[data-testid="login-btn"]')
      
      // Should redirect back to original route
      await expect(page).toHaveURL('/inventory')
    })

    test('should persist session across page refreshes', async ({ page }) => {
      // Login
      await page.goto('/login')
      await page.fill('[name="email"]', 'test@example.com')
      await page.fill('[name="password"]', 'Test@123456')
      await page.click('[data-testid="login-btn"]')
      await page.waitForURL('/dashboard')
      
      // Refresh page
      await page.reload()
      
      // Should still be logged in
      await expect(page.locator('text=لوحة التحكم')).toBeVisible()
    })

    test('should show user info in header', async ({ page }) => {
      await page.goto('/login')
      await page.fill('[name="email"]', 'test@example.com')
      await page.fill('[name="password"]', 'Test@123456')
      await page.click('[data-testid="login-btn"]')
      await page.waitForURL('/dashboard')
      
      // User menu should show email/name
      await expect(page.locator('[data-testid="user-menu"]')).toBeVisible()
      await page.click('[data-testid="user-menu"]')
      await expect(page.locator('text=test@example.com')).toBeVisible()
    })
  })

  test.describe('Multi-tenant Access', () => {
    test('should show organization selector for multi-org users', async ({ page }) => {
      await page.goto('/login')
      await page.fill('[name="email"]', 'multiorg@example.com')
      await page.fill('[name="password"]', 'Test@123456')
      await page.click('[data-testid="login-btn"]')
      
      // Should show organization selector
      await expect(page.locator('[data-testid="org-selector"]')).toBeVisible()
    })

    test('should switch organizations', async ({ page }) => {
      await page.goto('/login')
      await page.fill('[name="email"]', 'multiorg@example.com')
      await page.fill('[name="password"]', 'Test@123456')
      await page.click('[data-testid="login-btn"]')
      
      // Select organization
      await page.click('[data-testid="org-selector"]')
      await page.click('[data-testid="org-option-2"]')
      
      // Should switch and refresh data
      await expect(page.locator('[data-testid="current-org"]')).toContainText('Organization 2')
    })
  })

  test.describe('Role-based Access', () => {
    test('should show admin menu for admin users', async ({ page }) => {
      await page.goto('/login')
      await page.fill('[name="email"]', 'admin@example.com')
      await page.fill('[name="password"]', 'Admin@123456')
      await page.click('[data-testid="login-btn"]')
      await page.waitForURL('/dashboard')
      
      // Admin menu should be visible
      await expect(page.locator('[data-testid="admin-menu"]')).toBeVisible()
    })

    test('should hide admin menu for regular users', async ({ page }) => {
      await page.goto('/login')
      await page.fill('[name="email"]', 'user@example.com')
      await page.fill('[name="password"]', 'User@123456')
      await page.click('[data-testid="login-btn"]')
      await page.waitForURL('/dashboard')
      
      // Admin menu should not be visible
      await expect(page.locator('[data-testid="admin-menu"]')).not.toBeVisible()
    })

    test('should deny access to admin pages for regular users', async ({ page }) => {
      await page.goto('/login')
      await page.fill('[name="email"]', 'user@example.com')
      await page.fill('[name="password"]', 'User@123456')
      await page.click('[data-testid="login-btn"]')
      await page.waitForURL('/dashboard')
      
      // Try to access admin page
      await page.goto('/admin/users')
      
      // Should show access denied or redirect
      await expect(page.locator('text=غير مصرح')).toBeVisible()
    })
  })

  test.describe('Security Features', () => {
    test('should lockout after multiple failed attempts', async ({ page }) => {
      await page.goto('/login')
      
      // Try wrong password multiple times
      for (let i = 0; i < 5; i++) {
        await page.fill('[name="email"]', 'test@example.com')
        await page.fill('[name="password"]', 'wrongpassword')
        await page.click('[data-testid="login-btn"]')
        await page.waitForTimeout(500)
      }
      
      // Should show lockout message
      await expect(page.locator('text=تم تعليق الحساب مؤقتاً')).toBeVisible()
    })

    test('should require password strength on signup', async ({ page }) => {
      await page.goto('/signup')
      
      await page.fill('[name="email"]', 'newuser@example.com')
      await page.fill('[name="password"]', 'weak')
      
      // Should show password strength error
      await expect(page.locator('text=كلمة المرور ضعيفة')).toBeVisible()
    })
  })
})
