import { describe, expect, it } from 'vitest';
import { buildOfficialSettledStrategyPositions } from '@/lib/agent-official-settled';

describe('official settled strategy positions', () => {
  it('allocates only attributed remaining lots to an official settlement', () => {
    const rows = buildOfficialSettledStrategyPositions(
      [{ id: 's1', platform: 'kalshi', marketId: 'KX1', marketResult: 'YES', yesQuantity: '5', noQuantity: '0', yesCost: '2', noCost: '0', revenue: '4.99', fee: '0.01', settledAt: '2026-07-13T02:00:00Z' }],
      [{ strategyId: 'st1', marketId: 'KX1', outcome: 'YES', side: 'BUY', quantity: '5', price: '0.4', fee: '0', filledAt: '2026-07-13T01:00:00Z' }],
      [{ id: 'st1', userId: 'u1', name: 'high_freq_real', platform: 'kalshi' }],
    );
    expect(rows).toMatchObject([{ shares: 5, avg_price: 0.4, settlement_price: 0.998, cost_basis: 2, proceeds: 4.99, settlement_fee: 0.01, realized_pnl: 2.98 }]);
  });
});
