export type SettledPositionSource = {
  id: string;
  userId: string;
  marketId: string;
  marketQuestion: string | null;
  outcome: string;
  shares: unknown;
  avgEntryPrice: unknown;
  currentPrice: unknown;
  realizedPnl: unknown;
  resolvedAt: Date | string | null;
};

export type SettledOrderSource = {
  strategyId: string;
  userId: string;
  marketId: string;
  outcome: string;
  side: string;
  quantity: unknown;
  platform: string;
};

export type SettledStrategy = {
  id: string;
  userId: string;
  name: string;
  platform: string;
};

export type AgentSettledPosition = {
  id: string;
  strategy_id: string;
  strategy_name: string;
  agent_id: string;
  platform: string;
  market_id: string;
  market: string;
  outcome: string;
  shares: number;
  avg_price: number;
  settlement_price: number;
  cost_basis: number;
  proceeds: number;
  realized_pnl: number;
  settled_at: string;
};

function numeric(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function buildSettledStrategyPositions(
  closedPositions: SettledPositionSource[],
  orders: SettledOrderSource[],
  strategies: SettledStrategy[],
): AgentSettledPosition[] {
  const strategyById = new Map(strategies.map((strategy) => [strategy.id, strategy]));
  const netShares = new Map<string, number>();

  for (const order of orders) {
    if (!strategyById.has(order.strategyId)) continue;
    const key = `${order.userId}:${order.marketId}:${order.outcome}:${order.strategyId}`;
    const direction = order.side === 'BUY' ? 1 : order.side === 'SELL' ? -1 : 0;
    netShares.set(key, (netShares.get(key) ?? 0) + direction * numeric(order.quantity));
  }

  return closedPositions.flatMap((position) => {
    if (!position.resolvedAt) return [];
    const allocations = strategies.flatMap((strategy) => {
      if (strategy.userId !== position.userId) return [];
      const key = `${position.userId}:${position.marketId}:${position.outcome}:${strategy.id}`;
      const shares = Math.max(0, netShares.get(key) ?? 0);
      return shares > 0 ? [{ strategy, shares }] : [];
    });
    if (allocations.length === 0) return [];

    const allocatedTotal = allocations.reduce((total, allocation) => total + allocation.shares, 0);
    const positionShares = numeric(position.shares);
    const scale = allocatedTotal > 0 && positionShares > 0 ? positionShares / allocatedTotal : 1;
    const avgPrice = numeric(position.avgEntryPrice);
    const settlementPrice = numeric(position.currentPrice);
    const settledAt = position.resolvedAt instanceof Date
      ? position.resolvedAt.toISOString()
      : position.resolvedAt;

    return allocations.map(({ strategy, shares: allocatedShares }) => {
      const shares = allocatedShares * scale;
      const costBasis = shares * avgPrice;
      const proceeds = shares * settlementPrice;
      return {
        id: `${position.id}:${strategy.id}`,
        strategy_id: strategy.id,
        strategy_name: strategy.name,
        agent_id: strategy.userId,
        platform: strategy.platform,
        market_id: position.marketId,
        market: position.marketQuestion || position.marketId,
        outcome: position.outcome,
        shares,
        avg_price: avgPrice,
        settlement_price: settlementPrice,
        cost_basis: costBasis,
        proceeds,
        realized_pnl: proceeds - costBasis,
        settled_at: settledAt,
      };
    });
  }).sort((a, b) => b.settled_at.localeCompare(a.settled_at));
}
