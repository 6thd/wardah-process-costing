import { useEffect, useState, type PropsWithChildren } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { getSystemSettings } from '@/services/org-settings-service';
import {
  applyRuntimeLocaleSettings,
  DEFAULT_RUNTIME_LOCALE_SETTINGS,
  subscribeRuntimeLocaleSettings,
} from '@/lib/runtime-locale-settings';

/**
 * Loads formatting settings for the active organization and makes them
 * available to the shared number/date helpers. The provider also forces a
 * lightweight rerender whenever settings are saved, so existing screens pick
 * up the new number/calendar format immediately without a page reload.
 */
export function OrganizationLocaleProvider({ children }: PropsWithChildren) {
  const { user, currentOrgId, loading } = useAuth();
  const [, setRevision] = useState(0);

  useEffect(() => subscribeRuntimeLocaleSettings(() => {
    setRevision((revision) => revision + 1);
  }), []);

  useEffect(() => {
    let cancelled = false;

    async function loadSettings() {
      if (loading) return;
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
    return () => {
      cancelled = true;
    };
  }, [user?.id, currentOrgId, loading]);

  return children;
}
