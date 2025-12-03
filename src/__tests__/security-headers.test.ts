/**
 * Security Headers Tests
 */

import { describe, it, expect } from 'vitest';
import { getSecurityHeaders, validateSecurityHeaders, getSecurityMetaTags } from '../lib/security-headers';

describe('Security Headers', () => {
  describe('getSecurityHeaders', () => {
    it('should return all required security headers', () => {
      const headers = getSecurityHeaders();

      expect(headers).toHaveProperty('Content-Security-Policy');
      expect(headers).toHaveProperty('X-Frame-Options');
      expect(headers).toHaveProperty('X-Content-Type-Options');
      expect(headers).toHaveProperty('X-XSS-Protection');
      expect(headers).toHaveProperty('Referrer-Policy');
      expect(headers).toHaveProperty('Permissions-Policy');
      expect(headers).toHaveProperty('Strict-Transport-Security');
    });

    it('should have correct X-Frame-Options value', () => {
      const headers = getSecurityHeaders();
      expect(headers['X-Frame-Options']).toBe('SAMEORIGIN');
    });

    it('should have correct X-Content-Type-Options value', () => {
      const headers = getSecurityHeaders();
      expect(headers['X-Content-Type-Options']).toBe('nosniff');
    });

    it('should include CSP with proper directives', () => {
      const headers = getSecurityHeaders();
      const csp = headers['Content-Security-Policy'];
      
      expect(csp).toContain("default-src 'self'");
      expect(csp).toContain("script-src");
      expect(csp).toContain("style-src");
      expect(csp).toContain("connect-src");
    });

    it('should include HSTS header', () => {
      const headers = getSecurityHeaders();
      const hsts = headers['Strict-Transport-Security'];
      
      expect(hsts).toContain('max-age=31536000');
      expect(hsts).toContain('includeSubDomains');
      expect(hsts).toContain('preload');
    });
  });

  describe('validateSecurityHeaders', () => {
    it('should validate headers with all required fields', () => {
      const headers = new Headers();
      headers.set('X-Frame-Options', 'SAMEORIGIN');
      headers.set('X-Content-Type-Options', 'nosniff');
      headers.set('Strict-Transport-Security', 'max-age=31536000');

      const result = validateSecurityHeaders(headers);
      
      expect(result.valid).toBe(true);
      expect(result.missing).toHaveLength(0);
    });

    it('should detect missing headers', () => {
      const headers = new Headers();
      headers.set('X-Frame-Options', 'SAMEORIGIN');
      // Missing X-Content-Type-Options and Strict-Transport-Security

      const result = validateSecurityHeaders(headers);
      
      expect(result.valid).toBe(false);
      expect(result.missing).toContain('X-Content-Type-Options');
      expect(result.missing).toContain('Strict-Transport-Security');
    });
  });

  describe('getSecurityMetaTags', () => {
    it('should return security meta tags', () => {
      const metaTags = getSecurityMetaTags();

      expect(Array.isArray(metaTags)).toBe(true);
      expect(metaTags.length).toBeGreaterThan(0);
      
      metaTags.forEach(tag => {
        expect(tag).toHaveProperty('name');
        expect(tag).toHaveProperty('content');
      });
    });

    it('should include referrer policy', () => {
      const metaTags = getSecurityMetaTags();
      const referrerTag = metaTags.find(tag => tag.name === 'referrer');
      
      expect(referrerTag).toBeDefined();
      expect(referrerTag?.content).toBe('strict-origin-when-cross-origin');
    });
  });
});

