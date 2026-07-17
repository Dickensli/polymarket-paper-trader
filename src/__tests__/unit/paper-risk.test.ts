import { describe, expect, it } from 'vitest';
import { resolvePaperRiskLimits, validatePaperBuyRisk } from '@/lib/paper-risk';
import type { Portfolio } from '@/lib/types';

const portfolio: Portfolio = {
  balance: 700,
  totalValue: 1_000,
  totalPnL: 0,
  totalPnLPercent: 0,
  tradeHistory: [],
  positions: [{
    id: 'p1', marketId: 'same-market', marketQuestion: 'Q', tokenId: 't', outcome: 'YES',
    shares: 200, avgEntryPrice: 0.5, currentPrice: 0.5, unrealizedPnL: 0,
    unrealizedPnLPercent: 0, realizedPnL: 0, createdAt: new Date().toISOString(),
  }],
};

describe('paper trading server-side risk guard', () => {
  it('accepts snake_case prompt configuration and rejects an oversized single trade', () => {
    expect(resolvePaperRiskLimits({ max_single_trade_pct: 0.05 }).maxTradePct).toBe(0.05);
    expect(validatePaperBuyRisk({ portfolio, marketId: 'new-market', notional: 51, riskConfig: { max_single_trade_pct: 0.05 } }))
      .toContain('Trade notional');
  });

  it('limits cumulative exposure across YES and NO positions in the same market', () => {
    expect(validatePaperBuyRisk({
      portfolio, marketId: 'same-market', notional: 101,
      riskConfig: { max_trade_pct: 0.2, max_market_exposure_pct: 0.2 },
    })).toContain('Cumulative market exposure');
  });

  it('enforces a cash reserve and permits sells by keeping this guard buy-only', () => {
    expect(validatePaperBuyRisk({
      portfolio: { ...portfolio, balance: 100 }, marketId: 'new-market', notional: 60,
      riskConfig: { max_trade_pct: 1, max_market_exposure_pct: 1, min_cash_reserve_pct: 0.05 },
    })).toContain('cash reserve');
  });

  it('aggregates exposure across different markets in the same event risk group', () => {
    const eventPortfolio: Portfolio = {
      ...portfolio,
      positions: [{ ...portfolio.positions[0], marketId: 'house-dem', riskGroupId: 'house-control' }],
    };
    expect(validatePaperBuyRisk({
      portfolio: eventPortfolio,
      marketId: 'house-rep',
      riskGroupId: 'house-control',
      notional: 101,
      riskConfig: { max_trade_pct: 0.2, max_market_exposure_pct: 0.2 },
    })).toContain('Cumulative event exposure');
  });
});
