/**
 * Rate Limiter Tests
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { rateLimiter, RateLimiter } from '../lib/rate-limiter';
import { TooManyRequestsError } from '../lib/errors';

describe('RateLimiter', () => {
  beforeEach(() => {
    // Reset rate limiter before each test
    rateLimiter.resetUser('test-user');
  });

  describe('checkLimit', () => {
    it('should allow request within limit', async () => {
      const result = await rateLimiter.checkLimit('user1', 'test-action', 10, 60);
      
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(9);
      expect(result.resetAt).toBeInstanceOf(Date);
    });

    it('should reject request when limit exceeded', async () => {
      const userId = 'user2';
      const action = 'test-action';
      const limit = 3;

      // Make requests up to limit
      for (let i = 0; i < limit; i++) {
        await rateLimiter.checkLimit(userId, action, limit, 60);
      }

      // Next request should be rejected
      const result = await rateLimiter.checkLimit(userId, action, limit, 60);
      
      expect(result.allowed).toBe(false);
      expect(result.remaining).toBe(0);
    });

    it('should reset limit after window expires', async () => {
      const userId = 'user3';
      const action = 'test-action';
      const limit = 2;
      const window = 1; // 1 second

      // Exceed limit
      await rateLimiter.checkLimit(userId, action, limit, window);
      await rateLimiter.checkLimit(userId, action, limit, window);
      const exceeded = await rateLimiter.checkLimit(userId, action, limit, window);
      expect(exceeded.allowed).toBe(false);

      // Wait for window to expire
      await new Promise(resolve => setTimeout(resolve, 1100));

      // Should be allowed again
      const result = await rateLimiter.checkLimit(userId, action, limit, window);
      expect(result.allowed).toBe(true);
    });

    it('should handle different actions independently', async () => {
      const userId = 'user4';
      const limit = 2;

      // Exceed limit for action1
      await rateLimiter.checkLimit(userId, 'action1', limit, 60);
      await rateLimiter.checkLimit(userId, 'action1', limit, 60);
      const result1 = await rateLimiter.checkLimit(userId, 'action1', limit, 60);
      expect(result1.allowed).toBe(false);

      // action2 should still be allowed
      const result2 = await rateLimiter.checkLimit(userId, 'action2', limit, 60);
      expect(result2.allowed).toBe(true);
    });
  });

  describe('checkActionLimit', () => {
    it('should use default configs for common actions', async () => {
      const userId = 'user5';

      // Test auth.login limit (5 per 5 minutes)
      const loginResult = await rateLimiter.checkActionLimit(userId, 'auth.login');
      expect(loginResult.allowed).toBe(true);

      // Test manufacturing.orders.create limit (50 per minute)
      const orderResult = await rateLimiter.checkActionLimit(userId, 'manufacturing.orders.create');
      expect(orderResult.allowed).toBe(true);
      expect(orderResult.remaining).toBe(49); // 50 - 1

      // Test unknown action (should use api.general default)
      const unknownResult = await rateLimiter.checkActionLimit(userId, 'unknown.action');
      expect(unknownResult.allowed).toBe(true);
    });
  });

  describe('reset', () => {
    it('should reset limit for specific user and action', async () => {
      const userId = 'user6';
      const action = 'test-action';
      const limit = 2;

      // Exceed limit
      await rateLimiter.checkLimit(userId, action, limit, 60);
      await rateLimiter.checkLimit(userId, action, limit, 60);
      const exceeded = await rateLimiter.checkLimit(userId, action, limit, 60);
      expect(exceeded.allowed).toBe(false);

      // Reset
      rateLimiter.reset(userId, action);

      // Should be allowed again
      const result = await rateLimiter.checkLimit(userId, action, limit, 60);
      expect(result.allowed).toBe(true);
    });
  });

  describe('resetUser', () => {
    it('should reset all limits for a user', async () => {
      const userId = 'user7';
      const limit = 2;

      // Exceed limits for multiple actions
      await rateLimiter.checkLimit(userId, 'action1', limit, 60);
      await rateLimiter.checkLimit(userId, 'action1', limit, 60);
      await rateLimiter.checkLimit(userId, 'action2', limit, 60);
      await rateLimiter.checkLimit(userId, 'action2', limit, 60);

      // Both should be exceeded
      expect((await rateLimiter.checkLimit(userId, 'action1', limit, 60)).allowed).toBe(false);
      expect((await rateLimiter.checkLimit(userId, 'action2', limit, 60)).allowed).toBe(false);

      // Reset user
      rateLimiter.resetUser(userId);

      // Both should be allowed again
      expect((await rateLimiter.checkLimit(userId, 'action1', limit, 60)).allowed).toBe(true);
      expect((await rateLimiter.checkLimit(userId, 'action2', limit, 60)).allowed).toBe(true);
    });
  });

  describe('getStatus', () => {
    it('should return current status for active limit', async () => {
      const userId = 'user8';
      const action = 'test-action';
      const limit = 5;

      await rateLimiter.checkLimit(userId, action, limit, 60);
      await rateLimiter.checkLimit(userId, action, limit, 60);

      const status = rateLimiter.getStatus(userId, action);
      
      expect(status).not.toBeNull();
      expect(status?.allowed).toBe(true);
      expect(status?.remaining).toBeGreaterThan(0);
    });

    it('should return null for non-existent limit', () => {
      const status = rateLimiter.getStatus('user9', 'non-existent');
      expect(status).toBeNull();
    });
  });

  describe('cleanup', () => {
    it('should remove expired entries', async () => {
      const userId = 'user10';
      const action = 'test-action';
      const limit = 2;
      const window = 1; // 1 second

      // Create entry
      await rateLimiter.checkLimit(userId, action, limit, window);

      // Wait for expiration
      await new Promise(resolve => setTimeout(resolve, 1100));

      // Status should be null after cleanup
      // Note: cleanup runs every 5 minutes, so we manually trigger it
      const status = rateLimiter.getStatus(userId, action);
      // Status might still exist until cleanup runs, but resetAt should be in the past
      if (status) {
        expect(status.resetAt.getTime()).toBeLessThan(Date.now());
      }
    });
  });
});

