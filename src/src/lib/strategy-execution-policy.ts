export interface StrategyExecutionPolicy {
  minimumNetEdge: number;
  maxDailyBuyTrades?: number;
  maxBuyTradesPerRun?: number;
}

const BASELINE_POLICY: StrategyExecutionPolicy = { minimumNetEdge: 0.02 };

const POLICIES: Record<string, StrategyExecutionPolicy> = {
  'kalshi:paper:commander': { minimumNetEdge: 0.08, maxBuyTradesPerRun: 2 },
  'kalshi:paper:high_freq_retro': { minimumNetEdge: 0.08, maxDailyBuyTrades: 6, maxBuyTradesPerRun: 2 },
  'polymarket_us:paper:high_freq_retro': { minimumNetEdge: 0.06, maxDailyBuyTrades: 8, maxBuyTradesPerRun: 2 },
  'kalshi:real:commander_real': { minimumNetEdge: 0.12, maxDailyBuyTrades: 3, maxBuyTradesPerRun: 1 },
};

export function resolveStrategyExecutionPolicy(
  platform: string,
  agentMode: string,
  strategyId: string,
): StrategyExecutionPolicy {
  return POLICIES[`${platform}:${agentMode}:${strategyId}`] ?? BASELINE_POLICY;
}
