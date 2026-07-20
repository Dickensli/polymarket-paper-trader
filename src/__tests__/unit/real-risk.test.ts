import { describe, expect, it } from 'vitest';
import {
  calculateOfficialRiskGroupExposure,
  isOfficialBuyRiskReducing,
  resolveRealRiskLimits,
  validateRealBuyRisk,
} from '@/lib/real-risk';

const safeFacts = {
  nav: 10_000,
  cash: 8_000,
  notional: 100,
  existingRiskGroupExposure: 0,
  dailyStartNav: 10_000,
  peakNav: 10_000,
  dailyBuyTrades: 0,
  riskConfig: {
    max_single_trade_pct: 0.02,
    max_market_exposure_pct: 0.05,
    min_cash_reserve_pct: 0.30,
  },
};

describe('real trading server-side risk guard', () => {
  it('enforces trade size, event exposure, cash, daily loss, drawdown, and trade count', () => {
    expect(validateRealBuyRisk({ ...safeFacts, notional: 201 })).toContain('Trade notional');
    expect(validateRealBuyRisk({ ...safeFacts, existingRiskGroupExposure: 450 })).toContain('event exposure');
    expect(validateRealBuyRisk({ ...safeFacts, cash: 3_050, notional: 100 })).toContain('cash reserve');
    expect(validateRealBuyRisk({ ...safeFacts, nav: 9_800 })).toContain('Daily loss stop');
    expect(validateRealBuyRisk({ ...safeFacts, nav: 9_490, dailyStartNav: 9_490 })).toContain('Drawdown stop');
    expect(validateRealBuyRisk({ ...safeFacts, dailyBuyTrades: 3 })).toContain('Daily BUY limit');
    expect(validateRealBuyRisk(safeFacts)).toBeNull();
  });

  it('uses configured aliases and capital-at-risk fields for existing exposure', () => {
    expect(resolveRealRiskLimits({ max_daily_trades: 1 }).maxDailyBuyTrades).toBe(1);
    expect(calculateOfficialRiskGroupExposure([
      { ticker: 'MKT-1', risk_group_id: 'EVENT', position_cost_dollars: 300 },
      { ticker: 'MKT-2', risk_group_id: 'EVENT', market_value_dollars: 50 },
      { ticker: 'OTHER', risk_group_id: 'OTHER', position_cost_dollars: 999 },
    ], 'EVENT', 'MKT-NEW')).toBe(350);
  });

  it('allows stricter agent limits but never lets an agent loosen server ceilings', () => {
    expect(resolveRealRiskLimits({
      max_single_trade_pct: 1,
      max_market_exposure_pct: 1,
      min_cash_reserve_pct: 0,
      max_daily_loss_pct: 1,
      max_drawdown_pct: 1,
      max_daily_trades: 999,
    })).toEqual({
      maxTradePct: 0.02,
      maxRiskGroupExposurePct: 0.05,
      minCashReservePct: 0.30,
      maxDailyLossPct: 0.02,
      maxDrawdownPct: 0.05,
      maxDailyBuyTrades: 3,
    });
    expect(resolveRealRiskLimits({ max_single_trade_pct: 0.01 }).maxTradePct).toBe(0.01);
  });

  it('normalizes legacy whole-number percentage configuration', () => {
    expect(resolveRealRiskLimits({
      max_single_trade_pct: 2,
      max_event_exposure_pct: 5,
      min_cash_reserve_pct: 30,
      max_daily_loss_pct: 2,
      max_drawdown_pct: 5,
    })).toEqual({
      maxTradePct: 0.02,
      maxRiskGroupExposurePct: 0.05,
      minCashReservePct: 0.30,
      maxDailyLossPct: 0.02,
      maxDrawdownPct: 0.05,
      maxDailyBuyTrades: 3,
    });
  });

  it('recognizes a bounded Kalshi BUY that covers an existing short as risk reducing', () => {
    const positions = [{ ticker: 'CPI', position_fp: '-102.00' }];
    expect(isOfficialBuyRiskReducing(positions, 'CPI', 'YES', 102)).toBe(true);
    expect(isOfficialBuyRiskReducing(positions, 'CPI', 'YES', 103)).toBe(false);
    expect(isOfficialBuyRiskReducing(positions, 'CPI', 'NO', 10)).toBe(false);
  });
});
