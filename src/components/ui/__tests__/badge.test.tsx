/**
 * Badge Component Tests
 * ======================
 * Tests for the Badge UI component variants
 * 
 * @module components/ui/__tests__/badge.test
 * @created 18 December 2025
 */

import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Badge, badgeVariants } from '../badge'

describe('Badge Component', () => {
  describe('Rendering', () => {
    it('should render badge with text', () => {
      render(<Badge>New</Badge>)
      expect(screen.getByText('New')).toBeInTheDocument()
    })

    it('should render badge with children', () => {
      render(<Badge><span data-testid="icon">🔥</span> Hot</Badge>)
      expect(screen.getByTestId('icon')).toBeInTheDocument()
      expect(screen.getByText('Hot')).toBeInTheDocument()
    })

    it('should merge custom className', () => {
      render(<Badge className="custom-badge" data-testid="badge">Badge</Badge>)
      expect(screen.getByTestId('badge')).toHaveClass('custom-badge')
    })
  })

  describe('Variants', () => {
    it('should render default variant', () => {
      render(<Badge variant="default" data-testid="badge">Default</Badge>)
      const badge = screen.getByTestId('badge')
      expect(badge).toHaveClass('bg-primary', 'text-primary-foreground')
    })

    it('should render secondary variant', () => {
      render(<Badge variant="secondary" data-testid="badge">Secondary</Badge>)
      const badge = screen.getByTestId('badge')
      expect(badge).toHaveClass('bg-secondary', 'text-secondary-foreground')
    })

    it('should render destructive variant', () => {
      render(<Badge variant="destructive" data-testid="badge">Error</Badge>)
      const badge = screen.getByTestId('badge')
      expect(badge).toHaveClass('bg-destructive', 'text-destructive-foreground')
    })

    it('should render outline variant', () => {
      render(<Badge variant="outline" data-testid="badge">Outline</Badge>)
      const badge = screen.getByTestId('badge')
      expect(badge).toHaveClass('text-foreground')
    })

    it('should render success variant', () => {
      render(<Badge variant="success" data-testid="badge">Success</Badge>)
      const badge = screen.getByTestId('badge')
      expect(badge).toHaveClass('bg-success', 'text-success-foreground')
    })

    it('should render warning variant', () => {
      render(<Badge variant="warning" data-testid="badge">Warning</Badge>)
      const badge = screen.getByTestId('badge')
      expect(badge).toHaveClass('bg-warning', 'text-warning-foreground')
    })

    it('should render info variant', () => {
      render(<Badge variant="info" data-testid="badge">Info</Badge>)
      const badge = screen.getByTestId('badge')
      expect(badge).toHaveClass('bg-info', 'text-info-foreground')
    })
  })

  describe('Base Styling', () => {
    it('should have rounded-full class', () => {
      render(<Badge data-testid="badge">Badge</Badge>)
      expect(screen.getByTestId('badge')).toHaveClass('rounded-full')
    })

    it('should have inline-flex class', () => {
      render(<Badge data-testid="badge">Badge</Badge>)
      expect(screen.getByTestId('badge')).toHaveClass('inline-flex')
    })

    it('should have border class', () => {
      render(<Badge data-testid="badge">Badge</Badge>)
      expect(screen.getByTestId('badge')).toHaveClass('border')
    })

    it('should have proper padding', () => {
      render(<Badge data-testid="badge">Badge</Badge>)
      expect(screen.getByTestId('badge')).toHaveClass('px-2.5', 'py-0.5')
    })

    it('should have font styling', () => {
      render(<Badge data-testid="badge">Badge</Badge>)
      expect(screen.getByTestId('badge')).toHaveClass('text-xs', 'font-semibold')
    })

    it('should have transition classes', () => {
      render(<Badge data-testid="badge">Badge</Badge>)
      expect(screen.getByTestId('badge')).toHaveClass('transition-colors')
    })

    it('should have focus styles', () => {
      render(<Badge data-testid="badge">Badge</Badge>)
      expect(screen.getByTestId('badge')).toHaveClass('focus:outline-none', 'focus:ring-2')
    })
  })

  describe('badgeVariants utility', () => {
    it('should generate correct classes for default variant', () => {
      const classes = badgeVariants({ variant: 'default' })
      expect(classes).toContain('bg-primary')
      expect(classes).toContain('text-primary-foreground')
    })

    it('should generate correct classes for destructive variant', () => {
      const classes = badgeVariants({ variant: 'destructive' })
      expect(classes).toContain('bg-destructive')
    })

    it('should generate correct classes for success variant', () => {
      const classes = badgeVariants({ variant: 'success' })
      expect(classes).toContain('bg-success')
    })

    it('should include base classes', () => {
      const classes = badgeVariants()
      expect(classes).toContain('inline-flex')
      expect(classes).toContain('rounded-full')
    })
  })

  describe('Use Cases', () => {
    it('should render status badge', () => {
      render(<Badge variant="success">Active</Badge>)
      expect(screen.getByText('Active')).toBeInTheDocument()
    })

    it('should render count badge', () => {
      render(<Badge>5</Badge>)
      expect(screen.getByText('5')).toBeInTheDocument()
    })

    it('should render label badge', () => {
      render(<Badge variant="secondary">New Feature</Badge>)
      expect(screen.getByText('New Feature')).toBeInTheDocument()
    })

    it('should render error badge', () => {
      render(<Badge variant="destructive">Error</Badge>)
      expect(screen.getByText('Error')).toBeInTheDocument()
    })

    it('should render notification badge', () => {
      render(<Badge variant="info">3 new messages</Badge>)
      expect(screen.getByText('3 new messages')).toBeInTheDocument()
    })
  })

  describe('HTML attributes', () => {
    it('should pass through data attributes', () => {
      render(<Badge data-testid="badge" data-status="active">Badge</Badge>)
      expect(screen.getByTestId('badge')).toHaveAttribute('data-status', 'active')
    })

    it('should pass through id attribute', () => {
      render(<Badge id="status-badge" data-testid="badge">Badge</Badge>)
      expect(screen.getByTestId('badge')).toHaveAttribute('id', 'status-badge')
    })

    it('should pass through onClick handler', () => {
      const handleClick = vi.fn()
      render(<Badge onClick={handleClick} data-testid="badge">Clickable</Badge>)
      screen.getByTestId('badge').click()
      expect(handleClick).toHaveBeenCalled()
    })
  })

  describe('Accessibility', () => {
    it('should support role attribute', () => {
      render(<Badge role="status" data-testid="badge">Status</Badge>)
      expect(screen.getByRole('status')).toBeInTheDocument()
    })

    it('should support aria-label', () => {
      render(<Badge aria-label="5 unread notifications" data-testid="badge">5</Badge>)
      expect(screen.getByTestId('badge')).toHaveAttribute('aria-label', '5 unread notifications')
    })
  })
})

// Need to import vi
import { vi } from 'vitest'
