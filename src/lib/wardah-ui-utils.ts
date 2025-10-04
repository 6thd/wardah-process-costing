// Wardah UI Utilities
// Helper functions for consistent styling and theme usage

import { wardahUITheme } from "./wardah-ui-theme";

/**
 * Get CSS classes for glassmorphism effects
 * @returns CSS class string for glassmorphism
 */
export const getGlassClasses = (): string => {
  return "wardah-glass-card wardah-glass-card-hover";
};

/**
 * Get CSS classes for gradient text
 * @returns CSS class string for gradient text
 */
export const getGradientTextClasses = (): string => {
  return "wardah-text-gradient-google";
};

/**
 * Get CSS classes for floating animation
 * @returns CSS class string for floating animation
 */
export const getFloatAnimationClasses = (): string => {
  return "wardah-animation-float";
};

/**
 * Get CSS classes for gradient shift animation
 * @returns CSS class string for gradient shift animation
 */
export const getGradientShiftClasses = (): string => {
  return "wardah-animation-gradient-shift";
};

/**
 * Get CSS classes for chat container
 * @returns CSS class string for chat container
 */
export const getChatContainerClasses = (): string => {
  return "wardah-chat-container";
};

/**
 * Get CSS classes for chart containers
 * @returns CSS class string for chart containers
 */
export const getChartContainerClasses = (): string => {
  return "wardah-min-height-chart";
};

/**
 * Get CSS classes for KPI cards
 * @returns CSS class string for KPI cards
 */
export const getKPICardClasses = (): string => {
  return "wardah-kpi-card wardah-animation-float";
};

/**
 * Get CSS classes for chart cards
 * @returns CSS class string for chart cards
 */
export const getChartCardClasses = (): string => {
  return "wardah-chart-card";
};

/**
 * Get Google gradient colors
 * @returns Object with Google gradient color classes
 */
export const getGoogleGradients = () => {
  return {
    primary: "wardah-gradient-google",
    extended: "wardah-gradient-google-extended",
    darkBackground: "wardah-gradient-dark-background",
    cardBackground: "wardah-gradient-card-background",
    chatContainer: "wardah-gradient-chat-container",
  };
};

/**
 * Get RTL-aware animation classes
 * @returns Object with RTL-aware animation classes
 */
export const getRTLAnimations = () => {
  return {
    slideInRight: "wardah-slide-in-right",
    slideInLeft: "wardah-slide-in-left",
  };
};

/**
 * Apply theme-based styling to an element
 * @param element - The DOM element to style
 * @param theme - The theme to apply (optional, uses default if not provided)
 */
export const applyWardahTheme = (element: HTMLElement, theme = wardahUITheme) => {
  // Apply CSS variables for the theme
  const cssVariables = {
    '--wardah-google-blue': theme.colors.google.blue,
    '--wardah-google-red': theme.colors.google.red,
    '--wardah-google-yellow': theme.colors.google.yellow,
    '--wardah-google-green': theme.colors.google.green,
    '--wardah-google-purple': theme.colors.google.purple,
    '--wardah-glass-light': theme.colors.glass.light,
    '--wardah-glass-medium': theme.colors.glass.medium,
    '--wardah-glass-dark': theme.colors.glass.dark,
    '--wardah-glass-border': theme.colors.glass.border,
    '--wardah-gradient-google': theme.colors.gradients.google,
    '--wardah-gradient-google-extended': theme.colors.gradients.googleExtended,
    '--wardah-gradient-dark-background': theme.colors.gradients.darkBackground,
    '--wardah-gradient-card-background': theme.colors.gradients.cardBackground,
    '--wardah-glass-border-radius': theme.glassmorphism.borderRadius,
    '--wardah-glass-backdrop-filter': theme.glassmorphism.backdropFilter,
  };

  Object.entries(cssVariables).forEach(([key, value]) => {
    element.style.setProperty(key, value as string);
  });
};

/**
 * Get direction-aware classes
 * @param isRTL - Whether to use RTL classes
 * @returns Object with direction-aware classes
 */
export const getDirectionClasses = (isRTL: boolean = true) => {
  return {
    textAlign: isRTL ? 'text-right' : 'text-left',
    float: isRTL ? 'float-right' : 'float-left',
    margin: isRTL ? 'ml-auto' : 'mr-auto',
  };
};

export default {
  getGlassClasses,
  getGradientTextClasses,
  getFloatAnimationClasses,
  getGradientShiftClasses,
  getChatContainerClasses,
  getChartContainerClasses,
  getKPICardClasses,
  getChartCardClasses,
  getGoogleGradients,
  getRTLAnimations,
  applyWardahTheme,
  getDirectionClasses,
};