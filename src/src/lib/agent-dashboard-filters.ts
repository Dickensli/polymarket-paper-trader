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

type ReportStrategy = {
  id: string;
  platform: string;
  agentMode: string;
  status: string;
};

type ReportStrategyFilters = {
  platform: string;
  agentMode: string;
  lifecycle: StrategyLifecycleFilter;
  strategyId: string;
};

export function matchingReportStrategyIds(
  strategies: ReportStrategy[],
  filters: ReportStrategyFilters,
): string[] {
  return strategies
    .filter((strategy) => {
      if (filters.strategyId !== 'all' && strategy.id !== filters.strategyId) return false;
      if (filters.platform !== 'all' && strategy.platform !== filters.platform) return false;
      if (filters.agentMode !== 'all' && strategy.agentMode !== filters.agentMode) return false;
      return matchesStrategyLifecycle(strategy.status, filters.lifecycle);
    })
    .map((strategy) => strategy.id);
}

export function snapshotIsStale(
  capturedAt: string | Date,
  now = new Date(),
  maxAgeMinutes = 30,
): boolean {
  const capturedTime = new Date(capturedAt).getTime();
  if (!Number.isFinite(capturedTime)) return true;
  return now.getTime() - capturedTime > maxAgeMinutes * 60_000;
}
