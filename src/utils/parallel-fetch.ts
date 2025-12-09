/**
 * Utility for parallel data fetching
 * Reduces page load time by fetching multiple resources simultaneously
 */

/**
 * Fetch multiple resources in parallel with timeout
 */
export async function fetchParallel<T extends Record<string, Promise<any>>>(
  promises: T,
  timeoutMs: number = 10000
): Promise<{ [K in keyof T]: Awaited<T[K]> }> {
  const timeoutPromise = new Promise((_, reject) =>
    setTimeout(() => reject(new Error('Parallel fetch timed out')), timeoutMs)
  );

  const results = await Promise.race([
    Promise.allSettled(Object.entries(promises).map(async ([key, promise]) => {
      try {
        return { key, status: 'fulfilled' as const, value: await promise };
      } catch (error) {
        return { key, status: 'rejected' as const, reason: error };
      }
    })),
    timeoutPromise,
  ]) as PromiseSettledResult<any>[];

  const result: any = {};
  for (const item of results) {
    if (item.status === 'fulfilled') {
      result[item.value.key] = item.value.value;
    } else {
      // Set to null or empty array on error
      result[item.value.key] = null;
    }
  }

  return result;
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


