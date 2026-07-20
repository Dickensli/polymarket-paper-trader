import type { Portfolio } from '@/lib/types';

export interface PaperRiskLimits {
  maxTradePct: number;
  maxMarketExposurePct: number;
  minCashReservePct: number;
  maxDailyLossPct: number;
  maxDrawdownPct: number;
  maxDailyBuyTrades: number;
}

export const DEFAULT_PAPER_RISK_LIMITS: PaperRiskLimits = {
  maxTradePct: 0.10,
  maxMarketExposurePct: 0.20,
  minCashReservePct: 0.05,
  maxDailyLossPct: 0.02,
  maxDrawdownPct: 0.05,
  maxDailyBuyTrades: 8,
};

function readRatio(config: Record<string, unknown>, keys: string[], fallback: number): number {
  for (const key of keys) {
    const value = Number(config[key]);
    if (Number.isFinite(value) && value >= 0 && value <= 1) return value;
    // Legacy agents sometimes registered human percentage points (3, 5, 15)
    // instead of ratios (0.03, 0.05, 0.15). Normalize them rather than
    // silently replacing stricter limits with permissive server defaults.
    if (Number.isFinite(value) && value > 1 && value <= 100) return value / 100;
  }
  return fallback;
}

export function resolvePaperRiskLimits(value: unknown): PaperRiskLimits {
  const config = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  return {
    maxTradePct: Math.min(
      readRatio(config, ['max_trade_pct', 'maxTradePct', 'max_single_trade_pct', 'maxSingleTradePct'], DEFAULT_PAPER_RISK_LIMITS.maxTradePct),
      DEFAULT_PAPER_RISK_LIMITS.maxTradePct,
    ),
    maxMarketExposurePct: Math.min(
      readRatio(config, [
        'max_market_exposure_pct', 'maxMarketExposurePct', 'max_market_pct', 'maxMarketPct',
        'max_event_exposure_pct', 'maxEventExposurePct',
      ], DEFAULT_PAPER_RISK_LIMITS.maxMarketExposurePct),
      DEFAULT_PAPER_RISK_LIMITS.maxMarketExposurePct,
    ),
    minCashReservePct: Math.max(
      readRatio(config, ['min_cash_reserve_pct', 'minCashReservePct'], DEFAULT_PAPER_RISK_LIMITS.minCashReservePct),
      DEFAULT_PAPER_RISK_LIMITS.minCashReservePct,
    ),
    maxDailyLossPct: Math.min(
      readRatio(config, ['max_daily_loss_pct', 'maxDailyLossPct'], DEFAULT_PAPER_RISK_LIMITS.maxDailyLossPct),
      DEFAULT_PAPER_RISK_LIMITS.maxDailyLossPct,
    ),
    maxDrawdownPct: Math.min(
      readRatio(config, ['max_drawdown_pct', 'maxDrawdownPct'], DEFAULT_PAPER_RISK_LIMITS.maxDrawdownPct),
      DEFAULT_PAPER_RISK_LIMITS.maxDrawdownPct,
    ),
    maxDailyBuyTrades: Math.min(
      Number.isInteger(Number(config.max_daily_trades ?? config.maxDailyTrades)) && Number(config.max_daily_trades ?? config.maxDailyTrades) > 0
        ? Number(config.max_daily_trades ?? config.maxDailyTrades)
        : DEFAULT_PAPER_RISK_LIMITS.maxDailyBuyTrades,
      DEFAULT_PAPER_RISK_LIMITS.maxDailyBuyTrades,
    ),
  };
}

export function validatePaperBuyRisk(args: {
  portfolio: Portfolio;
  marketId: string;
  riskGroupId?: string;
  notional: number;
  riskConfig?: unknown;
  dailyStartNav?: number;
  peakNav?: number;
  dailyBuyTrades?: number;
  maxDailyBuyTrades?: number;
  runBuyTrades?: number;
  maxRunBuyTrades?: number;
}): string | null {
  const { portfolio, marketId, notional } = args;
  const limits = resolvePaperRiskLimits(args.riskConfig);
  const nav = portfolio.totalValue;
  if (!Number.isFinite(nav) || nav <= 0) return 'Cannot buy when portfolio NAV is zero or invalid';
  if (portfolio.positions.some((position) => position.pricingStatus === 'unpriced')) {
    return 'Cannot add risk while one or more positions are unpriced';
  }

  const riskGroupId = args.riskGroupId ?? marketId;
  const averagingDown = portfolio.positions.some((position) => (
    position.marketId === marketId
    && position.currentPrice < position.avgEntryPrice
  ));
  if (averagingDown) return 'Averaging down is blocked while an existing position is below its entry price';
  const existingMarketExposure = portfolio.positions
    .filter((position) => (position.riskGroupId ?? position.marketId) === riskGroupId)
    // Exposure is capital at risk, not the latest mark. A falling price must
    // never create room to average down through the server-side cap.
    .reduce((sum, position) => sum + position.shares * position.avgEntryPrice, 0);
  if (existingMarketExposure + notional > nav * limits.maxMarketExposurePct + 1e-9) {
    const scope = riskGroupId === marketId ? 'market' : 'event';
    return `Cumulative ${scope} exposure exceeds ${(limits.maxMarketExposurePct * 100).toFixed(1)}% of portfolio NAV`;
  }

  if (notional > nav * limits.maxTradePct + 1e-9) {
    return `Trade notional exceeds ${(limits.maxTradePct * 100).toFixed(1)}% of portfolio NAV`;
  }

  if (portfolio.balance - notional < nav * limits.minCashReservePct - 1e-9) {
    return `Trade would breach the ${(limits.minCashReservePct * 100).toFixed(1)}% cash reserve`;
  }

  if ((args.dailyStartNav ?? nav) > 0 && ((args.dailyStartNav ?? nav) - nav) / (args.dailyStartNav ?? nav) >= limits.maxDailyLossPct - 1e-12) {
    return `Daily loss stop of ${(limits.maxDailyLossPct * 100).toFixed(1)}% has been reached`;
  }
  if ((args.peakNav ?? nav) > 0 && ((args.peakNav ?? nav) - nav) / (args.peakNav ?? nav) >= limits.maxDrawdownPct - 1e-12) {
    return `Drawdown stop of ${(limits.maxDrawdownPct * 100).toFixed(1)}% has been reached`;
  }
  const dailyLimit = Math.min(limits.maxDailyBuyTrades, args.maxDailyBuyTrades ?? limits.maxDailyBuyTrades);
  if ((args.dailyBuyTrades ?? 0) >= dailyLimit) {
    return `Daily BUY limit of ${dailyLimit} has been reached`;
  }
  if (args.maxRunBuyTrades !== undefined && (args.runBuyTrades ?? 0) >= args.maxRunBuyTrades) {
    return `Strategy per-run BUY limit of ${args.maxRunBuyTrades} has been reached`;
  }

  return null;
}
