// =============================================================================
// Unit Tests: In-Memory TTL Cache
// =============================================================================
//
// Tests the cache module's TTL behavior, concurrent access patterns,
// cache invalidation, and edge cases around expiry timing.
// =============================================================================

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// We need to re-import each test to get a fresh module. For now, test
// the exported functions by importing them directly.
// Note: The cache module uses a module-level Map, so we test it as-is.

// We'll dynamically import to control the module state
let withCache: typeof import('@/lib/cache').withCache;
let invalidateCache: typeof import('@/lib/cache').invalidateCache;
let invalidateCacheByPrefix: typeof import('@/lib/cache').invalidateCacheByPrefix;
let getCacheStats: typeof import('@/lib/cache').getCacheStats;

beforeEach(async () => {
  // Use fake timers to control TTL behavior precisely
  vi.useFakeTimers();
  // Reset module to get a clean Map
  vi.resetModules();
  const mod = await import('@/lib/cache');
  withCache = mod.withCache;
  invalidateCache = mod.invalidateCache;
  invalidateCacheByPrefix = mod.invalidateCacheByPrefix;
  getCacheStats = mod.getCacheStats;
});

afterEach(() => {
  vi.useRealTimers();
});

describe('withCache', () => {
  it('calls the factory on first access (cache miss)', async () => {
    const factory = vi.fn().mockResolvedValue({ data: 'fresh' });
    const result = await withCache('key1', 5000, factory);

    expect(factory).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ data: 'fresh' });
  });

  it('returns cached value on second call within TTL', async () => {
    const factory = vi.fn().mockResolvedValue('value1');
    await withCache('key2', 5000, factory);

    // Advance time but stay within TTL
    vi.advanceTimersByTime(3000);

    const factory2 = vi.fn().mockResolvedValue('value2');
    const result = await withCache('key2', 5000, factory2);

    expect(factory2).not.toHaveBeenCalled();
    expect(result).toBe('value1');
  });

  it('calls factory again after TTL expires', async () => {
    const factory1 = vi.fn().mockResolvedValue('old');
    await withCache('key3', 5000, factory1);

    // Advance past TTL
    vi.advanceTimersByTime(6000);

    const factory2 = vi.fn().mockResolvedValue('new');
    const result = await withCache('key3', 5000, factory2);

    expect(factory2).toHaveBeenCalledTimes(1);
    expect(result).toBe('new');
  });

  it('does NOT cache when factory throws', async () => {
    const failingFactory = vi.fn().mockRejectedValue(new Error('API down'));
    await expect(withCache('key4', 5000, failingFactory)).rejects.toThrow(
      'API down',
    );

    // Stats should not have this key
    const stats = getCacheStats();
    expect(stats.keys).not.toContain('key4');
  });

  it('caches different keys independently', async () => {
    await withCache('alpha', 5000, async () => 'A');
    await withCache('beta', 5000, async () => 'B');

    const stats = getCacheStats();
    expect(stats.size).toBe(2);
    expect(stats.keys).toContain('alpha');
    expect(stats.keys).toContain('beta');
  });

  it('handles TTL = 0 (always misses)', async () => {
    const factory = vi.fn().mockResolvedValue('result');
    await withCache('zero-ttl', 0, factory);
    // Advance 1ms so Date.now() > expiry
    vi.advanceTimersByTime(1);
    await withCache('zero-ttl', 0, factory);

    expect(factory).toHaveBeenCalledTimes(2);
  });

  it('handles concurrent calls to the same key (stampede)', async () => {
    let callCount = 0;
    const slowFactory = vi.fn().mockImplementation(async () => {
      callCount++;
      return `value-${callCount}`;
    });

    // Fire two calls "simultaneously"
    const [r1, r2] = await Promise.all([
      withCache('stampede', 5000, slowFactory),
      withCache('stampede', 5000, slowFactory),
    ]);

    // Both should get values (current implementation doesn't deduplicate,
    // but both results should be consistent types)
    expect(typeof r1).toBe('string');
    expect(typeof r2).toBe('string');
  });
});

describe('invalidateCache', () => {
  it('removes a specific cache entry', async () => {
    await withCache('remove-me', 5000, async () => 'data');
    expect(getCacheStats().keys).toContain('remove-me');

    invalidateCache('remove-me');
    expect(getCacheStats().keys).not.toContain('remove-me');
  });

  it('is a no-op for non-existent keys', () => {
    expect(() => invalidateCache('does-not-exist')).not.toThrow();
  });

  it('forces factory call after invalidation', async () => {
    const factory = vi.fn().mockResolvedValue('v1');
    await withCache('inv-test', 60_000, factory);

    invalidateCache('inv-test');

    factory.mockResolvedValue('v2');
    const result = await withCache('inv-test', 60_000, factory);
    expect(result).toBe('v2');
    expect(factory).toHaveBeenCalledTimes(2);
  });
});

describe('invalidateCacheByPrefix', () => {
  it('removes all keys matching the prefix', async () => {
    await withCache('markets:list', 5000, async () => []);
    await withCache('markets:detail:abc', 5000, async () => ({}));
    await withCache('portfolio:user1', 5000, async () => ({}));

    invalidateCacheByPrefix('markets:');

    const stats = getCacheStats();
    expect(stats.keys).not.toContain('markets:list');
    expect(stats.keys).not.toContain('markets:detail:abc');
    expect(stats.keys).toContain('portfolio:user1');
  });

  it('handles empty prefix (clears everything)', async () => {
    await withCache('a', 5000, async () => 1);
    await withCache('b', 5000, async () => 2);

    invalidateCacheByPrefix('');

    expect(getCacheStats().size).toBe(0);
  });

  it('handles no matches gracefully', () => {
    expect(() => invalidateCacheByPrefix('nonexistent:')).not.toThrow();
  });
});

describe('getCacheStats', () => {
  it('returns empty state initially', () => {
    const stats = getCacheStats();
    expect(stats.size).toBe(0);
    expect(stats.keys).toEqual([]);
  });

  it('reflects correct count after insertions', async () => {
    await withCache('s1', 5000, async () => 1);
    await withCache('s2', 5000, async () => 2);
    await withCache('s3', 5000, async () => 3);

    const stats = getCacheStats();
    expect(stats.size).toBe(3);
    expect(stats.keys).toHaveLength(3);
  });
});
