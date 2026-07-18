import { useEffect, type PropsWithChildren } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { getSystemSettings } from '@/services/org-settings-service';
import {
  applyRuntimeLocaleSettings,
  DEFAULT_RUNTIME_LOCALE_SETTINGS,
} from '@/lib/runtime-locale-settings';

/**
 * Loads formatting settings for the active organization and makes them
 * available to the shared number/date helpers. Reloads automatically when
 * the authenticated user or selected organization changes.
 */
export function OrganizationLocaleProvider({ children }: PropsWithChildren) {
  const { user, currentOrgId, isLoading } = useAuth();

  useEffect(() => {
    let cancelled = false;

    async function loadSettings() {
      if (isLoading) return;
      if (!user || !currentOrgId) {
        applyRuntimeLocaleSettings(DEFAULT_RUNTIME_LOCALE_SETTINGS);
        return;
      }

      try {
        const settings = await getSystemSettings();
        if (!cancelled) applyRuntimeLocaleSettings(settings);
      } catch (error) {
        console.error('Failed to load organization locale settings:', error);
        if (!cancelled) applyRuntimeLocaleSettings(DEFAULT_RUNTIME_LOCALE_SETTINGS);
      }
    }

    void loadSettings();
    return () => { cancelled = true; };
  }, [user?.id, currentOrgId, isLoading]);

  return children;
}
