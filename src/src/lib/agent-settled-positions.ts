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
  settlement_fee?: number;
  closure_type: 'CLOSED' | 'SETTLED';
  settled_at: string;
};

export type ClosedOrderSource = SettledOrderSource & {
  id: string;
  marketQuestion?: string | null;
  price: unknown;
  createdAt: Date | string;
};

function numeric(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function rounded(value: number) {
  return Number(value.toFixed(6));
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
        closure_type: 'SETTLED' as const,
        settled_at: settledAt,
      };
    });
  }).sort((a, b) => b.settled_at.localeCompare(a.settled_at));
}

/** Derive immutable, strategy-scoped full-exit cycles from normalized paper orders. */
export function buildClosedStrategyPositions(
  orders: ClosedOrderSource[],
  strategies: SettledStrategy[],
): AgentSettledPosition[] {
  const strategyById = new Map(strategies.map((strategy) => [strategy.id, strategy]));
  const lots = new Map<string, { quantity: number; cost: number; closedQuantity: number; closedCost: number; proceeds: number; marketQuestion: string | null }>();
  const result: AgentSettledPosition[] = [];
  const sorted = [...orders].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
  for (const order of sorted) {
    const strategy = strategyById.get(order.strategyId);
    if (!strategy) continue;
    const key = `${order.platform}:${order.marketId}:${order.outcome}:${order.strategyId}`;
    const lot = lots.get(key) ?? { quantity: 0, cost: 0, closedQuantity: 0, closedCost: 0, proceeds: 0, marketQuestion: order.marketQuestion ?? null };
    const quantity = numeric(order.quantity);
    const price = numeric(order.price);
    if (order.side === 'BUY') {
      lot.quantity += quantity;
      lot.cost += quantity * price;
    } else if (order.side === 'SELL' && lot.quantity > 0) {
      const removed = Math.min(quantity, lot.quantity);
      const removedCost = lot.quantity > 0 ? lot.cost * (removed / lot.quantity) : 0;
      lot.quantity -= removed;
      lot.cost -= removedCost;
      lot.closedQuantity += removed;
      lot.closedCost += removedCost;
      lot.proceeds += removed * price;
      if (lot.quantity <= 0.000001 && lot.closedQuantity > 0) {
        const closedAt = order.createdAt instanceof Date ? order.createdAt.toISOString() : new Date(order.createdAt).toISOString();
        result.push({
          id: `closed:${order.id}`, strategy_id: strategy.id, strategy_name: strategy.name, agent_id: strategy.userId,
          platform: strategy.platform, market_id: order.marketId, market: lot.marketQuestion || order.marketId, outcome: order.outcome,
          shares: rounded(lot.closedQuantity), avg_price: rounded(lot.closedCost / lot.closedQuantity),
          settlement_price: rounded(lot.proceeds / lot.closedQuantity), cost_basis: rounded(lot.closedCost),
          proceeds: rounded(lot.proceeds), realized_pnl: rounded(lot.proceeds - lot.closedCost),
          closure_type: 'CLOSED', settled_at: closedAt,
        });
        lot.closedQuantity = 0; lot.closedCost = 0; lot.proceeds = 0; lot.cost = 0; lot.quantity = 0;
      }
    }
    lots.set(key, lot);
  }
  return result.sort((a, b) => b.settled_at.localeCompare(a.settled_at));
}
