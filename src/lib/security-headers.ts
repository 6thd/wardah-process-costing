/**
 * Security Headers Configuration
 * 
 * Provides security headers for API responses and HTML pages
 */

export interface SecurityHeaders {
  [key: string]: string;
}

/**
 * Get security headers for API responses
 */
export function getSecurityHeaders(): SecurityHeaders {
  return {
    'Content-Security-Policy': [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://cdn.tailwindcss.com https://cdn.jsdelivr.net https://cdnjs.cloudflare.com",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://cdnjs.cloudflare.com",
      "font-src 'self' https://fonts.gstatic.com https://cdnjs.cloudflare.com",
      "img-src 'self' data: https:",
      "connect-src 'self' https://*.supabase.co wss://*.supabase.co",
      "frame-src 'self'",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "frame-ancestors 'self'",
      "upgrade-insecure-requests",
    ].join('; '),
    
    'X-Frame-Options': 'SAMEORIGIN',
    'X-Content-Type-Options': 'nosniff',
    'X-XSS-Protection': '1; mode=block',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=()',
    'Strict-Transport-Security': 'max-age=31536000; includeSubDomains; preload',
  };
}

/**
 * Apply security headers to response (for server-side)
 */
export function applySecurityHeaders(headers: Headers): void {
  const securityHeaders = getSecurityHeaders();
  
  Object.entries(securityHeaders).forEach(([key, value]) => {
    headers.set(key, value);
  });
}

/**
 * Get meta tags for HTML (for client-side)
 */
export function getSecurityMetaTags(): Array<{ name: string; content: string }> {
  return [
    { name: 'referrer', content: 'strict-origin-when-cross-origin' },
    { name: 'X-UA-Compatible', content: 'IE=edge' },
  ];
}

/**
 * Validate security headers in response
 */
export function validateSecurityHeaders(headers: Headers): {
  valid: boolean;
  missing: string[];
} {
  const required = [
    'X-Frame-Options',
    'X-Content-Type-Options',
    'Strict-Transport-Security',
  ];

  const missing: string[] = [];

  required.forEach((header) => {
    if (!headers.has(header)) {
      missing.push(header);
    }
  });

  return {
    valid: missing.length === 0,
    missing,
  };
}

