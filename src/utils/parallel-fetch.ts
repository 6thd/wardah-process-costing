/**
 * Utility for parallel data fetching
 * Reduces page load time by fetching multiple resources simultaneously
 */

/**
 * Fetch multiple resources in parallel with timeout
 */
export async function fetchParallel<T extends Record<string, Promise<unknown>>>(
  promises: T,
  timeoutMs: number = 10000
): Promise<{ [K in keyof T]: Awaited<T[K]> | null }> {
  const timeoutPromise = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error('Parallel fetch timed out')), timeoutMs)
  );

  type SettledResult = {
    key: string;
    status: 'fulfilled' | 'rejected';
    value?: unknown;
    reason?: unknown;
  };

  const results = await Promise.race([
    Promise.allSettled(Object.entries(promises).map(async ([key, promise]): Promise<SettledResult> => {
      try {
        const value = await promise;
        return { key, status: 'fulfilled', value };
      } catch (error) {
        return { key, status: 'rejected', reason: error };
      }
    })),
    timeoutPromise,
  ]) as SettledResult[];

  const result: Record<string, unknown> = {};
  for (const item of results) {
    if (item.status === 'fulfilled' && item.value !== undefined) {
      result[item.key] = item.value;
    } else {
      // Set to null on error
      result[item.key] = null;
    }
  }

  return result as { [K in keyof T]: Awaited<T[K]> | null };
}

/**
 * Fetch with retry and timeout
 */
export async function fetchWithRetry<T>(
  fn: () => Promise<T>,
  options: {
    maxRetries?: number;
    timeoutMs?: number;
    retryDelay?: number;
  } = {}
): Promise<T> {
  const { maxRetries = 2, timeoutMs = 10000, retryDelay = 1000 } = options;
  
  let lastError: Error | null = null;
  
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const timeoutPromise = new Promise<T>((_, reject) =>
        setTimeout(() => reject(new Error('Request timed out')), timeoutMs)
      );
      
      return await Promise.race([fn(), timeoutPromise]);
    } catch (error) {
      lastError = error as Error;
      if (attempt < maxRetries) {
        await new Promise(resolve => setTimeout(resolve, retryDelay * (attempt + 1)));
      }
    }
  }
  
  throw lastError || new Error('Failed to fetch');
}


