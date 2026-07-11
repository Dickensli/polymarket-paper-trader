import { describe, expect, it } from 'vitest';
import { buildSettledStrategyPositions } from '@/lib/agent-settled-positions';

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
});
