import { act, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OrganizationLocaleProvider } from '../organization-locale-provider';

const mocks = vi.hoisted(() => ({
  useAuth: vi.fn(),
  getSystemSettings: vi.fn(),
  applyRuntimeLocaleSettings: vi.fn(),
  subscribeRuntimeLocaleSettings: vi.fn(),
  unsubscribe: vi.fn(),
  defaultSettings: {
    currency: 'SAR',
    numberFormat: 'en-US',
    dateFormat: 'en-US',
  },
}));

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: mocks.useAuth,
}));

vi.mock('@/services/org-settings-service', () => ({
  getSystemSettings: mocks.getSystemSettings,
}));

vi.mock('@/lib/runtime-locale-settings', () => ({
  DEFAULT_RUNTIME_LOCALE_SETTINGS: mocks.defaultSettings,
  applyRuntimeLocaleSettings: mocks.applyRuntimeLocaleSettings,
  subscribeRuntimeLocaleSettings: mocks.subscribeRuntimeLocaleSettings,
}));

describe('OrganizationLocaleProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.subscribeRuntimeLocaleSettings.mockReturnValue(mocks.unsubscribe);
    mocks.useAuth.mockReturnValue({
      user: null,
      currentOrgId: null,
      loading: true,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders children while authentication is loading without fetching settings', () => {
    render(
      <OrganizationLocaleProvider>
        <span>content</span>
      </OrganizationLocaleProvider>,
    );

    expect(screen.getByText('content')).toBeInTheDocument();
    expect(mocks.getSystemSettings).not.toHaveBeenCalled();
    expect(mocks.applyRuntimeLocaleSettings).not.toHaveBeenCalled();
  });

  it('applies defaults when there is no active user or organization', async () => {
    mocks.useAuth.mockReturnValue({
      user: null,
      currentOrgId: null,
      loading: false,
    });

    render(
      <OrganizationLocaleProvider>
        <span>content</span>
      </OrganizationLocaleProvider>,
    );

    await waitFor(() => {
      expect(mocks.applyRuntimeLocaleSettings).toHaveBeenCalledWith(mocks.defaultSettings);
    });
    expect(mocks.getSystemSettings).not.toHaveBeenCalled();
  });

  it('loads and applies settings for the active organization', async () => {
    const settings = {
      currency: 'USD',
      numberFormat: 'ar-SA',
      dateFormat: 'ar-SA',
      defaultWarehouseId: 'warehouse-1',
      printFooter: '',
    };
    mocks.useAuth.mockReturnValue({
      user: { id: 'user-1' },
      currentOrgId: 'org-1',
      loading: false,
    });
    mocks.getSystemSettings.mockResolvedValue(settings);

    render(
      <OrganizationLocaleProvider>
        <span>content</span>
      </OrganizationLocaleProvider>,
    );

    await waitFor(() => {
      expect(mocks.getSystemSettings).toHaveBeenCalledTimes(1);
      expect(mocks.applyRuntimeLocaleSettings).toHaveBeenCalledWith(settings);
    });
  });

  it('logs the error and applies defaults when settings cannot be loaded', async () => {
    const error = new Error('settings unavailable');
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    mocks.useAuth.mockReturnValue({
      user: { id: 'user-1' },
      currentOrgId: 'org-1',
      loading: false,
    });
    mocks.getSystemSettings.mockRejectedValue(error);

    render(
      <OrganizationLocaleProvider>
        <span>content</span>
      </OrganizationLocaleProvider>,
    );

    await waitFor(() => {
      expect(consoleError).toHaveBeenCalledWith(
        'Failed to load organization locale settings:',
        error,
      );
      expect(mocks.applyRuntimeLocaleSettings).toHaveBeenCalledWith(mocks.defaultSettings);
    });
  });

  it('does not apply settings after the provider is unmounted', async () => {
    let resolveSettings: ((value: typeof mocks.defaultSettings) => void) | undefined;
    mocks.useAuth.mockReturnValue({
      user: { id: 'user-1' },
      currentOrgId: 'org-1',
      loading: false,
    });
    mocks.getSystemSettings.mockReturnValue(
      new Promise<typeof mocks.defaultSettings>((resolve) => {
        resolveSettings = resolve;
      }),
    );

    const { unmount } = render(
      <OrganizationLocaleProvider>
        <span>content</span>
      </OrganizationLocaleProvider>,
    );

    await waitFor(() => expect(mocks.getSystemSettings).toHaveBeenCalledTimes(1));
    unmount();

    await act(async () => {
      resolveSettings?.(mocks.defaultSettings);
      await Promise.resolve();
    });

    expect(mocks.applyRuntimeLocaleSettings).not.toHaveBeenCalled();
    expect(mocks.unsubscribe).toHaveBeenCalledTimes(1);
  });

  it('subscribes to runtime changes and cleans up the subscription', () => {
    let listener: (() => void) | undefined;
    mocks.subscribeRuntimeLocaleSettings.mockImplementation((callback: () => void) => {
      listener = callback;
      return mocks.unsubscribe;
    });

    const { unmount } = render(
      <OrganizationLocaleProvider>
        <span>content</span>
      </OrganizationLocaleProvider>,
    );

    expect(mocks.subscribeRuntimeLocaleSettings).toHaveBeenCalledTimes(1);
    act(() => listener?.());
    expect(screen.getByText('content')).toBeInTheDocument();

    unmount();
    expect(mocks.unsubscribe).toHaveBeenCalledTimes(1);
  });
});
