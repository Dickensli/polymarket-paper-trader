import { describe, expect, it } from 'vitest';
import { buildOfficialOrderHistory } from '@/lib/agent-order-history';

describe('official order history', () => {
  it('aggregates immutable fills and the latest lifecycle event', () => {
    const history = buildOfficialOrderHistory(
      [{ officialOrderId: 'o1', quantity: '2', price: '0.40', fee: '0.02', filledAt: '2026-07-13T01:00:00Z' },
       { officialOrderId: 'o1', quantity: '3', price: '0.50', fee: '0.03', filledAt: '2026-07-13T01:01:00Z' }],
      [{ officialOrderId: 'o1', requestedQuantity: '10', filledQuantity: '5', remainingQuantity: '5', status: 'PARTIALLY_FILLED', occurredAt: '2026-07-13T01:02:00Z' }],
    );
    expect(history.get('o1')).toMatchObject({
      requested_quantity: 10, filled_quantity: 5, remaining_quantity: 5,
      average_fill_price: 0.46, fees: 0.05, status: 'PARTIALLY_FILLED',
      first_fill_at: '2026-07-13T01:00:00.000Z', last_fill_at: '2026-07-13T01:01:00.000Z',
      fills: [
        { quantity: 2, price: 0.4, fee: 0.02, filled_at: '2026-07-13T01:00:00.000Z' },
        { quantity: 3, price: 0.5, fee: 0.03, filled_at: '2026-07-13T01:01:00.000Z' },
      ],
      events: [{ status: 'PARTIALLY_FILLED', filled_quantity: 5, remaining_quantity: 5 }],
    });
  });
});
