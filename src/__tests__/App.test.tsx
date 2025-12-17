import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import App from '../App';

// Mock all external dependencies
vi.mock('react-router-dom', () => ({
  RouterProvider: ({ children }: { children?: React.ReactNode }) => <div data-testid="router">{children}</div>,
}));

vi.mock('@tanstack/react-query', () => ({
  QueryClient: vi.fn(() => ({})),
  QueryClientProvider: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('@tanstack/react-query-devtools', () => ({
  ReactQueryDevtools: () => null,
}));

vi.mock('@/components/ui/sonner', () => ({
  Toaster: () => null,
}));

vi.mock('@/components/theme-provider', () => ({
  ThemeProvider: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('@/components/wardah-theme-provider', () => ({
  WardahThemeProvider: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('@/components/error-boundary', () => ({
  ErrorBoundary: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('@/contexts/AuthContext', () => ({
  AuthProvider: ({ children }: { children: React.ReactNode }) => <div data-testid="auth-provider">{children}</div>,
}));

vi.mock('@/pages/routes', () => ({
  appRouter: {},
}));

// Mock CSS imports
vi.mock('@/styles/wardah-ui-core.css', () => ({}));

describe('App Component', () => {
  it('should render without crashing', () => {
    render(<App />);
    expect(screen.getByTestId('auth-provider')).toBeInTheDocument();
  });

  it('should render RouterProvider', () => {
    render(<App />);
    expect(screen.getByTestId('router')).toBeInTheDocument();
  });

  it('should wrap app with AuthProvider', () => {
    render(<App />);
    const authProvider = screen.getByTestId('auth-provider');
    expect(authProvider).toBeInTheDocument();
  });
});
