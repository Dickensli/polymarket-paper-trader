import { Redis } from '@upstash/redis';
import { getCachedValue, setCachedValue } from '@/lib/cache';

// Matches the portfolio price-refresh cadence, so cached dashboards never
// intentionally lag behind more than one normal market-data refresh cycle.
export const AGENT_DASHBOARD_CACHE_TTL_SECONDS = 30;

const redis = process.env.UPSTASH_REDIS_REST_URL
  ? Redis.fromEnv()
  : null;

export type AgentDashboardCacheResult<T> = {
  data: T;
  source: 'memory' | 'redis';
};

export function buildAgentDashboardCacheKey(
  userId: string,
  filters: {
    platform: string;
    agentMode: string;
    strategyStatus: string;
    strategyId: string;
  },
): string {
  return [
    'agent-dashboard:v1',
    userId,
    filters.platform,
    filters.agentMode,
    filters.strategyStatus,
    filters.strategyId,
  ].map(encodeURIComponent).join(':');
}

export async function readAgentDashboardCache<T>(
  key: string,
): Promise<AgentDashboardCacheResult<T> | null> {
  const memoryValue = getCachedValue<T>(key);
  if (memoryValue !== undefined) return { data: memoryValue, source: 'memory' };
  if (!redis) return null;

  const redisValue = await redis.get<T>(key).catch(() => null);
  if (redisValue == null) return null;
  setCachedValue(key, redisValue, AGENT_DASHBOARD_CACHE_TTL_SECONDS * 1000);
  return { data: redisValue, source: 'redis' };
}

export async function writeAgentDashboardCache<T>(key: string, data: T): Promise<void> {
  setCachedValue(key, data, AGENT_DASHBOARD_CACHE_TTL_SECONDS * 1000);
  if (!redis) return;
  await redis.set(key, data, { ex: AGENT_DASHBOARD_CACHE_TTL_SECONDS }).catch(() => null);
}
