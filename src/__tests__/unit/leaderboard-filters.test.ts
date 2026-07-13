import { describe, expect, it } from 'vitest';
import { parseLeaderboardStrategyStatus } from '@/lib/leaderboard-filters';

describe('parseLeaderboardStrategyStatus', () => {
  it('defaults missing and invalid values to active', () => {
    expect(parseLeaderboardStrategyStatus(null)).toBe('active');
    expect(parseLeaderboardStrategyStatus('archived')).toBe('active');
  });

  it.each(['active', 'paused', 'disabled', 'all'] as const)('accepts %s', (status) => {
    expect(parseLeaderboardStrategyStatus(status)).toBe(status);
  });
});
