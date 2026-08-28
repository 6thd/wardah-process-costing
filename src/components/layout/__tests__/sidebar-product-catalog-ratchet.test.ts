import { describe, expect, it } from 'vitest';
import sidebarSource from '@/components/layout/sidebar.tsx?raw';

describe('Sidebar product catalog ratchet', () => {
  it('consumes the product catalog instead of owning a duplicate module map', () => {
    expect(sidebarSource).toContain("from '@/config/product-catalog'");
    expect(sidebarSource).toContain('getVisibleProductNavigation');
    expect(sidebarSource).not.toContain('const MODULE_CODES =');
    expect(sidebarSource).not.toContain('const allNavigationItems =');
  });

  it('does not restore decorative static badges', () => {
    expect(sidebarSource).not.toContain("badge: '2'");
    expect(sidebarSource).not.toContain("badge: '3'");
    expect(sidebarSource).not.toContain("from '@/components/ui/badge'");
  });

  it('filters navigation with exact backend permission keys', () => {
    expect(sidebarSource).toContain('hasPermissionKey');
    expect(sidebarSource).not.toContain('hasModuleAccess');
  });
});
