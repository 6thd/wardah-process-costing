/**
 * Alert Component Tests
 * ======================
 * Tests for the Alert UI component and its sub-components
 * 
 * @module components/ui/__tests__/alert.test
 * @created 18 December 2025
 */

import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Alert, AlertTitle, AlertDescription, alertVariants } from '../alert'
import { AlertCircle, CheckCircle } from 'lucide-react'

describe('Alert Component', () => {
  describe('Alert', () => {
    it('should render alert with children', () => {
      render(<Alert>Alert content</Alert>)
      expect(screen.getByRole('alert')).toHaveTextContent('Alert content')
    })

    it('should have role="alert"', () => {
      render(<Alert>Alert</Alert>)
      expect(screen.getByRole('alert')).toBeInTheDocument()
    })

    it('should forward ref correctly', () => {
      const ref = { current: null as HTMLDivElement | null }
      render(<Alert ref={ref}>Alert</Alert>)
      expect(ref.current).toBeInstanceOf(HTMLDivElement)
    })

    it('should have correct display name', () => {
      expect(Alert.displayName).toBe('Alert')
    })

    it('should merge custom className', () => {
      render(<Alert className="custom-alert">Alert</Alert>)
      expect(screen.getByRole('alert')).toHaveClass('custom-alert')
    })
  })

  describe('Alert Variants', () => {
    it('should render default variant', () => {
      render(<Alert variant="default">Default Alert</Alert>)
      const alert = screen.getByRole('alert')
      expect(alert).toHaveClass('bg-background', 'text-foreground')
    })

    it('should render destructive variant', () => {
      render(<Alert variant="destructive">Error Alert</Alert>)
      const alert = screen.getByRole('alert')
      expect(alert).toHaveClass('border-destructive/50', 'text-destructive')
    })
  })

  describe('AlertTitle', () => {
    it('should render title text', () => {
      render(<AlertTitle>Alert Title</AlertTitle>)
      expect(screen.getByText('Alert Title')).toBeInTheDocument()
    })

    it('should have correct display name', () => {
      expect(AlertTitle.displayName).toBe('AlertTitle')
    })

    it('should render as h5', () => {
      render(<AlertTitle data-testid="title">Title</AlertTitle>)
      expect(screen.getByTestId('title').tagName).toBe('H5')
    })

    it('should have gradient text class', () => {
      render(<AlertTitle data-testid="title">Title</AlertTitle>)
      expect(screen.getByTestId('title')).toHaveClass('wardah-text-gradient-google')
    })

    it('should render non-breaking space when empty', () => {
      render(<AlertTitle data-testid="title" />)
      expect(screen.getByTestId('title').textContent).toBe('\u00A0')
    })

    it('should forward ref correctly', () => {
      const ref = { current: null as HTMLParagraphElement | null }
      render(<AlertTitle ref={ref}>Title</AlertTitle>)
      expect(ref.current).toBeInstanceOf(HTMLHeadingElement)
    })

    it('should merge custom className', () => {
      render(<AlertTitle className="custom-title" data-testid="title">Title</AlertTitle>)
      expect(screen.getByTestId('title')).toHaveClass('custom-title')
    })
  })

  describe('AlertDescription', () => {
    it('should render description text', () => {
      render(<AlertDescription>This is a description</AlertDescription>)
      expect(screen.getByText('This is a description')).toBeInTheDocument()
    })

    it('should have correct display name', () => {
      expect(AlertDescription.displayName).toBe('AlertDescription')
    })

    it('should have text styling', () => {
      render(<AlertDescription data-testid="desc">Description</AlertDescription>)
      expect(screen.getByTestId('desc')).toHaveClass('text-sm')
    })

    it('should forward ref correctly', () => {
      const ref = { current: null as HTMLParagraphElement | null }
      render(<AlertDescription ref={ref}>Description</AlertDescription>)
      expect(ref.current).toBeInstanceOf(HTMLDivElement)
    })

    it('should merge custom className', () => {
      render(<AlertDescription className="custom-desc" data-testid="desc">Description</AlertDescription>)
      expect(screen.getByTestId('desc')).toHaveClass('custom-desc')
    })
  })

  describe('Alert Composition', () => {
    it('should render complete alert with title and description', () => {
      render(
        <Alert>
          <AlertTitle>Success!</AlertTitle>
          <AlertDescription>Your action was completed successfully.</AlertDescription>
        </Alert>
      )

      expect(screen.getByRole('alert')).toBeInTheDocument()
      expect(screen.getByText('Success!')).toBeInTheDocument()
      expect(screen.getByText('Your action was completed successfully.')).toBeInTheDocument()
    })

    it('should render alert with icon', () => {
      render(
        <Alert>
          <AlertCircle data-testid="icon" className="h-4 w-4" />
          <AlertTitle>Info</AlertTitle>
          <AlertDescription>This is an informational message.</AlertDescription>
        </Alert>
      )

      expect(screen.getByTestId('icon')).toBeInTheDocument()
    })

    it('should render destructive alert with icon', () => {
      render(
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Error</AlertTitle>
          <AlertDescription>Something went wrong.</AlertDescription>
        </Alert>
      )

      expect(screen.getByRole('alert')).toHaveClass('text-destructive')
    })

    it('should render success alert pattern', () => {
      render(
        <Alert>
          <CheckCircle data-testid="check-icon" className="h-4 w-4" />
          <AlertTitle>Saved!</AlertTitle>
          <AlertDescription>Your changes have been saved.</AlertDescription>
        </Alert>
      )

      expect(screen.getByTestId('check-icon')).toBeInTheDocument()
      expect(screen.getByText('Saved!')).toBeInTheDocument()
    })
  })

  describe('alertVariants utility', () => {
    it('should generate correct classes for default variant', () => {
      const classes = alertVariants({ variant: 'default' })
      expect(classes).toContain('bg-background')
    })

    it('should generate correct classes for destructive variant', () => {
      const classes = alertVariants({ variant: 'destructive' })
      expect(classes).toContain('text-destructive')
    })
  })

  describe('Accessibility', () => {
    it('should have correct role', () => {
      render(<Alert>Accessible Alert</Alert>)
      expect(screen.getByRole('alert')).toBeInTheDocument()
    })

    it('should support aria-live', () => {
      render(<Alert aria-live="polite">Live Alert</Alert>)
      expect(screen.getByRole('alert')).toHaveAttribute('aria-live', 'polite')
    })

    it('should support aria-labelledby', () => {
      render(
        <Alert aria-labelledby="alert-title">
          <AlertTitle id="alert-title">Alert Title</AlertTitle>
        </Alert>
      )
      expect(screen.getByRole('alert')).toHaveAttribute('aria-labelledby', 'alert-title')
    })
  })

  describe('HTML attributes', () => {
    it('should pass through data attributes', () => {
      render(<Alert data-testid="alert" data-type="info">Alert</Alert>)
      expect(screen.getByTestId('alert')).toHaveAttribute('data-type', 'info')
    })

    it('should pass through id attribute', () => {
      render(<Alert id="main-alert">Alert</Alert>)
      expect(screen.getByRole('alert')).toHaveAttribute('id', 'main-alert')
    })
  })
})
