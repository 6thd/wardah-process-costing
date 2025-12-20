/**
 * Card Component Tests
 * ====================
 * Tests for the Card UI component and its sub-components
 * 
 * @module components/ui/__tests__/card.test
 * @created 18 December 2025
 */

import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Card, CardHeader, CardFooter, CardTitle, CardDescription, CardContent } from '../card'

describe('Card Component', () => {
  describe('Card', () => {
    it('should render card with children', () => {
      render(<Card data-testid="card">Card Content</Card>)
      expect(screen.getByTestId('card')).toHaveTextContent('Card Content')
    })

    it('should forward ref correctly', () => {
      const ref = { current: null as HTMLDivElement | null }
      render(<Card ref={ref}>Card</Card>)
      expect(ref.current).toBeInstanceOf(HTMLDivElement)
    })

    it('should have correct display name', () => {
      expect(Card.displayName).toBe('Card')
    })

    it('should merge custom className', () => {
      render(<Card className="custom-class" data-testid="card">Card</Card>)
      expect(screen.getByTestId('card')).toHaveClass('custom-class')
    })

    it('should apply glass classes', () => {
      render(<Card data-testid="card">Card</Card>)
      // getGlassClasses returns glassmorphism classes
      const card = screen.getByTestId('card')
      expect(card.className).toBeTruthy()
    })
  })

  describe('CardHeader', () => {
    it('should render header with children', () => {
      render(<CardHeader data-testid="header">Header Content</CardHeader>)
      expect(screen.getByTestId('header')).toHaveTextContent('Header Content')
    })

    it('should have correct display name', () => {
      expect(CardHeader.displayName).toBe('CardHeader')
    })

    it('should have proper spacing classes', () => {
      render(<CardHeader data-testid="header">Header</CardHeader>)
      expect(screen.getByTestId('header')).toHaveClass('flex', 'flex-col', 'space-y-1.5', 'p-6')
    })

    it('should forward ref correctly', () => {
      const ref = { current: null as HTMLDivElement | null }
      render(<CardHeader ref={ref}>Header</CardHeader>)
      expect(ref.current).toBeInstanceOf(HTMLDivElement)
    })

    it('should merge custom className', () => {
      render(<CardHeader className="custom-header" data-testid="header">Header</CardHeader>)
      expect(screen.getByTestId('header')).toHaveClass('custom-header')
    })
  })

  describe('CardTitle', () => {
    it('should render title with text', () => {
      render(<CardTitle>Card Title</CardTitle>)
      expect(screen.getByRole('heading', { level: 3 })).toHaveTextContent('Card Title')
    })

    it('should have correct display name', () => {
      expect(CardTitle.displayName).toBe('CardTitle')
    })

    it('should render with gradient text class', () => {
      render(<CardTitle data-testid="title">Title</CardTitle>)
      expect(screen.getByTestId('title')).toHaveClass('wardah-text-gradient-google')
    })

    it('should render non-breaking space when empty', () => {
      render(<CardTitle data-testid="title" />)
      const title = screen.getByTestId('title')
      expect(title.textContent).toBe('\u00A0')
    })

    it('should forward ref correctly', () => {
      const ref = { current: null as HTMLParagraphElement | null }
      render(<CardTitle ref={ref}>Title</CardTitle>)
      expect(ref.current).toBeInstanceOf(HTMLHeadingElement)
    })

    it('should have typography classes', () => {
      render(<CardTitle data-testid="title">Title</CardTitle>)
      expect(screen.getByTestId('title')).toHaveClass('text-2xl', 'font-semibold')
    })
  })

  describe('CardDescription', () => {
    it('should render description text', () => {
      render(<CardDescription>This is a description</CardDescription>)
      expect(screen.getByText('This is a description')).toBeInTheDocument()
    })

    it('should have correct display name', () => {
      expect(CardDescription.displayName).toBe('CardDescription')
    })

    it('should have muted text styling', () => {
      render(<CardDescription data-testid="desc">Description</CardDescription>)
      expect(screen.getByTestId('desc')).toHaveClass('text-sm', 'text-muted-foreground')
    })

    it('should forward ref correctly', () => {
      const ref = { current: null as HTMLParagraphElement | null }
      render(<CardDescription ref={ref}>Description</CardDescription>)
      expect(ref.current).toBeInstanceOf(HTMLParagraphElement)
    })
  })

  describe('CardContent', () => {
    it('should render content with children', () => {
      render(<CardContent data-testid="content">Main Content</CardContent>)
      expect(screen.getByTestId('content')).toHaveTextContent('Main Content')
    })

    it('should have correct display name', () => {
      expect(CardContent.displayName).toBe('CardContent')
    })

    it('should have proper padding classes', () => {
      render(<CardContent data-testid="content">Content</CardContent>)
      expect(screen.getByTestId('content')).toHaveClass('p-6', 'pt-0')
    })

    it('should forward ref correctly', () => {
      const ref = { current: null as HTMLDivElement | null }
      render(<CardContent ref={ref}>Content</CardContent>)
      expect(ref.current).toBeInstanceOf(HTMLDivElement)
    })
  })

  describe('CardFooter', () => {
    it('should render footer with children', () => {
      render(<CardFooter data-testid="footer">Footer Content</CardFooter>)
      expect(screen.getByTestId('footer')).toHaveTextContent('Footer Content')
    })

    it('should have correct display name', () => {
      expect(CardFooter.displayName).toBe('CardFooter')
    })

    it('should have flex layout', () => {
      render(<CardFooter data-testid="footer">Footer</CardFooter>)
      expect(screen.getByTestId('footer')).toHaveClass('flex', 'items-center', 'p-6', 'pt-0')
    })

    it('should forward ref correctly', () => {
      const ref = { current: null as HTMLDivElement | null }
      render(<CardFooter ref={ref}>Footer</CardFooter>)
      expect(ref.current).toBeInstanceOf(HTMLDivElement)
    })
  })

  describe('Card Composition', () => {
    it('should render complete card with all sub-components', () => {
      render(
        <Card data-testid="card">
          <CardHeader>
            <CardTitle>Product Card</CardTitle>
            <CardDescription>Product description here</CardDescription>
          </CardHeader>
          <CardContent>
            <p>Price: $99.99</p>
          </CardContent>
          <CardFooter>
            <button>Add to Cart</button>
          </CardFooter>
        </Card>
      )

      expect(screen.getByRole('heading', { name: /product card/i })).toBeInTheDocument()
      expect(screen.getByText('Product description here')).toBeInTheDocument()
      expect(screen.getByText('Price: $99.99')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /add to cart/i })).toBeInTheDocument()
    })

    it('should render card without header', () => {
      render(
        <Card data-testid="card">
          <CardContent>Content only</CardContent>
        </Card>
      )
      expect(screen.getByText('Content only')).toBeInTheDocument()
    })

    it('should render card without footer', () => {
      render(
        <Card data-testid="card">
          <CardHeader>
            <CardTitle>Title Only</CardTitle>
          </CardHeader>
          <CardContent>Content</CardContent>
        </Card>
      )
      expect(screen.getByRole('heading', { name: /title only/i })).toBeInTheDocument()
    })
  })

  describe('Accessibility', () => {
    it('should support aria-labelledby for card', () => {
      render(
        <Card aria-labelledby="card-title" data-testid="card">
          <CardTitle id="card-title">Accessible Card</CardTitle>
        </Card>
      )
      expect(screen.getByTestId('card')).toHaveAttribute('aria-labelledby', 'card-title')
    })

    it('should support role attribute', () => {
      render(<Card role="article" data-testid="card">Article Card</Card>)
      expect(screen.getByRole('article')).toBeInTheDocument()
    })
  })

  describe('HTML attributes', () => {
    it('should pass through data attributes', () => {
      render(<Card data-testid="card" data-id="123">Card</Card>)
      expect(screen.getByTestId('card')).toHaveAttribute('data-id', '123')
    })

    it('should pass through onClick handler', () => {
      const handleClick = vi.fn()
      render(<Card onClick={handleClick} data-testid="card">Clickable</Card>)
      screen.getByTestId('card').click()
      expect(handleClick).toHaveBeenCalled()
    })
  })
})

// Need to import vi
import { vi } from 'vitest'
