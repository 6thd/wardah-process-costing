// Wardah UI Utilities Tests
// This file tests the utility functions for the design system

import { describe, it, expect } from 'vitest';
import { 
  getGlassClasses, 
  getGradientTextClasses,
  getFloatAnimationClasses,
  getGradientShiftClasses,
  getGoogleGradients
} from './wardah-ui-utils';

describe('Wardah UI Utilities', () => {
  it('should return correct glass classes', () => {
    const glassClasses = getGlassClasses();
    expect(glassClasses).toBe('wardah-glass-card wardah-glass-card-hover');
  });

  it('should return correct gradient text classes', () => {
    const gradientClasses = getGradientTextClasses();
    expect(gradientClasses).toBe('wardah-text-gradient-google');
  });

  it('should return correct float animation classes', () => {
    const floatClasses = getFloatAnimationClasses();
    expect(floatClasses).toBe('wardah-animation-float');
  });

  it('should return correct gradient shift classes', () => {
    const gradientShiftClasses = getGradientShiftClasses();
    expect(gradientShiftClasses).toBe('wardah-animation-gradient-shift');
  });

  it('should return correct Google gradients', () => {
    const gradients = getGoogleGradients();
    expect(gradients).toEqual({
      primary: 'wardah-gradient-google',
      extended: 'wardah-gradient-google-extended',
      darkBackground: 'wardah-gradient-dark-background',
      cardBackground: 'wardah-gradient-card-background',
      chatContainer: 'wardah-gradient-chat-container',
    });
  });
});