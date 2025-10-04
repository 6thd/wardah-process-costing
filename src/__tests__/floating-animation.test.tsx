// Floating Animation Tests
// This file tests the implementation of the floating animation across components

import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { DesignSystemDemo } from '@/components/design-system-demo';

describe('Floating Animation Implementation', () => {
  it('should render elements with floating animation classes', () => {
    render(<DesignSystemDemo />);
    
    // Check that the floating card is rendered with the animation class
    const floatingCard = screen.getByText('Floating Card').closest('.wardah-animation-float');
    expect(floatingCard).toBeInTheDocument();
    
    // Check that the animated button is rendered with the animation class
    const animatedButton = screen.getByText('Animated Button').closest('.wardah-animation-float');
    expect(animatedButton).toBeInTheDocument();
    
    // Check that KPI cards have the floating animation
    const kpiCards = screen.getAllByText(/Active Orders|Efficiency|Alerts/);
    expect(kpiCards).toHaveLength(3);
    
    kpiCards.forEach(card => {
      const parentCard = card.closest('.wardah-animation-float');
      expect(parentCard).toBeInTheDocument();
    });
  });

  it('should apply floating animation to key metrics', () => {
    render(<DesignSystemDemo />);
    
    // Check that KPI cards are rendered with glass and float classes
    const kpiCardElements = document.querySelectorAll('.wardah-glass-card.wardah-animation-float');
    expect(kpiCardElements.length).toBeGreaterThanOrEqual(3);
  });

  it('should maintain proper CSS class composition', () => {
    render(<DesignSystemDemo />);
    
    // Check that elements have both glass and animation classes
    const floatingElement = screen.getByText('Floating Card').closest('.wardah-glass-card.wardah-animation-float');
    expect(floatingElement).toBeInTheDocument();
  });
});