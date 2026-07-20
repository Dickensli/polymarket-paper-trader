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

  it('does not create averaging-down capacity when the current mark falls', () => {
    const markedDown: Portfolio = {
      ...portfolio,
      positions: [{
        ...portfolio.positions[0],
        shares: 200,
        avgEntryPrice: 0.5,
        currentPrice: 0.1,
      }],
    };
    expect(validatePaperBuyRisk({
      portfolio: markedDown,
      marketId: 'same-market',
      notional: 101,
      riskConfig: { max_trade_pct: 1, max_market_exposure_pct: 0.2 },
    })).toContain('Averaging down');
  });

  it('allows stricter agent limits but never lets an agent loosen server ceilings', () => {
    expect(resolvePaperRiskLimits({
      max_trade_pct: 1,
      max_market_exposure_pct: 1,
      min_cash_reserve_pct: 0,
    })).toEqual({
      maxTradePct: 0.10,
      maxMarketExposurePct: 0.20,
      minCashReservePct: 0.05,
      maxDailyLossPct: 0.02,
      maxDrawdownPct: 0.05,
      maxDailyBuyTrades: 8,
    });
    expect(resolvePaperRiskLimits({ max_trade_pct: 0.03 }).maxTradePct).toBe(0.03);
  });

  it('normalizes legacy whole-number percentages and event aliases', () => {
    expect(resolvePaperRiskLimits({
      max_single_trade_pct: 3,
      max_event_exposure_pct: 10,
      min_cash_reserve_pct: 15,
      max_daily_loss_pct: 2,
      max_drawdown_pct: 5,
      max_daily_trades: 6,
    })).toEqual({
      maxTradePct: 0.03,
      maxMarketExposurePct: 0.10,
      minCashReservePct: 0.15,
      maxDailyLossPct: 0.02,
      maxDrawdownPct: 0.05,
      maxDailyBuyTrades: 6,
    });
  });

  it('blocks new risk while positions are unpriced and enforces per-run policy caps', () => {
    expect(validatePaperBuyRisk({
      portfolio: {
        ...portfolio,
        positions: [{ ...portfolio.positions[0], pricingStatus: 'unpriced', currentPrice: 0 }],
      },
      marketId: 'new-market',
      notional: 10,
    })).toContain('unpriced');
    expect(validatePaperBuyRisk({
      portfolio,
      marketId: 'new-market',
      notional: 10,
      runBuyTrades: 2,
      maxRunBuyTrades: 2,
    })).toContain('per-run BUY limit');
  });

  it('enforces averaging-down, daily loss, drawdown, and daily trade guards', () => {
    expect(validatePaperBuyRisk({
      portfolio: { ...portfolio, positions: [{ ...portfolio.positions[0], currentPrice: 0.4 }] },
      marketId: 'same-market', notional: 10,
    })).toContain('Averaging down');
    expect(validatePaperBuyRisk({
      portfolio, marketId: 'new-market', notional: 10,
      dailyStartNav: 1_100, peakNav: 1_000, dailyBuyTrades: 0,
    })).toContain('Daily loss stop');
    expect(validatePaperBuyRisk({
      portfolio, marketId: 'new-market', notional: 10,
      dailyStartNav: 1_000, peakNav: 1_100, dailyBuyTrades: 0,
    })).toContain('Drawdown stop');
    expect(validatePaperBuyRisk({
      portfolio, marketId: 'new-market', notional: 10,
      dailyStartNav: 1_000, peakNav: 1_000, dailyBuyTrades: 8,
    })).toContain('Daily BUY limit');
  });
});
