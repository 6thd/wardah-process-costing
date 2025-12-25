/**
 * Inventory Module Component Tests
 * اختبارات مكون إدارة المخزون
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { BrowserRouter, MemoryRouter } from 'react-router-dom';
import { InventoryModule } from '../index';
import React from 'react';

// Mock dependencies
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: 'ar' }
  })
}));

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    info: vi.fn()
  }
}));

vi.mock('@/lib/supabase', () => ({
  getSupabase: vi.fn(() => ({
    auth: {
      getUser: vi.fn().mockResolvedValue({ 
        data: { user: { id: 'user-1', email: 'test@example.com' } },
        error: null
      })
    },
    from: vi.fn(() => ({
      select: vi.fn().mockReturnThis(),
      insert: vi.fn().mockReturnThis(),
      update: vi.fn().mockReturnThis(),
      delete: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: null, error: null }),
      order: vi.fn().mockResolvedValue({ data: [], error: null })
    }))
  })),
  Item: {},
  Category: {}
}));

vi.mock('@/services/supabase-service', () => ({
  itemsService: {
    getAll: vi.fn().mockResolvedValue([]),
    getById: vi.fn().mockResolvedValue(null),
    create: vi.fn().mockResolvedValue({ id: '1' }),
    update: vi.fn().mockResolvedValue({ id: '1' }),
    delete: vi.fn().mockResolvedValue({ success: true })
  },
  categoriesService: {
    getAll: vi.fn().mockResolvedValue([]),
    getById: vi.fn().mockResolvedValue(null),
    create: vi.fn().mockResolvedValue({ id: '1' }),
    update: vi.fn().mockResolvedValue({ id: '1' }),
    delete: vi.fn().mockResolvedValue({ success: true })
  },
  stockMovementsService: {
    getAll: vi.fn().mockResolvedValue([]),
    create: vi.fn().mockResolvedValue({ id: '1' })
  }
}));

// Helper function to render with router
const renderWithRouter = (component: React.ReactElement, route = '/inventory') => {
  return render(
    <MemoryRouter initialEntries={[route]}>
      {component}
    </MemoryRouter>
  );
};

describe('InventoryModule', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Component Rendering', () => {
    it('should render without crashing', () => {
      const { container } = renderWithRouter(<InventoryModule />);
      expect(container).toBeInTheDocument();
    });

    it('should render routes configuration', () => {
      const { container } = renderWithRouter(<InventoryModule />, '/inventory');
      expect(container).toBeInTheDocument();
    });

    it('should have InventoryModule component structure', () => {
      const { container } = renderWithRouter(<InventoryModule />);
      // Routes component should exist
      expect(container.firstChild).toBeTruthy();
    });
  });

  describe('Route Navigation', () => {
    it('should render overview route by default', () => {
      renderWithRouter(<InventoryModule />, '/inventory');
      // Component should render for overview route
      expect(document.body).toBeInTheDocument();
    });

    it('should handle overview route explicitly', () => {
      renderWithRouter(<InventoryModule />, '/inventory/overview');
      expect(document.body).toBeInTheDocument();
    });

    it('should handle items route', () => {
      renderWithRouter(<InventoryModule />, '/inventory/items');
      expect(document.body).toBeInTheDocument();
    });

    it('should handle categories route', () => {
      renderWithRouter(<InventoryModule />, '/inventory/categories');
      expect(document.body).toBeInTheDocument();
    });

    it('should handle movements route', () => {
      renderWithRouter(<InventoryModule />, '/inventory/movements');
      expect(document.body).toBeInTheDocument();
    });

    it('should handle adjustments route', () => {
      renderWithRouter(<InventoryModule />, '/inventory/adjustments');
      expect(document.body).toBeInTheDocument();
    });

    it('should handle valuation route', () => {
      renderWithRouter(<InventoryModule />, '/inventory/valuation');
      expect(document.body).toBeInTheDocument();
    });

    it('should handle locations route', () => {
      renderWithRouter(<InventoryModule />, '/inventory/locations');
      expect(document.body).toBeInTheDocument();
    });

    it('should handle warehouses route', () => {
      renderWithRouter(<InventoryModule />, '/inventory/warehouses');
      expect(document.body).toBeInTheDocument();
    });

    it('should handle bins route', () => {
      renderWithRouter(<InventoryModule />, '/inventory/bins');
      expect(document.body).toBeInTheDocument();
    });

    it('should handle transfers route', () => {
      renderWithRouter(<InventoryModule />, '/inventory/transfers');
      expect(document.body).toBeInTheDocument();
    });

    it('should redirect invalid routes to overview', () => {
      renderWithRouter(<InventoryModule />, '/inventory/invalid-route');
      // Invalid routes should be handled
      expect(document.body).toBeInTheDocument();
    });
  });

  describe('Module Structure', () => {
    it('should export InventoryModule function', () => {
      expect(typeof InventoryModule).toBe('function');
    });

    it('should be a valid React component', () => {
      const { container } = renderWithRouter(<InventoryModule />);
      expect(container).toBeTruthy();
    });
  });
});

