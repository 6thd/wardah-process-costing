# Wardah UI Design System

## Overview
The Wardah UI Design System implements a modern, unified visual language across the entire application using glassmorphism effects and Google Material Design gradients.

## Core Principles
1. **Consistency** - Unified visual language across all modules
2. **Modern Aesthetics** - Glassmorphism and gradient effects
3. **Accessibility** - WCAG compliant color schemes and contrast
4. **Performance** - Optimized implementations
5. **Responsive Design** - Works on all device sizes

## Components

### Visual Effects
- **Glassmorphism** - Frosted glass background effects
- **Google Gradients** - Material Design color gradients
- **Animations** - Subtle floating and gradient shift effects

### CSS Classes
- `wardah-glass-card` - Base glassmorphism effect
- `wardah-glass-card-hover` - Glass card with hover effect
- `wardah-text-gradient-google` - Google gradient text effect
- `wardah-animation-float` - Floating animation
- `wardah-animation-gradient-shift` - Gradient shifting effect

### Utility Functions
- `getGlassClasses()` - Returns glassmorphism CSS classes
- `getGradientTextClasses()` - Returns gradient text CSS classes
- `getFloatAnimationClasses()` - Returns floating animation classes
- `getGradientShiftClasses()` - Returns gradient shift animation classes

## Implementation Files
- [Core CSS Styles](file:///c:/Users/mojah/Downloads/Wardah/src/styles/wardah-ui-core.css) - All CSS classes and animations
- [Theme Definition](file:///c:/Users/mojah/Downloads/Wardah/src/lib/wardah-ui-theme.ts) - Color palette and design tokens
- [Utility Functions](file:///c:/Users/mojah/Downloads/Wardah/src/lib/wardah-ui-utils.ts) - Helper functions for consistent styling
- [Theme Provider](file:///c:/Users/mojah/Downloads/Wardah/src/components/wardah-theme-provider.tsx) - React context for theme access

## Documentation
- [Design System Implementation Guide](file:///c:/Users/mojah/Downloads/Wardah/src/styles/DESIGN_SYSTEM_IMPLEMENTATION_GUIDE.md) - Detailed instructions for developers
- [Implementation Summary](file:///c:/Users/mojah/Downloads/Wardah/src/styles/IMPLEMENTATION_SUMMARY.md) - Summary of completed work
- [Unification Guide](file:///c:/Users/mojah/Downloads/Wardah/src/styles/UNIFICATION_GUIDE.md) - Instructions for remaining modules
- [Floating Animation Guide](file:///c:/Users/mojah/Downloads/Wardah/src/styles/FLOATING_ANIMATION_GUIDE.md) - Specific instructions for floating animation
- [Floating Animation Implementation Summary](file:///c:/Users/mojah/Downloads/Wardah/src/styles/FLOATING_ANIMATION_IMPLEMENTATION_SUMMARY.md) - Summary of floating animation work

## Demo
- [Design System Demo Component](file:///c:/Users/mojah/Downloads/Wardah/src/components/design-system-demo.tsx) - Visual showcase of all components
- Access at `/design-system` route in the application

## Testing
- [Design System Tests](file:///c:/Users/mojah/Downloads/Wardah/src/__tests__/) - Unit tests for design system components
- [Verification Script](file:///c:/Users/mojah/Downloads/Wardah/src/scripts/verify-design-system.js) - Script to check implementation across modules

## Modules Updated
- Manufacturing Module (Complete)
- More modules to be updated following the unification guide

## Contributing
To contribute to the design system:
1. Follow the implementation guides
2. Use existing CSS classes and utility functions
3. Maintain consistency with existing components
4. Test thoroughly across browsers and devices