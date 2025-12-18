/**
 * Input Component Tests
 * ====================
 * Tests for the Input UI component
 * 
 * @module components/ui/__tests__/input.test
 * @created 18 December 2025
 */

import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Input } from '../input'

describe('Input Component', () => {
  describe('Rendering', () => {
    it('should render input element', () => {
      render(<Input data-testid="input" />)
      expect(screen.getByTestId('input')).toBeInTheDocument()
    })

    it('should render with placeholder', () => {
      render(<Input placeholder="Enter your name" />)
      expect(screen.getByPlaceholderText('Enter your name')).toBeInTheDocument()
    })

    it('should forward ref correctly', () => {
      const ref = { current: null as HTMLInputElement | null }
      render(<Input ref={ref} />)
      expect(ref.current).toBeInstanceOf(HTMLInputElement)
    })

    it('should have correct display name', () => {
      expect(Input.displayName).toBe('Input')
    })
  })

  describe('Input Types', () => {
    it('should render input without explicit type attribute by default', () => {
      render(<Input data-testid="input" />)
      // HTML input defaults to "text" when type is not specified
      // The component doesn't explicitly set type, browser handles it
      expect(screen.getByTestId('input')).not.toHaveAttribute('type')
    })

    it('should render password input', () => {
      render(<Input type="password" data-testid="input" />)
      expect(screen.getByTestId('input')).toHaveAttribute('type', 'password')
    })

    it('should render email input', () => {
      render(<Input type="email" data-testid="input" />)
      expect(screen.getByTestId('input')).toHaveAttribute('type', 'email')
    })

    it('should render number input', () => {
      render(<Input type="number" data-testid="input" />)
      expect(screen.getByTestId('input')).toHaveAttribute('type', 'number')
    })

    it('should render tel input', () => {
      render(<Input type="tel" data-testid="input" />)
      expect(screen.getByTestId('input')).toHaveAttribute('type', 'tel')
    })

    it('should render search input', () => {
      render(<Input type="search" data-testid="input" />)
      expect(screen.getByTestId('input')).toHaveAttribute('type', 'search')
    })

    it('should render date input', () => {
      render(<Input type="date" data-testid="input" />)
      expect(screen.getByTestId('input')).toHaveAttribute('type', 'date')
    })

    it('should render file input', () => {
      render(<Input type="file" data-testid="input" />)
      expect(screen.getByTestId('input')).toHaveAttribute('type', 'file')
    })
  })

  describe('States', () => {
    it('should handle disabled state', () => {
      render(<Input disabled data-testid="input" />)
      expect(screen.getByTestId('input')).toBeDisabled()
    })

    it('should handle readonly state', () => {
      render(<Input readOnly data-testid="input" />)
      expect(screen.getByTestId('input')).toHaveAttribute('readonly')
    })

    it('should handle required state', () => {
      render(<Input required data-testid="input" />)
      expect(screen.getByTestId('input')).toBeRequired()
    })

    it('should have disabled styling classes', () => {
      render(<Input disabled data-testid="input" />)
      expect(screen.getByTestId('input')).toHaveClass('disabled:cursor-not-allowed', 'disabled:opacity-50')
    })
  })

  describe('Value handling', () => {
    it('should handle controlled value', () => {
      render(<Input value="test value" onChange={() => {}} data-testid="input" />)
      expect(screen.getByTestId('input')).toHaveValue('test value')
    })

    it('should handle defaultValue', () => {
      render(<Input defaultValue="default" data-testid="input" />)
      expect(screen.getByTestId('input')).toHaveValue('default')
    })

    it('should call onChange when value changes', async () => {
      const handleChange = vi.fn()
      render(<Input onChange={handleChange} data-testid="input" />)
      
      await userEvent.type(screen.getByTestId('input'), 'hello')
      expect(handleChange).toHaveBeenCalled()
    })

    it('should update value on user input', async () => {
      render(<Input data-testid="input" />)
      const input = screen.getByTestId('input')
      
      await userEvent.type(input, 'new value')
      expect(input).toHaveValue('new value')
    })
  })

  describe('Event handlers', () => {
    it('should call onFocus when focused', () => {
      const handleFocus = vi.fn()
      render(<Input onFocus={handleFocus} data-testid="input" />)
      
      fireEvent.focus(screen.getByTestId('input'))
      expect(handleFocus).toHaveBeenCalled()
    })

    it('should call onBlur when blurred', () => {
      const handleBlur = vi.fn()
      render(<Input onBlur={handleBlur} data-testid="input" />)
      
      const input = screen.getByTestId('input')
      fireEvent.focus(input)
      fireEvent.blur(input)
      expect(handleBlur).toHaveBeenCalled()
    })

    it('should call onKeyDown on key press', () => {
      const handleKeyDown = vi.fn()
      render(<Input onKeyDown={handleKeyDown} data-testid="input" />)
      
      fireEvent.keyDown(screen.getByTestId('input'), { key: 'Enter' })
      expect(handleKeyDown).toHaveBeenCalled()
    })

    it('should call onKeyUp on key release', () => {
      const handleKeyUp = vi.fn()
      render(<Input onKeyUp={handleKeyUp} data-testid="input" />)
      
      fireEvent.keyUp(screen.getByTestId('input'), { key: 'a' })
      expect(handleKeyUp).toHaveBeenCalled()
    })
  })

  describe('Styling', () => {
    it('should have base styling classes', () => {
      render(<Input data-testid="input" />)
      const input = screen.getByTestId('input')
      expect(input).toHaveClass('flex', 'h-10', 'w-full', 'rounded-md')
    })

    it('should merge custom className', () => {
      render(<Input className="custom-class" data-testid="input" />)
      expect(screen.getByTestId('input')).toHaveClass('custom-class')
    })

    it('should have focus styles', () => {
      render(<Input data-testid="input" />)
      expect(screen.getByTestId('input')).toHaveClass('focus-visible:outline-none', 'focus-visible:ring-2')
    })

    it('should have placeholder styling', () => {
      render(<Input data-testid="input" />)
      expect(screen.getByTestId('input')).toHaveClass('placeholder:text-muted-foreground')
    })
  })

  describe('Accessibility', () => {
    it('should be focusable', () => {
      render(<Input data-testid="input" />)
      const input = screen.getByTestId('input')
      input.focus()
      expect(input).toHaveFocus()
    })

    it('should support aria-label', () => {
      render(<Input aria-label="Email address" data-testid="input" />)
      expect(screen.getByLabelText('Email address')).toBeInTheDocument()
    })

    it('should support aria-describedby', () => {
      render(
        <>
          <Input aria-describedby="helper" data-testid="input" />
          <span id="helper">Enter your email</span>
        </>
      )
      expect(screen.getByTestId('input')).toHaveAttribute('aria-describedby', 'helper')
    })

    it('should support aria-invalid', () => {
      render(<Input aria-invalid="true" data-testid="input" />)
      expect(screen.getByTestId('input')).toHaveAttribute('aria-invalid', 'true')
    })
  })

  describe('HTML attributes', () => {
    it('should pass through name attribute', () => {
      render(<Input name="email" data-testid="input" />)
      expect(screen.getByTestId('input')).toHaveAttribute('name', 'email')
    })

    it('should pass through id attribute', () => {
      render(<Input id="email-input" data-testid="input" />)
      expect(screen.getByTestId('input')).toHaveAttribute('id', 'email-input')
    })

    it('should pass through maxLength attribute', () => {
      render(<Input maxLength={50} data-testid="input" />)
      expect(screen.getByTestId('input')).toHaveAttribute('maxLength', '50')
    })

    it('should pass through minLength attribute', () => {
      render(<Input minLength={5} data-testid="input" />)
      expect(screen.getByTestId('input')).toHaveAttribute('minLength', '5')
    })

    it('should pass through pattern attribute', () => {
      render(<Input pattern="[0-9]+" data-testid="input" />)
      expect(screen.getByTestId('input')).toHaveAttribute('pattern', '[0-9]+')
    })

    it('should pass through autoComplete attribute', () => {
      render(<Input autoComplete="email" data-testid="input" />)
      expect(screen.getByTestId('input')).toHaveAttribute('autocomplete', 'email')
    })

    it('should pass through autoFocus attribute', () => {
      render(<Input autoFocus data-testid="input" />)
      expect(screen.getByTestId('input')).toHaveFocus()
    })
  })

  describe('Number input specifics', () => {
    it('should handle min attribute', () => {
      render(<Input type="number" min={0} data-testid="input" />)
      expect(screen.getByTestId('input')).toHaveAttribute('min', '0')
    })

    it('should handle max attribute', () => {
      render(<Input type="number" max={100} data-testid="input" />)
      expect(screen.getByTestId('input')).toHaveAttribute('max', '100')
    })

    it('should handle step attribute', () => {
      render(<Input type="number" step={0.01} data-testid="input" />)
      expect(screen.getByTestId('input')).toHaveAttribute('step', '0.01')
    })
  })
})
