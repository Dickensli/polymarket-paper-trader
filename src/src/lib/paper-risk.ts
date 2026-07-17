import type { Portfolio } from '@/lib/types';

export interface PaperRiskLimits {
  maxTradePct: number;
  maxMarketExposurePct: number;
  minCashReservePct: number;
}

export const DEFAULT_PAPER_RISK_LIMITS: PaperRiskLimits = {
  maxTradePct: 0.10,
  maxMarketExposurePct: 0.20,
  minCashReservePct: 0.05,
};

function readRatio(config: Record<string, unknown>, keys: string[], fallback: number): number {
  for (const key of keys) {
    const value = Number(config[key]);
    if (Number.isFinite(value) && value >= 0 && value <= 1) return value;
  }
  return fallback;
}

export function resolvePaperRiskLimits(value: unknown): PaperRiskLimits {
  const config = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  return {
    maxTradePct: readRatio(config, ['max_trade_pct', 'maxTradePct', 'max_single_trade_pct', 'maxSingleTradePct'], DEFAULT_PAPER_RISK_LIMITS.maxTradePct),
    maxMarketExposurePct: readRatio(config, ['max_market_exposure_pct', 'maxMarketExposurePct', 'max_market_pct', 'maxMarketPct'], DEFAULT_PAPER_RISK_LIMITS.maxMarketExposurePct),
    minCashReservePct: readRatio(config, ['min_cash_reserve_pct', 'minCashReservePct'], DEFAULT_PAPER_RISK_LIMITS.minCashReservePct),
  };
}

export function validatePaperBuyRisk(args: {
  portfolio: Portfolio;
  marketId: string;
  notional: number;
  riskConfig?: unknown;
}): string | null {
  const { portfolio, marketId, notional } = args;
  const limits = resolvePaperRiskLimits(args.riskConfig);
  const nav = portfolio.totalValue;
  if (!Number.isFinite(nav) || nav <= 0) return 'Cannot buy when portfolio NAV is zero or invalid';

  if (notional > nav * limits.maxTradePct + 1e-9) {
    return `Trade notional exceeds ${(limits.maxTradePct * 100).toFixed(1)}% of portfolio NAV`;
  }

  const existingMarketExposure = portfolio.positions
    .filter((position) => position.marketId === marketId)
    .reduce((sum, position) => sum + position.shares * position.currentPrice, 0);
  if (existingMarketExposure + notional > nav * limits.maxMarketExposurePct + 1e-9) {
    return `Cumulative market exposure exceeds ${(limits.maxMarketExposurePct * 100).toFixed(1)}% of portfolio NAV`;
  }

  if (portfolio.balance - notional < nav * limits.minCashReservePct - 1e-9) {
    return `Trade would breach the ${(limits.minCashReservePct * 100).toFixed(1)}% cash reserve`;
  }

  return null;
}
