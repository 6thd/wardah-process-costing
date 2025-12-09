/**
 * Utility for adding timeout to async operations
 * Helps prevent hanging requests that slow down page loads
 */

export function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number = 10000,
  errorMessage: string = 'Operation timed out'
): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(errorMessage)), timeoutMs)
    ),
  ]);
}

/**
 * Create a timeout promise that can be cancelled
 */
export function createTimeout(timeoutMs: number): {
  promise: Promise<never>;
  cancel: () => void;
} {
  let timeoutId: NodeJS.Timeout | null = null;
  
  const promise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(`Operation timed out after ${timeoutMs}ms`));
    }, timeoutMs);
  });
  
  const cancel = () => {
    if (timeoutId) {
      clearTimeout(timeoutId);
      timeoutId = null;
    }
  };
  
  return { promise, cancel };
}


