// Wardah UI Theme - Centralized Design System
// This file contains all the design tokens, gradients, and glassmorphism styles
// that will be used across the entire application

export const wardahUITheme = {
  // Google Colors (Material Design)
  colors: {
    google: {
      blue: '#4285f4',
      red: '#ea4335',
      yellow: '#fbbc04',
      green: '#34a853',
      purple: '#9c27b0',
      teal: '#00bcd4',
      orange: '#ff9800',
      pink: '#e91e63',
    },
    
    // Glassmorphism colors with transparency
    glass: {
      light: 'rgba(255, 255, 255, 0.1)',
      medium: 'rgba(255, 255, 255, 0.05)',
      dark: 'rgba(0, 0, 0, 0.1)',
      border: 'rgba(255, 255, 255, 0.15)',
      backdrop: 'rgba(255, 255, 255, 0.05)',
    },
    
    // Text colors
    text: {
      primary: '#ffffff',
      secondary: '#a0aec0',
      accent: '#4285f4',
      success: '#34a853',
      warning: '#fbbc04',
      error: '#ea4335',
    },
    
    // Background gradients
    gradients: {
      google: 'linear-gradient(135deg, #4285f4 0%, #34a853 50%, #ea4335 100%)',
      googleExtended: 'linear-gradient(135deg, #4285f4 0%, #34a853 25%, #fbbc04 50%, #ea4335 75%, #9c27b0 100%)',
      darkBackground: 'linear-gradient(135deg, #0c0c0c 0%, #1a1a2e 50%, #16213e 100%)',
      cardBackground: 'linear-gradient(145deg, rgba(255, 255, 255, 0.1), rgba(255, 255, 255, 0.05))',
      chatContainer: 'linear-gradient(145deg, rgba(66, 133, 244, 0.1), rgba(52, 168, 83, 0.1))',
    },
  },
  
  // Glassmorphism effects
  glassmorphism: {
    backdropFilter: 'blur(25px)',
    borderRadius: '25px',
    border: '1px solid rgba(255, 255, 255, 0.15)',
    boxShadow: {
      card: '0 20px 60px rgba(0, 0, 0, 0.4)',
      inner: 'inset 0 1px 0 rgba(255, 255, 255, 0.3)',
    },
  },
  
  // Animations
  animations: {
    float: 'float 3s ease-in-out infinite',
    gradientShift: 'geminiGradientShift 4s ease infinite',
    slideInRight: 'slideInRight 0.3s ease-out',
    slideInLeft: 'slideInLeft 0.3s ease-out',
    spin: 'spin 1s linear infinite',
  },
  
  // Typography
  typography: {
    fontFamily: "'Cairo', sans-serif",
    sizes: {
      xs: '0.75rem',
      sm: '0.875rem',
      base: '1rem',
      lg: '1.125rem',
      xl: '1.25rem',
      '2xl': '1.5rem',
      '3xl': '1.875rem',
      '4xl': '2.25rem',
    },
    weights: {
      normal: 400,
      medium: 500,
      semibold: 600,
      bold: 700,
      extrabold: 800,
    },
  },
  
  // Spacing
  spacing: {
    xs: '0.25rem',
    sm: '0.5rem',
    md: '1rem',
    lg: '1.5rem',
    xl: '2rem',
    '2xl': '3rem',
    '3xl': '4rem',
  },
  
  // Shadows
  shadows: {
    sm: '0 1px 2px 0 rgba(0, 0, 0, 0.05)',
    md: '0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06)',
    lg: '0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05)',
    xl: '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)',
    '2xl': '0 25px 50px -12px rgba(0, 0, 0, 0.25)',
  },
  
  // Direction support
  direction: {
    rtl: 'rtl',
    ltr: 'ltr',
  },
  
  // Breakpoints
  breakpoints: {
    sm: '640px',
    md: '768px',
    lg: '1024px',
    xl: '1280px',
    '2xl': '1536px',
  },
};

// RTL-aware utility functions
export const getDirection = () => {
  const htmlElement = document.documentElement;
  return htmlElement.getAttribute('dir') || 'rtl';
};

export const isRTL = () => getDirection() === 'rtl';

// Utility function to get CSS variables for the theme
export const getCSSVariables = () => {
  const theme = wardahUITheme;
  return {
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
};

export default wardahUITheme;