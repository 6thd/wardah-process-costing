/**
 * Safe Service Worker Registration
 * 
 * Handles service worker registration with error handling
 * for contexts where service workers might not be available
 */

/**
 * Register service worker safely
 */
export function registerServiceWorker(scriptPath: string, scope?: string): Promise<ServiceWorkerRegistration | null> {
  return new Promise((resolve) => {
    // Check if service workers are supported
    if (!('serviceWorker' in navigator)) {
      console.warn('Service Workers are not supported in this browser');
      resolve(null);
      return;
    }

    // Check if we're in a secure context (HTTPS or localhost)
    if (!window.isSecureContext) {
      console.warn('Service Workers require a secure context (HTTPS or localhost)');
      resolve(null);
      return;
    }

    navigator.serviceWorker
      .register(scriptPath, { scope: scope || '/' })
      .then((registration) => {
        console.log('✅ Service Worker registered:', registration.scope);
        resolve(registration);
      })
      .catch((error) => {
        console.warn('⚠️ Service Worker registration failed:', error);
        resolve(null);
      });
  });
}

/**
 * Unregister all service workers
 */
export async function unregisterServiceWorkers(): Promise<boolean> {
  if (!('serviceWorker' in navigator)) {
    return false;
  }

  try {
    const registrations = await navigator.serviceWorker.getRegistrations();
    await Promise.all(registrations.map((registration) => registration.unregister()));
    console.log('✅ All Service Workers unregistered');
    return true;
  } catch (error) {
    console.warn('⚠️ Failed to unregister Service Workers:', error);
    return false;
  }
}

export default {
  register: registerServiceWorker,
  unregister: unregisterServiceWorkers,
};


