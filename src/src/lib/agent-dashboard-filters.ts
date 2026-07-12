export type StrategyLifecycleFilter = 'active' | 'archived' | 'all';

export function parseStrategyLifecycleFilter(value: string | null): StrategyLifecycleFilter {
  if (value === 'active' || value === 'archived') return value;
  return 'all';
}

export function matchesStrategyLifecycle(
  status: string | null | undefined,
  filter: StrategyLifecycleFilter,
) {
  if (filter === 'all') return true;
  return filter === 'active' ? status === 'active' : status !== 'active';
}
