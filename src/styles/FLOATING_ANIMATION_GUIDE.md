# Wardah UI Floating Animation Implementation Guide

## Overview
This guide explains how to properly implement the floating animation effect across all modules in the Wardah application to ensure a consistent, modern user experience.

## Animation Details
The floating animation is defined in [wardah-ui-core.css](file:///c:/Users/mojah/Downloads/Wardah/src/styles/wardah-ui-core.css) with the following properties:

```css
@keyframes float {
  0% { transform: translateY(0px); }
  50% { transform: translateY(-10px); }
  100% { transform: translateY(0px); }
}

.wardah-animation-float {
  animation: float 3s ease-in-out infinite;
}
```

This creates a subtle bouncing effect that repeats infinitely every 3 seconds.

## When to Use Floating Animation

### Primary Use Cases
1. **KPI Cards** - Key metrics that deserve visual attention
2. **Summary Cards** - Important summary information
3. **Call-to-Action Elements** - Buttons or cards that prompt user action
4. **Featured Content** - Highlighted or important sections

### Secondary Use Cases
1. **Interactive Elements** - Components users can click or interact with
2. **Notification Indicators** - Elements that show important status updates
3. **Loading States** - Components that are processing or loading

## Implementation Guidelines

### 1. KPI and Summary Cards
Apply the floating animation to all KPI and summary cards:

```tsx
// BEFORE
<Card className="wardah-glass-card">
  <CardContent>
    <div className="text-2xl font-bold">85.6%</div>
    <div className="text-sm text-muted-foreground">Efficiency</div>
  </CardContent>
</Card>

// AFTER
<Card className="wardah-glass-card wardah-animation-float">
  <CardContent>
    <div className="text-2xl font-bold">85.6%</div>
    <div className="text-sm text-muted-foreground">Efficiency</div>
  </CardContent>
</Card>
```

### 2. Interactive Cards
Apply the floating animation to cards that users can interact with:

```tsx
// BEFORE
<Link to="/path" className="wardah-glass-card wardah-glass-card-hover p-6">
  <h3 className="font-semibold">Interactive Card</h3>
</Link>

// AFTER
<Link to="/path" className="wardah-glass-card wardah-glass-card-hover wardah-animation-float p-6">
  <h3 className="font-semibold">Interactive Card</h3>
</Link>
```

### 3. Buttons
Apply the floating animation to important buttons:

```tsx
// BEFORE
<Button className="wardah-glass-card">
  <Settings className="mr-2 h-4 w-4" />
  Settings
</Button>

// AFTER
<Button className="wardah-glass-card wardah-animation-float">
  <Settings className="mr-2 h-4 w-4" />
  Settings
</Button>
```

### 4. Notification Elements
Apply the floating animation to notification or alert elements:

```tsx
// BEFORE
<div className="wardah-glass-card p-4">
  <AlertTriangle className="text-yellow-500" />
  <p>Attention required</p>
</div>

// AFTER
<div className="wardah-glass-card wardah-animation-float p-4">
  <AlertTriangle className="text-yellow-500" />
  <p>Attention required</p>
</div>
```

## Module-Specific Implementation

### Manufacturing Module (Completed)
- ✅ Key metrics cards in Manufacturing Overview
- ✅ Summary cards in Equivalent Units Dashboard
- ✅ Summary cards in Variance Alerts
- ✅ Interactive function cards in Manufacturing Overview

### Costing Module (To Be Implemented)
1. Cost summary cards
2. Variance analysis cards
3. Interactive costing tools
4. Report summary cards

### Inventory Module (To Be Implemented)
1. Stock level indicators
2. Low stock alerts
3. Inventory summary cards
4. Quick action buttons

### Sales Module (To Be Implemented)
1. Sales performance cards
2. Customer metrics
3. Order status indicators
4. Revenue summary cards

### Purchasing Module (To Be Implemented)
1. Vendor performance cards
2. Purchase order summaries
3. Spending analytics
4. Approval workflow cards

### HR Module (To Be Implemented)
1. Employee metrics
2. Attendance summaries
3. Performance indicators
4. Payroll summary cards

### Accounting Module (To Be Implemented)
1. Financial summary cards
2. Account balance indicators
3. Transaction summaries
4. Report generation cards

### Reports Module (To Be Implemented)
1. Report type cards
2. Data visualization cards
3. Export options
4. Filter panels

## Best Practices

### 1. Use Sparingly
- Apply floating animation to important elements only
- Avoid applying to too many elements on the same page
- Reserve for elements that need visual emphasis

### 2. Combine with Other Effects
- Use with glassmorphism for enhanced visual appeal
- Combine with gradient text for headers
- Layer with hover effects for interactive elements

### 3. Performance Considerations
- Limit the number of animated elements per page
- Test performance on lower-end devices
- Consider reducing animation intensity for users with motion sensitivity

### 4. Accessibility
- Ensure animations don't cause issues for users with vestibular disorders
- Provide controls to reduce motion if needed
- Maintain sufficient contrast with animated elements

## Testing Guidelines

### Visual Testing
1. Verify animation is smooth and not janky
2. Check that animation doesn't interfere with readability
3. Confirm animation works well with other visual effects
4. Test on different screen sizes and devices

### Performance Testing
1. Monitor frame rate during animation
2. Check memory usage with multiple animated elements
3. Test on various device capabilities
4. Verify battery impact on mobile devices

### Accessibility Testing
1. Test with screen readers
2. Verify keyboard navigation
3. Check reduced motion preferences
4. Confirm color contrast with animation

## Common Issues and Solutions

### 1. Animation Performance Issues
**Problem**: Page becomes slow with many animated elements
**Solution**: 
- Limit animated elements to 4-6 per page
- Use `will-change` property for optimization
- Consider disabling on lower-end devices

### 2. Animation Conflicts
**Problem**: Multiple animations interfere with each other
**Solution**:
- Stagger animation delays
- Use different timing functions
- Reduce animation intensity

### 3. Readability Issues
**Problem**: Text becomes hard to read with animation
**Solution**:
- Add text shadows
- Use solid backgrounds behind text
- Reduce animation amplitude

## CSS Customization

### Adjusting Animation Intensity
To create a more subtle or more pronounced floating effect:

```css
/* More subtle floating */
.wardah-animation-float-subtle {
  animation: float 4s ease-in-out infinite;
}

/* More pronounced floating */
.wardah-animation-float-pronounced {
  animation: float 2s ease-in-out infinite;
}

/* Custom amplitude */
@keyframes float-custom {
  0% { transform: translateY(0px); }
  50% { transform: translateY(-15px); }
  100% { transform: translateY(0px); }
}
```

### Staggering Animations
To prevent all elements from animating simultaneously:

```tsx
// Add different delays to elements
<div className="wardah-animation-float" style={{ animationDelay: '0.2s' }}>
  <p>First Card</p>
</div>

<div className="wardah-animation-float" style={{ animationDelay: '0.4s' }}>
  <p>Second Card</p>
</div>

<div className="wardah-animation-float" style={{ animationDelay: '0.6s' }}>
  <p>Third Card</p>
</div>
```

## Utility Functions

The utility function `getFloatAnimationClasses()` in [wardah-ui-utils.ts](file:///c:/Users/mojah/Downloads/Wardah/src/lib/wardah-ui-utils.ts) returns the correct CSS class:

```tsx
import { getFloatAnimationClasses } from '@/lib/wardah-ui-utils';

// Usage
<div className={`wardah-glass-card ${getFloatAnimationClasses()}`}>
  <p>Floating Card</p>
</div>
```

## Rollout Strategy

### Phase 1: Audit Current Implementation
1. Review all existing components for proper animation usage
2. Identify missing animations in completed modules
3. Document inconsistencies

### Phase 2: Core Modules Implementation
1. Implement in high-traffic modules first
2. Gather user feedback
3. Refine implementation based on feedback

### Phase 3: Remaining Modules
1. Systematically apply to all remaining modules
2. Conduct thorough testing
3. Verify performance and accessibility

### Phase 4: Optimization
1. Fine-tune animation performance
2. Add user controls for animation preferences
3. Document best practices

## Resources

### Core Files
- [wardah-ui-core.css](file:///c:/Users/mojah/Downloads/Wardah/src/styles/wardah-ui-core.css) - Animation definitions
- [wardah-ui-utils.ts](file:///c:/Users/mojah/Downloads/Wardah/src/lib/wardah-ui-utils.ts) - Utility functions
- [Design System Demo](file:///c:/Users/mojah/Downloads/Wardah/src/components/design-system-demo.tsx) - Visual examples

### Documentation
- [Design System Implementation Guide](file:///c:/Users/mojah/Downloads/Wardah/src/styles/DESIGN_SYSTEM_IMPLEMENTATION_GUIDE.md)
- [Unification Guide](file:///c:/Users/mojah/Downloads/Wardah/src/styles/UNIFICATION_GUIDE.md)
- [Implementation Summary](file:///c:/Users/mojah/Downloads/Wardah/src/styles/IMPLEMENTATION_SUMMARY.md)