import { describe, expect, it } from 'vitest';
import { resolveStrategyExecutionPolicy } from '@/lib/strategy-execution-policy';

describe('strategy execution policy', () => {
  it('enforces stable strategy-specific edge and turnover caps', () => {
    expect(resolveStrategyExecutionPolicy('kalshi', 'paper', 'commander')).toMatchObject({
      minimumNetEdge: 0.08,
      maxBuyTradesPerRun: 2,
    });
    expect(resolveStrategyExecutionPolicy('kalshi', 'paper', 'high_freq_retro')).toEqual({
      minimumNetEdge: 0.08,
      maxDailyBuyTrades: 6,
      maxBuyTradesPerRun: 2,
    });
    expect(resolveStrategyExecutionPolicy('polymarket_us', 'paper', 'high_freq_retro')).toEqual({
      minimumNetEdge: 0.06,
      maxDailyBuyTrades: 8,
      maxBuyTradesPerRun: 2,
    });
    expect(resolveStrategyExecutionPolicy('kalshi', 'real', 'commander_real')).toEqual({
      minimumNetEdge: 0.12,
      maxDailyBuyTrades: 3,
      maxBuyTradesPerRun: 1,
    });
  });

  it('keeps conservative basket strategies on the baseline proposal floor', () => {
    expect(resolveStrategyExecutionPolicy('kalshi', 'paper', 'conservative_retro')).toEqual({
      minimumNetEdge: 0.02,
    });
  });
});
