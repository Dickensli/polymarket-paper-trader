import { describe, expect, it } from 'vitest';
import { buildAgentDashboardCacheKey } from '@/lib/agent-dashboard-cache';

describe('agent dashboard cache keys', () => {
  const filters = {
    platform: 'all',
    agentMode: 'all',
    strategyStatus: 'active',
    strategyId: 'all',
  };

  it('isolates cached dashboards by user', () => {
    expect(buildAgentDashboardCacheKey('user-1', filters))
      .not.toBe(buildAgentDashboardCacheKey('user-2', filters));
  });

  it('isolates each filter combination', () => {
    expect(buildAgentDashboardCacheKey('user-1', filters))
      .not.toBe(buildAgentDashboardCacheKey('user-1', { ...filters, platform: 'kalshi' }));
  });

  it('escapes user-controlled key segments', () => {
    expect(buildAgentDashboardCacheKey('user:1', filters)).toContain('user%3A1');
  });
});
