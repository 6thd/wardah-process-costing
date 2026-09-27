// src/pages/org-admin/__tests__/supabase-query-mock.ts
//
// Minimal chainable stand-in for the Supabase query builder used by the
// org-admin read-failure tests. Every builder method records its call and
// returns the builder; awaiting it asks `resolve(table, calls)` for the
// response, so a test can answer per table and per filter shape (for example
// role_permissions `.eq` for the editor vs `.in` for the per-role counts).
// `resolve` may return `{ data, error }` or throw to simulate a thrown read.

export interface QueryCall {
  method: string;
  args: unknown[];
}

export type QueryResolver = (
  table: string,
  calls: QueryCall[]
) => { data: unknown; error: unknown } | Promise<{ data: unknown; error: unknown }>;

const CHAIN_METHODS = ['select', 'eq', 'in', 'order', 'limit', 'neq', 'is'] as const;

export function makeFrom(getResolver: () => QueryResolver) {
  return (table: string) => {
    const calls: QueryCall[] = [];
    // A native Promise is already awaitable. Decorate it with the query
    // methods instead of manufacturing a `then` member on a plain object.
    // The resolver runs in a microtask, after synchronous method chaining.
    const builder: Record<string, unknown> = Promise.resolve()
      .then(() => getResolver()(table, calls)) as unknown as Record<string, unknown>;
    for (const method of CHAIN_METHODS) {
      builder[method] = (...args: unknown[]) => {
        calls.push({ method, args });
        return builder;
      };
    }
    return builder;
  };
}

export function usedMethod(calls: QueryCall[], method: string): boolean {
  return calls.some(c => c.method === method);
}
