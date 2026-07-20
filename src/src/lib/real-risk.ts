export interface RealRiskLimits {
  maxTradePct: number;
  maxRiskGroupExposurePct: number;
  minCashReservePct: number;
  maxDailyLossPct: number;
  maxDrawdownPct: number;
  maxDailyBuyTrades: number;
}

export const DEFAULT_REAL_RISK_LIMITS: RealRiskLimits = {
  maxTradePct: 0.02,
  maxRiskGroupExposurePct: 0.05,
  minCashReservePct: 0.30,
  maxDailyLossPct: 0.02,
  maxDrawdownPct: 0.05,
  maxDailyBuyTrades: 3,
};

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? value as Record<string, unknown> : {};
}

function ratio(config: Record<string, unknown>, keys: string[], fallback: number) {
  for (const key of keys) {
    const value = Number(config[key]);
    if (Number.isFinite(value) && value >= 0 && value <= 1) return value;
    if (Number.isFinite(value) && value > 1 && value <= 100) return value / 100;
  }
  return fallback;
}

function positiveInteger(config: Record<string, unknown>, keys: string[], fallback: number) {
  for (const key of keys) {
    const value = Number(config[key]);
    if (Number.isInteger(value) && value > 0) return value;
  }
  return fallback;
}

function cappedRatio(config: Record<string, unknown>, keys: string[], ceiling: number) {
  return Math.min(ratio(config, keys, ceiling), ceiling);
}

function reserveRatio(config: Record<string, unknown>, keys: string[], floor: number) {
  return Math.max(ratio(config, keys, floor), floor);
}

export function resolveRealRiskLimits(value: unknown): RealRiskLimits {
  const config = record(value);
  return {
    maxTradePct: cappedRatio(config, ['max_trade_pct', 'maxTradePct', 'max_single_trade_pct', 'maxSingleTradePct'], DEFAULT_REAL_RISK_LIMITS.maxTradePct),
    maxRiskGroupExposurePct: cappedRatio(config, ['max_market_exposure_pct', 'maxMarketExposurePct', 'max_event_exposure_pct', 'maxEventExposurePct'], DEFAULT_REAL_RISK_LIMITS.maxRiskGroupExposurePct),
    minCashReservePct: reserveRatio(config, ['min_cash_reserve_pct', 'minCashReservePct'], DEFAULT_REAL_RISK_LIMITS.minCashReservePct),
    maxDailyLossPct: cappedRatio(config, ['max_daily_loss_pct', 'maxDailyLossPct', 'daily_loss_stop_pct', 'dailyLossStopPct'], DEFAULT_REAL_RISK_LIMITS.maxDailyLossPct),
    maxDrawdownPct: cappedRatio(config, ['max_drawdown_pct', 'maxDrawdownPct', 'drawdown_stop_pct', 'drawdownStopPct'], DEFAULT_REAL_RISK_LIMITS.maxDrawdownPct),
    maxDailyBuyTrades: Math.min(
      positiveInteger(config, ['max_daily_trades', 'maxDailyTrades', 'max_daily_buy_trades', 'maxDailyBuyTrades'], DEFAULT_REAL_RISK_LIMITS.maxDailyBuyTrades),
      DEFAULT_REAL_RISK_LIMITS.maxDailyBuyTrades,
    ),
  };
}

