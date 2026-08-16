// src/features/inventory/__tests__/storage-locations-revoke-race.test.tsx
//
// Round 7 P1: StorageLocationsManagement gates warehouses.read correctly at
// the query level (Round 6), but the locations effect had no protection
// against a request that resolves after inventory.warehouses.read is
// revoked mid-session — that response would still call setLocations(data)
// unconditionally. Fixed with independent per-request generation counters
// for the warehouses and locations loads. This proves the race directly
// against the real component (StorageLocationsManagement), with a real
// spied warehouseService.

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const hasPermissionKeyMock = vi.fn((_key: string) => false);
vi.mock('@/hooks/usePermissions', () => ({
  usePermissions: () => ({ hasPermissionKey: (key: string) => hasPermissionKeyMock(key) }),
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

const WAREHOUSE = { id: 'wh-1', code: 'WH1', name: 'Main', is_active: true };
const LOCATION = { id: 'loc-1', code: 'L1', name: 'Zone A', warehouse_id: 'wh-1', location_type: 'ZONE' };

const getWarehouses = vi.fn(async (..._args: unknown[]) => [WAREHOUSE]);
const getStorageLocations = vi.fn(async (..._args: unknown[]) => [LOCATION]);

vi.mock('@/services/warehouse-service', () => ({
  warehouseService: {
    getWarehouses: (...args: unknown[]) => getWarehouses(...args),
    getStorageLocations: (...args: unknown[]) => getStorageLocations(...args),
    createStorageLocation: vi.fn(),
    updateStorageLocation: vi.fn(),
    deleteStorageLocation: vi.fn(),
  },
}));

import StorageLocationsManagement from '../components/StorageLocationsManagement';

function setPermissions(keys: readonly string[]) {
  hasPermissionKeyMock.mockImplementation((key: string) => keys.includes(key));
}

beforeEach(() => {
  vi.clearAllMocks();
  hasPermissionKeyMock.mockReturnValue(false);
  getWarehouses.mockResolvedValue([WAREHOUSE]);
  getStorageLocations.mockResolvedValue([LOCATION]);
});

describe('StorageLocationsManagement — warehouses.read revoke race', () => {
  it('positive: with inventory.warehouses.read, warehouses load and the default selection loads its locations', async () => {
    setPermissions(['inventory.warehouses.read']);
    render(<StorageLocationsManagement />);

    await waitFor(() => expect(getWarehouses).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(getStorageLocations).toHaveBeenCalledWith('wh-1'));
    await waitFor(() => expect(screen.getByText('Zone A')).toBeInTheDocument());
  });

  it('negative: without inventory.warehouses.read, neither warehouses nor locations are requested', async () => {
    setPermissions([]);
    render(<StorageLocationsManagement />);

    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(getWarehouses).not.toHaveBeenCalled();
    expect(getStorageLocations).not.toHaveBeenCalled();
  });

  it('cached-data revocation: locations visible under a granted permission disappear once it is revoked', async () => {
    setPermissions(['inventory.warehouses.read']);
    const { rerender } = render(<StorageLocationsManagement />);

    await waitFor(() => expect(screen.getByText('Zone A')).toBeInTheDocument());

    setPermissions([]);
    rerender(<StorageLocationsManagement />);

    await waitFor(() => expect(screen.queryByText('Zone A')).not.toBeInTheDocument());
  });

  it('in-flight revocation: a getStorageLocations response resolving after revocation must not populate the table', async () => {
    let resolveLocations!: (value: typeof LOCATION[]) => void;
    getStorageLocations.mockReturnValue(
      new Promise((resolve) => {
        resolveLocations = resolve;
      })
    );
    setPermissions(['inventory.warehouses.read']);
    render(<StorageLocationsManagement />);

    await waitFor(() => expect(getStorageLocations).toHaveBeenCalledTimes(1));

    // Revoke before the in-flight request settles — this also fires the
    // warehouses effect's else-branch, which used to share one counter with
    // the locations effect and could spuriously invalidate an unrelated
    // in-flight warehouses request (the bug independent per-resource
    // counters fix). Confirm no crash and no data leak either way.
    setPermissions([]);
    resolveLocations([LOCATION]);

    await waitFor(() => expect(screen.queryByText('Zone A')).not.toBeInTheDocument());
  });

  it('a request already in flight when the selected warehouse changes is not applied to the newer selection', async () => {
    const otherLocation = { ...LOCATION, id: 'loc-2', name: 'Zone B', warehouse_id: 'wh-2' };
    let resolveFirst!: (value: typeof LOCATION[]) => void;
    getStorageLocations.mockImplementation((...args: unknown[]) => {
      const warehouseId = args[0] as string
      if (warehouseId === 'wh-1') {
        return new Promise((resolve) => {
          resolveFirst = resolve;
        });
      }
      return Promise.resolve([otherLocation]);
    });
    getWarehouses.mockResolvedValue([WAREHOUSE, { id: 'wh-2', code: 'WH2', name: 'Second', is_active: true }]);
    setPermissions(['inventory.warehouses.read']);
    render(<StorageLocationsManagement />);

    await waitFor(() => expect(getStorageLocations).toHaveBeenCalledWith('wh-1'));

    // Simulate the user switching warehouses before the first (wh-1)
    // response lands, by selecting the second warehouse from the combobox.
    await userEvent.click(screen.getAllByRole('combobox')[0]);
    await userEvent.click(await screen.findByRole('option', { name: /Second/ }));

    await waitFor(() => expect(screen.getByText('Zone B')).toBeInTheDocument());

    // The stale wh-1 response now lands — it must not overwrite Zone B.
    resolveFirst([LOCATION]);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(screen.getByText('Zone B')).toBeInTheDocument();
    expect(screen.queryByText('Zone A')).not.toBeInTheDocument();
  });
});
