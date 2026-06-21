/**
 * Simple in-memory TTL cache for server-side API responses.
 * Prevents redundant calls to Polymarket APIs when multiple users
 * request the same data within the cache window.
 */

interface CacheEntry<T> {
  data: T;
  expiry: number;
}

const store = new Map<string, CacheEntry<unknown>>();

// Clean expired entries periodically
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of store) {
    if (now > entry.expiry) store.delete(key);
  }
}, 60_000);

/**
 * Get or set a cached value. If the cache has a valid entry, return it.
 * Otherwise, call the factory function, cache the result, and return it.
 */
export async function withCache<T>(
  key: string,
  ttlMs: number,
  factory: () => Promise<T>,
): Promise<T> {
  const cached = store.get(key);
  if (cached && Date.now() < cached.expiry) {
    return cached.data as T;
  }

  const data = await factory();
  store.set(key, { data, expiry: Date.now() + ttlMs });
  return data;
}

/** Invalidate a specific cache key. */
export function invalidateCache(key: string): void {
  store.delete(key);
}

/** Invalidate all cache keys matching a prefix. */
export function invalidateCacheByPrefix(prefix: string): void {
  for (const key of store.keys()) {
    if (key.startsWith(prefix)) store.delete(key);
  }
}

/** Get cache stats for debugging. */
export function getCacheStats(): { size: number; keys: string[] } {
  return { size: store.size, keys: Array.from(store.keys()) };
}
