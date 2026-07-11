export type StrategyLifecycleFilter = 'active' | 'archived' | 'all';

export function parseStrategyLifecycleFilter(value: string | null): StrategyLifecycleFilter {
  if (value === 'archived' || value === 'all') return value;
  return 'active';
}

export function matchesStrategyLifecycle(
  status: string | null | undefined,
  filter: StrategyLifecycleFilter,
) {
  if (filter === 'all') return true;
  return filter === 'active' ? status === 'active' : status !== 'active';
}
