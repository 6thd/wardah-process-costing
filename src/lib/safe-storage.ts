/**
 * Safe Storage Utilities
 * 
 * Provides safe access to localStorage/sessionStorage with error handling
 * for contexts where storage access might be restricted (e.g., iframes, third-party contexts)
 */

/**
 * Check if storage is available
 */
function isStorageAvailable(type: 'localStorage' | 'sessionStorage'): boolean {
  try {
    const storage = window[type];
    const testKey = '__storage_test__';
    storage.setItem(testKey, 'test');
    storage.removeItem(testKey);
    return true;
  } catch (e) {
    return false;
  }
}

/**
 * Safe localStorage wrapper
 */
export const safeLocalStorage = {
  getItem: (key: string): string | null => {
    try {
      if (!isStorageAvailable('localStorage')) {
        // Silently fail - don't log warnings for expected cases (iframes, etc.)
        return null;
      }
      return localStorage.getItem(key);
    } catch (error) {
      // Silently fail - don't log warnings for expected cases
      return null;
    }
  },

  setItem: (key: string, value: string): boolean => {
    try {
      if (!isStorageAvailable('localStorage')) {
        // Silently fail - don't log warnings for expected cases
        return false;
      }
      localStorage.setItem(key, value);
      return true;
    } catch (error) {
      // Silently fail - don't log warnings for expected cases
      return false;
    }
  },

  removeItem: (key: string): boolean => {
    try {
      if (!isStorageAvailable('localStorage')) {
        // Silently fail - don't log warnings for expected cases
        return false;
      }
      localStorage.removeItem(key);
      return true;
    } catch (error) {
      // Silently fail - don't log warnings for expected cases
      return false;
    }
  },

  clear: (): boolean => {
    try {
      if (!isStorageAvailable('localStorage')) {
        // Silently fail - don't log warnings for expected cases
        return false;
      }
      localStorage.clear();
      return true;
    } catch (error) {
      // Silently fail - don't log warnings for expected cases
      return false;
    }
  },
};

/**
 * Safe sessionStorage wrapper
 */
export const safeSessionStorage = {
  getItem: (key: string): string | null => {
    try {
      if (!isStorageAvailable('sessionStorage')) {
        // Silently fail - don't log warnings for expected cases
        return null;
      }
      return sessionStorage.getItem(key);
    } catch (error) {
      // Silently fail - don't log warnings for expected cases
      return null;
    }
  },

  setItem: (key: string, value: string): boolean => {
    try {
      if (!isStorageAvailable('sessionStorage')) {
        // Silently fail - don't log warnings for expected cases
        return false;
      }
      sessionStorage.setItem(key, value);
      return true;
    } catch (error) {
      // Silently fail - don't log warnings for expected cases
      return false;
    }
  },

  removeItem: (key: string): boolean => {
    try {
      if (!isStorageAvailable('sessionStorage')) {
        // Silently fail - don't log warnings for expected cases
        return false;
      }
      sessionStorage.removeItem(key);
      return true;
    } catch (error) {
      // Silently fail - don't log warnings for expected cases
      return false;
    }
  },

  clear: (): boolean => {
    try {
      if (!isStorageAvailable('sessionStorage')) {
        // Silently fail - don't log warnings for expected cases
        return false;
      }
      sessionStorage.clear();
      return true;
    } catch (error) {
      // Silently fail - don't log warnings for expected cases
      return false;
    }
  },
};

/**
 * Safe storage adapter for Zustand persist middleware
 */
export const safeStorageAdapter = {
  getItem: (name: string): string | null => {
    return safeLocalStorage.getItem(name);
  },
  setItem: (name: string, value: string): void => {
    safeLocalStorage.setItem(name, value);
  },
  removeItem: (name: string): void => {
    safeLocalStorage.removeItem(name);
  },
};

export default {
  localStorage: safeLocalStorage,
  sessionStorage: safeSessionStorage,
  adapter: safeStorageAdapter,
};

