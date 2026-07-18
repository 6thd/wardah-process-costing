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