function numberFrom(value: unknown): number | null {
  if (value && typeof value === 'object' && 'value' in value) {
    return numberFrom((value as Record<string, unknown>).value);
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function positionRiskValue(position: Record<string, unknown>): number {
  for (const key of ['position_cost_dollars', 'market_exposure_dollars', 'costBasis', 'cost_basis', 'totalCost']) {
    const value = numberFrom(position[key]);
    if (value !== null) return Math.abs(value);
  }
  for (const key of ['position_cost', 'market_exposure']) {
    const value = numberFrom(position[key]);
    if (value !== null) return Math.abs(value) / 100;
  }
  for (const key of ['cashValue', 'marketValue', 'market_value_dollars']) {
    const value = numberFrom(position[key]);
    if (value !== null) return Math.abs(value);
  }
  const centsValue = numberFrom(position.market_value);
  if (centsValue !== null) return Math.abs(centsValue) / 100;

  const quantity = numberFrom(position.position_fp ?? position.quantity ?? position.shares ?? position.position);
  const price = numberFrom(position.avgEntryPrice ?? position.average_price ?? position.price);
  return quantity !== null && price !== null ? Math.abs(quantity * price) : 0;
}

export function calculateOfficialRiskGroupExposure(
  positions: unknown[],
  riskGroupId: string,
  marketId: string,
): number {
  const identityKeys = [
    'risk_group_id', 'riskGroupId', 'event_ticker', 'eventTicker', 'eventSlug',
    'market_slug', 'marketSlug', 'market_id', 'marketId', 'ticker', 'market_ticker', 'slug',
  ];
  return positions.reduce<number>((sum, value) => {
    const position = record(value);
    const identities = identityKeys.map((key) => String(position[key] ?? '')).filter(Boolean);
    if (!identities.includes(riskGroupId) && !identities.includes(marketId)) return sum;
    return sum + positionRiskValue(position);
  }, 0);
}

export function isOfficialBuyRiskReducing(
  positions: unknown[],
  marketId: string,
  outcome: 'YES' | 'NO',
  requestedQuantity: number,
): boolean {
  if (!Number.isFinite(requestedQuantity) || requestedQuantity <= 0) return false;
  for (const value of positions) {
    const position = record(value);
    const identity = String(
      position.ticker ?? position.market_ticker ?? position.marketId
      ?? position.market_id ?? position.marketSlug ?? position.market_slug ?? position.slug ?? '',
    );
    if (identity !== marketId) continue;
    const netYes = numberFrom(position.position_fp ?? position.position);
    if (netYes === null || netYes === 0 || requestedQuantity > Math.abs(netYes) + 1e-9) return false;
    return (netYes < 0 && outcome === 'YES') || (netYes > 0 && outcome === 'NO');
  }
  return false;
}

export function validateRealBuyRisk(args: {
  nav: number;
  cash: number;
  notional: number;
  existingRiskGroupExposure: number;
  dailyStartNav: number;
  peakNav: number;
  dailyBuyTrades: number;
  riskConfig?: unknown;
  maxDailyBuyTrades?: number;
  runBuyTrades?: number;
  maxRunBuyTrades?: number;
}): string | null {
  const limits = resolveRealRiskLimits(args.riskConfig);
  const { nav, cash, notional } = args;
  if (!Number.isFinite(nav) || nav <= 0) return 'Cannot buy when official portfolio NAV is zero or invalid';
  if (!Number.isFinite(notional) || notional <= 0) return 'Real trade notional is invalid';
  if (notional > nav * limits.maxTradePct + 1e-9) {
    return `Trade notional exceeds ${(limits.maxTradePct * 100).toFixed(1)}% of official portfolio NAV`;
  }
  if (args.existingRiskGroupExposure + notional > nav * limits.maxRiskGroupExposurePct + 1e-9) {
    return `Cumulative event exposure exceeds ${(limits.maxRiskGroupExposurePct * 100).toFixed(1)}% of official portfolio NAV`;
  }
  if (cash - notional < nav * limits.minCashReservePct - 1e-9) {
    return `Trade would breach the ${(limits.minCashReservePct * 100).toFixed(1)}% official cash reserve`;
  }
  if (args.dailyStartNav > 0 && (args.dailyStartNav - nav) / args.dailyStartNav >= limits.maxDailyLossPct - 1e-12) {
    return `Daily loss stop of ${(limits.maxDailyLossPct * 100).toFixed(1)}% has been reached`;
  }
  if (args.peakNav > 0 && (args.peakNav - nav) / args.peakNav >= limits.maxDrawdownPct - 1e-12) {
    return `Drawdown stop of ${(limits.maxDrawdownPct * 100).toFixed(1)}% has been reached`;
  }
  const dailyLimit = Math.min(limits.maxDailyBuyTrades, args.maxDailyBuyTrades ?? limits.maxDailyBuyTrades);
  if (args.dailyBuyTrades >= dailyLimit) {
    return `Daily BUY limit of ${dailyLimit} has been reached`;
  }
  if (args.maxRunBuyTrades !== undefined && (args.runBuyTrades ?? 0) >= args.maxRunBuyTrades) {
    return `Strategy per-run BUY limit of ${args.maxRunBuyTrades} has been reached`;
  }
  return null;
}
