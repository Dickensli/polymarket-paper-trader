export type LeaderboardStrategyStatus = 'active' | 'paused' | 'disabled' | 'all';

export function parseLeaderboardStrategyStatus(value: string | null): LeaderboardStrategyStatus {
  if (value === 'paused' || value === 'disabled' || value === 'all') return value;
  return 'active';
}
