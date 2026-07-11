import { describe, expect, it } from 'vitest';
import { buildKalshiOrderRequest } from '@/lib/official-trading';

describe('official trading helpers', () => {
  it('builds Kalshi V2 orders with fixed-point count and dollar price strings', () => {
    const { request } = buildKalshiOrderRequest({
      platform: 'kalshi',
      slug: 'KXTEST',
      outcome: 'YES',
      side: 'SELL',
      shares: 0.25,
      price: 0.7,
      timeInForce: 'GTC',
      clientOrderId: 'client-1',
    });

    expect(request).toMatchObject({
      ticker: 'KXTEST',
      client_order_id: 'client-1',
      side: 'ask',
      count: '0.25',
      price: '0.7000',
      time_in_force: 'good_till_canceled',
      reduce_only: false,
    });
  });

  it('uses YES-book pricing and side for NO orders', () => {
    const { request } = buildKalshiOrderRequest({
      platform: 'kalshi',
      slug: 'KXTEST',
      outcome: 'NO',
      side: 'BUY',
      shares: 1,
      price: 0.35,
      timeInForce: 'IOC',
      clientOrderId: 'client-2',
    });

    expect(request).toMatchObject({
      side: 'ask',
      count: '1.00',
      price: '0.6500',
      time_in_force: 'immediate_or_cancel',
    });
  });

  it('rejects Kalshi quantities below the fixed-point minimum before calling the API', () => {
    expect(() => buildKalshiOrderRequest({
      platform: 'kalshi',
      slug: 'KXTEST',
      outcome: 'YES',
      side: 'BUY',
      shares: 0.009,
      price: 0.5,
      clientOrderId: 'client-3',
    })).toThrow('Kalshi real order quantity must be at least 0.01 contracts.');
  });
});
