/**
 * Integration tests for lib/rate-limiter.ts
 * 
 * Tests the RateLimiter class functionality including:
 * - Basic rate limiting
 * - Window expiration
 * - Action-specific limits
 * - User reset functionality
 * - Status checking
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { RateLimiter } from '../rate-limiter'

describe('Integration: lib/rate-limiter', () => {
  let limiter: RateLimiter

  beforeEach(() => {
    vi.useFakeTimers()
    limiter = new RateLimiter()
  })

  afterEach(() => {
    limiter.destroy()
    vi.useRealTimers()
  })

  describe('checkLimit()', () => {
    it('should allow first request', async () => {
      const result = await limiter.checkLimit('user1', 'action1', 5, 60)
      
      expect(result.allowed).toBe(true)
      expect(result.remaining).toBe(4)
      expect(result.resetAt).toBeInstanceOf(Date)
    })

    it('should decrement remaining on each request', async () => {
      const result1 = await limiter.checkLimit('user1', 'action1', 5, 60)
      const result2 = await limiter.checkLimit('user1', 'action1', 5, 60)
      const result3 = await limiter.checkLimit('user1', 'action1', 5, 60)
      
      expect(result1.remaining).toBe(4)
      expect(result2.remaining).toBe(3)
      expect(result3.remaining).toBe(2)
    })

    it('should block when limit is reached', async () => {
      // Use up all requests
      for (let i = 0; i < 5; i++) {
        await limiter.checkLimit('user1', 'action1', 5, 60)
      }
      
      const result = await limiter.checkLimit('user1', 'action1', 5, 60)
      
      expect(result.allowed).toBe(false)
      expect(result.remaining).toBe(0)
    })

    it('should separate limits for different users', async () => {
      // Use up all requests for user1
      for (let i = 0; i < 5; i++) {
        await limiter.checkLimit('user1', 'action1', 5, 60)
      }
      
      // user2 should still be allowed
      const result = await limiter.checkLimit('user2', 'action1', 5, 60)
      
      expect(result.allowed).toBe(true)
      expect(result.remaining).toBe(4)
    })

    it('should separate limits for different actions', async () => {
      // Use up all requests for action1
      for (let i = 0; i < 5; i++) {
        await limiter.checkLimit('user1', 'action1', 5, 60)
      }
      
      // action2 should still be allowed
      const result = await limiter.checkLimit('user1', 'action2', 5, 60)
      
      expect(result.allowed).toBe(true)
      expect(result.remaining).toBe(4)
    })

    it('should reset after window expires', async () => {
      // Use up all requests
      for (let i = 0; i < 5; i++) {
        await limiter.checkLimit('user1', 'action1', 5, 60)
      }
      
      // Verify blocked
      let result = await limiter.checkLimit('user1', 'action1', 5, 60)
      expect(result.allowed).toBe(false)
      
      // Advance time past window
      vi.advanceTimersByTime(61 * 1000)
      
      // Should be allowed again
      result = await limiter.checkLimit('user1', 'action1', 5, 60)
      expect(result.allowed).toBe(true)
      expect(result.remaining).toBe(4)
    })

    it('should use correct reset time', async () => {
      const now = Date.now()
      vi.setSystemTime(now)
      
      const result = await limiter.checkLimit('user1', 'action1', 5, 60)
      
      const expectedResetAt = new Date(now + 60 * 1000)
      expect(result.resetAt.getTime()).toBe(expectedResetAt.getTime())
    })
  })

  describe('checkActionLimit()', () => {
    it('should use auth.login config (5 per 5 minutes)', async () => {
      // Use up all login attempts
      for (let i = 0; i < 5; i++) {
        await limiter.checkActionLimit('user1', 'auth.login')
      }
      
      const result = await limiter.checkActionLimit('user1', 'auth.login')
      
      expect(result.allowed).toBe(false)
    })

    it('should use auth.signup config (3 per hour)', async () => {
      // Use up all signup attempts
      for (let i = 0; i < 3; i++) {
        await limiter.checkActionLimit('user1', 'auth.signup')
      }
      
      const result = await limiter.checkActionLimit('user1', 'auth.signup')
      
      expect(result.allowed).toBe(false)
    })

    it('should use api.general config for unknown actions (1000 per minute)', async () => {
      // First request for unknown action
      const result = await limiter.checkActionLimit('user1', 'unknown.action')
      
      expect(result.allowed).toBe(true)
      expect(result.remaining).toBe(999) // 1000 - 1
    })

    it('should use reports.generate config (20 per minute)', async () => {
      // Use up all report generations
      for (let i = 0; i < 20; i++) {
        await limiter.checkActionLimit('user1', 'reports.generate')
      }
      
      const result = await limiter.checkActionLimit('user1', 'reports.generate')
      
      expect(result.allowed).toBe(false)
    })

    it('should use reports.export config (10 per 5 minutes)', async () => {
      // Use up all exports
      for (let i = 0; i < 10; i++) {
        await limiter.checkActionLimit('user1', 'reports.export')
      }
      
      const result = await limiter.checkActionLimit('user1', 'reports.export')
      
      expect(result.allowed).toBe(false)
    })
  })

  describe('reset()', () => {
    it('should reset limit for specific user/action', async () => {
      // Use up all requests
      for (let i = 0; i < 5; i++) {
        await limiter.checkLimit('user1', 'action1', 5, 60)
      }
      
      // Verify blocked
      let result = await limiter.checkLimit('user1', 'action1', 5, 60)
      expect(result.allowed).toBe(false)
      
      // Reset
      limiter.reset('user1', 'action1')
      
      // Should be allowed again
      result = await limiter.checkLimit('user1', 'action1', 5, 60)
      expect(result.allowed).toBe(true)
      expect(result.remaining).toBe(4)
    })

    it('should not affect other user/action combinations', async () => {
      // Set up limits for multiple combinations
      await limiter.checkLimit('user1', 'action1', 5, 60)
      await limiter.checkLimit('user1', 'action2', 5, 60)
      await limiter.checkLimit('user2', 'action1', 5, 60)
      
      // Reset only user1/action1
      limiter.reset('user1', 'action1')
      
      // user1/action2 should still have count
      const result1 = await limiter.checkLimit('user1', 'action2', 5, 60)
      expect(result1.remaining).toBe(3) // 5 - 2 (original + this check)
      
      // user2/action1 should still have count
      const result2 = await limiter.checkLimit('user2', 'action1', 5, 60)
      expect(result2.remaining).toBe(3)
    })
  })

  describe('resetUser()', () => {
    it('should reset all limits for a user', async () => {
      // Set up limits for multiple actions
      for (let i = 0; i < 5; i++) {
        await limiter.checkLimit('user1', 'action1', 5, 60)
        await limiter.checkLimit('user1', 'action2', 5, 60)
      }
      
      // Verify blocked
      expect((await limiter.checkLimit('user1', 'action1', 5, 60)).allowed).toBe(false)
      expect((await limiter.checkLimit('user1', 'action2', 5, 60)).allowed).toBe(false)
      
      // Reset user
      limiter.resetUser('user1')
      
      // Should be allowed for all actions
      expect((await limiter.checkLimit('user1', 'action1', 5, 60)).allowed).toBe(true)
      expect((await limiter.checkLimit('user1', 'action2', 5, 60)).allowed).toBe(true)
    })

    it('should not affect other users', async () => {
      // Set up limits
      await limiter.checkLimit('user1', 'action1', 5, 60)
      await limiter.checkLimit('user2', 'action1', 5, 60)
      
      // Reset user1
      limiter.resetUser('user1')
      
      // user2 should still have count
      const result = await limiter.checkLimit('user2', 'action1', 5, 60)
      expect(result.remaining).toBe(3) // 5 - 2
    })
  })

  describe('getStatus()', () => {
    it('should return null for unknown user/action', () => {
      const status = limiter.getStatus('unknown', 'action')
      
      expect(status).toBeNull()
    })

    it('should return current status for active limit', async () => {
      await limiter.checkLimit('user1', 'action1', 5, 60)
      await limiter.checkLimit('user1', 'action1', 5, 60)
      
      const status = limiter.getStatus('user1', 'action1')
      
      expect(status).not.toBeNull()
      expect(status!.allowed).toBe(true)
      expect(status!.remaining).toBe(2) // count is stored, not remaining
    })

    it('should return null after window expires', async () => {
      await limiter.checkLimit('user1', 'action1', 5, 60)
      
      // Advance time past window
      vi.advanceTimersByTime(61 * 1000)
      
      const status = limiter.getStatus('user1', 'action1')
      
      expect(status).toBeNull()
    })
  })

  describe('destroy()', () => {
    it('should clear all limits', async () => {
      await limiter.checkLimit('user1', 'action1', 5, 60)
      await limiter.checkLimit('user2', 'action2', 5, 60)
      
      limiter.destroy()
      
      // All limits should be cleared
      expect(limiter.getStatus('user1', 'action1')).toBeNull()
      expect(limiter.getStatus('user2', 'action2')).toBeNull()
    })
  })

  describe('Concurrent requests', () => {
    it('should handle concurrent requests correctly', async () => {
      const promises = []
      for (let i = 0; i < 10; i++) {
        promises.push(limiter.checkLimit('user1', 'action1', 5, 60))
      }
      
      const results = await Promise.all(promises)
      
      // First 5 should be allowed
      const allowedCount = results.filter(r => r.allowed).length
      expect(allowedCount).toBe(5)
      
      // Last 5 should be blocked
      const blockedCount = results.filter(r => !r.allowed).length
      expect(blockedCount).toBe(5)
    })
  })

  describe('Edge cases', () => {
    it('should handle limit of 1', async () => {
      const result1 = await limiter.checkLimit('user1', 'action1', 1, 60)
      const result2 = await limiter.checkLimit('user1', 'action1', 1, 60)
      
      expect(result1.allowed).toBe(true)
      expect(result1.remaining).toBe(0)
      expect(result2.allowed).toBe(false)
    })

    it('should handle very short window (1 second)', async () => {
      const result1 = await limiter.checkLimit('user1', 'action1', 2, 1)
      
      expect(result1.allowed).toBe(true)
      
      // Advance 1.1 seconds
      vi.advanceTimersByTime(1100)
      
      const result2 = await limiter.checkLimit('user1', 'action1', 2, 1)
      
      expect(result2.allowed).toBe(true)
      expect(result2.remaining).toBe(1) // Fresh window
    })

    it('should handle empty string user ID', async () => {
      const result = await limiter.checkLimit('', 'action1', 5, 60)
      
      expect(result.allowed).toBe(true)
    })

    it('should handle special characters in action name', async () => {
      const result = await limiter.checkLimit('user1', 'api/v2/create:item', 5, 60)
      
      expect(result.allowed).toBe(true)
      expect(result.remaining).toBe(4)
    })
  })
})
