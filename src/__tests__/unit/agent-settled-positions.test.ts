import { describe, expect, it } from 'vitest';
import { buildClosedStrategyPositions, buildSettledStrategyPositions } from '@/lib/agent-settled-positions';

describe('agent settled positions', () => {
  const strategies = [
    { id: 'strategy-a', userId: 'agent-1', name: 'Alpha', platform: 'kalshi' },
    { id: 'strategy-b', userId: 'agent-1', name: 'Beta', platform: 'kalshi' },
  ];

  it('allocates one settled position across strategies using net filled quantities', () => {
    const result = buildSettledStrategyPositions([
      {
        id: 'position-1',
        userId: 'agent-1',
        marketId: 'KXTEST',
        marketQuestion: 'Will the test resolve yes?',
        outcome: 'YES',
        shares: '10',
        avgEntryPrice: '0.40',
        currentPrice: '1',
        realizedPnl: '6',
        resolvedAt: '2026-07-11T12:00:00.000Z',
      },
    ], [
      { strategyId: 'strategy-a', userId: 'agent-1', marketId: 'KXTEST', outcome: 'YES', side: 'BUY', quantity: '7', platform: 'kalshi' },
      { strategyId: 'strategy-a', userId: 'agent-1', marketId: 'KXTEST', outcome: 'YES', side: 'SELL', quantity: '2', platform: 'kalshi' },
      { strategyId: 'strategy-b', userId: 'agent-1', marketId: 'KXTEST', outcome: 'YES', side: 'BUY', quantity: '5', platform: 'kalshi' },
    ], strategies);

    expect(result).toHaveLength(2);
    expect(result).toEqual(expect.arrayContaining([
      expect.objectContaining({ strategy_id: 'strategy-a', shares: 5, cost_basis: 2, proceeds: 5, realized_pnl: 3 }),
      expect.objectContaining({ strategy_id: 'strategy-b', shares: 5, cost_basis: 2, proceeds: 5, realized_pnl: 3 }),
    ]));
  });

  it('ignores unresolved positions and orders belonging to unknown strategies', () => {
    const result = buildSettledStrategyPositions([
      {
        id: 'position-open', userId: 'agent-1', marketId: 'OPEN', marketQuestion: null,
        outcome: 'NO', shares: 2, avgEntryPrice: 0.5, currentPrice: 0.5,
        realizedPnl: 0, resolvedAt: null,
      },
    ], [
      { strategyId: 'unknown', userId: 'agent-1', marketId: 'OPEN', outcome: 'NO', side: 'BUY', quantity: 2, platform: 'kalshi' },
    ], strategies);

    expect(result).toEqual([]);
  });

  it('builds a closed lifecycle record when a strategy fully exits a paper position', () => {
    const result = buildClosedStrategyPositions([
      { id: 'buy-1', strategyId: 'strategy-a', userId: 'agent-1', marketId: 'usa-market', marketQuestion: 'US market?', outcome: 'YES', side: 'BUY', quantity: 90, price: 0.05, platform: 'polymarket_us', createdAt: '2026-07-11T10:00:00Z' },
      { id: 'buy-2', strategyId: 'strategy-a', userId: 'agent-1', marketId: 'usa-market', marketQuestion: 'US market?', outcome: 'YES', side: 'BUY', quantity: 10, price: 0.06, platform: 'polymarket_us', createdAt: '2026-07-11T10:01:00Z' },
      { id: 'sell-1', strategyId: 'strategy-a', userId: 'agent-1', marketId: 'usa-market', marketQuestion: 'US market?', outcome: 'YES', side: 'SELL', quantity: 100, price: 0.07, platform: 'polymarket_us', createdAt: '2026-07-11T11:00:00Z' },
    ], strategies.map((row) => row.id === 'strategy-a' ? { ...row, platform: 'polymarket_us' } : row));

    expect(result).toEqual([expect.objectContaining({
      closure_type: 'CLOSED', strategy_id: 'strategy-a', shares: 100,
      avg_price: 0.051, settlement_price: 0.07, cost_basis: 5.1, proceeds: 7, realized_pnl: 1.9,
    })]);
  });

  it('builds closed records for partial sells immediately', () => {
    const result = buildClosedStrategyPositions([
      { id: 'buy-1', strategyId: 'strategy-a', userId: 'agent-1', marketId: 'test-market', marketQuestion: 'Test?', outcome: 'YES', side: 'BUY', quantity: 100, price: 0.10, platform: 'kalshi', createdAt: '2026-07-11T10:00:00Z' },
      { id: 'sell-1', strategyId: 'strategy-a', userId: 'agent-1', marketId: 'test-market', marketQuestion: 'Test?', outcome: 'YES', side: 'SELL', quantity: 40, price: 0.50, platform: 'kalshi', createdAt: '2026-07-11T11:00:00Z' },
    ], strategies);

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual(expect.objectContaining({
      closure_type: 'CLOSED',
      strategy_id: 'strategy-a',
      shares: 40,
      avg_price: 0.10,
      settlement_price: 0.50,
      cost_basis: 4,
      proceeds: 20,
      realized_pnl: 16,
    }));
  });
});
