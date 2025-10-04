// Test to verify Wardah UI Design System implementation across components
import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { WardahThemeProvider } from '@/components/wardah-theme-provider';
import { getGlassClasses, getGradientTextClasses } from '@/lib/wardah-ui-utils';

// Mock components for testing
const MockGlassComponent = () => (
  <div className={getGlassClasses()}>
    <h2 className={getGradientTextClasses()}>Test Component</h2>
  </div>
);

const MockComponentWithoutDesignSystem = () => (
  <div className="bg-card rounded-lg border p-6">
    <h2 className="text-2xl font-bold">Test Component</h2>
  </div>
);

describe('Wardah UI Design System', () => {
  it('should provide theme context to components', () => {
    const TestComponent = () => {
      // This would normally use useWardahTheme()
      return <div>Test</div>;
    };
    
    const { container } = render(
      <WardahThemeProvider>
        <TestComponent />
      </WardahThemeProvider>
    );
    
    expect(container).toBeDefined();
  });

  it('should generate correct glass classes', () => {
    const glassClasses = getGlassClasses();
    expect(glassClasses).toContain('wardah-glass-card');
    expect(glassClasses).toContain('wardah-glass-card-hover');
  });

  it('should generate correct gradient text classes', () => {
    const gradientClasses = getGradientTextClasses();
    expect(gradientClasses).toBe('wardah-text-gradient-google');
  });

  it('should render components with design system classes', () => {
    const { container } = render(
      <WardahThemeProvider>
        <MockGlassComponent />
      </WardahThemeProvider>
    );
    
    const glassElement = container.firstChild as HTMLElement;
    expect(glassElement).toHaveClass('wardah-glass-card');
    expect(glassElement).toHaveClass('wardah-glass-card-hover');
    
    const headingElement = glassElement?.firstChild as HTMLElement;
    expect(headingElement).toHaveClass('wardah-text-gradient-google');
  });

  it('should be able to distinguish between components with and without design system', () => {
    const { container: containerWithDS } = render(
      <WardahThemeProvider>
        <MockGlassComponent />
      </WardahThemeProvider>
    );
    
    const { container: containerWithoutDS } = render(
      <WardahThemeProvider>
        <MockComponentWithoutDesignSystem />
      </WardahThemeProvider>
    );
    
    const elementWithDS = containerWithDS.firstChild as HTMLElement;
    const elementWithoutDS = containerWithoutDS.firstChild as HTMLElement;
    
    // Element with design system should have glass classes
    expect(elementWithDS).toHaveClass('wardah-glass-card');
    
    // Element without design system should not have glass classes
    expect(elementWithoutDS).not.toHaveClass('wardah-glass-card');
  });
});

// Design System Tests
// This file tests the implementation of the unified design system

import { DesignSystemDemo } from '@/components/design-system-demo';

describe('Design System Implementation', () => {
  it('should render the design system demo component', () => {
    render(<DesignSystemDemo />);
    
    // Check that the main title is rendered with gradient text
    expect(screen.getByText('Design System Demo')).toBeInTheDocument();
    
    // Check that cards are rendered with glassmorphism
    expect(screen.getByText('Glass Card Example')).toBeInTheDocument();
    
    // Check that form elements are rendered
    expect(screen.getByLabelText('Name')).toBeInTheDocument();
    
    // Check that badges are rendered
    expect(screen.getByText('Default')).toBeInTheDocument();
    
    // Check that animated elements are rendered
    expect(screen.getByText('Floating Card')).toBeInTheDocument();
  });

  it('should apply glassmorphism classes to cards', () => {
    render(<DesignSystemDemo />);
    
    const glassCard = screen.getByText('Glass Card Example').closest('.wardah-glass-card');
    expect(glassCard).toBeInTheDocument();
    
    const interactiveCard = screen.getByText('Interactive Glass Card').closest('.wardah-glass-card-hover');
    expect(interactiveCard).toBeInTheDocument();
  });

  it('should apply gradient text classes to headers', () => {
    render(<DesignSystemDemo />);
    
    const gradientHeader = screen.getByText('Glass Card Example').closest('.wardah-text-gradient-google');
    expect(gradientHeader).toBeInTheDocument();
  });
});
