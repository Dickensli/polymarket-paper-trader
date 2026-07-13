import type { AgentSettledPosition, SettledStrategy } from '@/lib/agent-settled-positions';

type Settlement = { id: string; platform: string; marketId: string; marketResult: string; yesQuantity: unknown; noQuantity: unknown; yesCost: unknown; noCost: unknown; revenue: unknown; fee: unknown; settledAt: Date | string };
type Fill = { strategyId: string | null; platform?: string; marketId: string; outcome: string | null; side: string | null; quantity: unknown; price: unknown; fee: unknown; filledAt: Date | string };
const n = (v: unknown) => Number.isFinite(Number(v)) ? Number(v) : 0;
const rounded = (value: number) => Number(value.toFixed(6));

export function buildOfficialSettledStrategyPositions(settlements: Settlement[], fills: Fill[], strategies: SettledStrategy[]): AgentSettledPosition[] {
  const strategyById = new Map(strategies.map((s) => [s.id, s]));
  const lots = new Map<string, { quantity: number; cost: number }>();
  for (const fill of [...fills].sort((a, b) => new Date(a.filledAt).getTime() - new Date(b.filledAt).getTime())) {
    if (!fill.strategyId || !fill.outcome || !strategyById.has(fill.strategyId)) continue;
    const fillPlatform = fill.platform ?? strategyById.get(fill.strategyId)!.platform;
    const key = `${fillPlatform}:${fill.marketId}:${fill.outcome}:${fill.strategyId}`; const lot = lots.get(key) ?? { quantity: 0, cost: 0 };
    const quantity = n(fill.quantity); const price = n(fill.price); const fee = n(fill.fee);
    if (fill.side === 'BUY') { lot.quantity += quantity; lot.cost += quantity * price + fee; }
    if (fill.side === 'SELL' && lot.quantity > 0) { const removed = Math.min(quantity, lot.quantity); lot.cost -= (lot.cost / lot.quantity) * removed; lot.quantity -= removed; }
    lots.set(key, lot);
  }
  const result: AgentSettledPosition[] = [];
  for (const settlement of settlements) for (const outcome of ['YES', 'NO'] as const) {
    const officialQuantity = n(outcome === 'YES' ? settlement.yesQuantity : settlement.noQuantity); if (officialQuantity <= 0) continue;
    const candidates = [...lots.entries()].filter(([key, lot]) => key.startsWith(`${settlement.platform}:${settlement.marketId}:${outcome}:`) && lot.quantity > 0);
    const total = candidates.reduce((sum, [, lot]) => sum + lot.quantity, 0); if (total <= 0) continue;
    const scale = Math.min(1, officialQuantity / total);
    for (const [key, lot] of candidates) {
      const strategyId = key.split(':').at(-1)!; const strategy = strategyById.get(strategyId)!;
      const shares = lot.quantity * scale; const cost = lot.cost * scale; const won = settlement.marketResult.toUpperCase() === outcome;
      const proceeds = won && officialQuantity > 0 ? n(settlement.revenue) * (shares / officialQuantity) : 0;
      const officialTotalQuantity = n(settlement.yesQuantity) + n(settlement.noQuantity);
      const settlementFee = officialTotalQuantity > 0 ? n(settlement.fee) * (shares / officialTotalQuantity) : 0;
      const settledAt = new Date(settlement.settledAt).toISOString();
      result.push({ id: `${settlement.id}:${strategyId}:${outcome}`, strategy_id: strategyId, strategy_name: strategy.name, agent_id: strategy.userId, platform: settlement.platform, market_id: settlement.marketId, market: settlement.marketId, outcome, shares: rounded(shares), avg_price: shares ? rounded(cost / shares) : 0, settlement_price: won ? rounded(proceeds / shares) : 0, cost_basis: rounded(cost), proceeds: rounded(proceeds), settlement_fee: rounded(settlementFee), realized_pnl: rounded(proceeds - cost - settlementFee), closure_type: 'SETTLED', settled_at: settledAt });
    }
  }
  return result.sort((a, b) => b.settled_at.localeCompare(a.settled_at));
}
