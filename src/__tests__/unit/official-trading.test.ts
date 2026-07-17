import { describe, expect, it, vi } from 'vitest';
import {
  buildKalshiOrderRequest,
  normalizeKalshiOrderStatus,
  resolveOfficialOrderQuantity,
  summarizeKalshiPositions,
  validateOfficialPortfolioSnapshot,
  collectKalshiCursorPages,
  resolveKalshiExecutionBaseUrl,
} from '@/lib/official-trading';

describe('official trading helpers', () => {
  it('keeps demo official execution independent from live market data', () => {
    expect(resolveKalshiExecutionBaseUrl({
      KALSHI_USE_DEMO: 'true',
      KALSHI_MARKET_DATA_ENV: 'live',
    })).toBe('https://demo-api.kalshi.co/trade-api/v2');
    expect(resolveKalshiExecutionBaseUrl({
      KALSHI_USE_DEMO: 'false',
      KALSHI_MARKET_DATA_ENV: 'demo',
    })).toBe('https://external-api.kalshi.com/trade-api/v2');
  });
  it('collects all cursor pages without duplicating the first page', async () => {
    const fetchPage = vi.fn()
      .mockResolvedValueOnce({ rows: [{ id: 1 }], cursor: 'next' })
      .mockResolvedValueOnce({ rows: [{ id: 2 }], cursor: '' });
    await expect(collectKalshiCursorPages(fetchPage)).resolves.toEqual([{ id: 1 }, { id: 2 }]);
    expect(fetchPage).toHaveBeenNthCalledWith(1, undefined);
    expect(fetchPage).toHaveBeenNthCalledWith(2, 'next');
  });
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

  it('derives audit quantity when an amount is used', () => {
    expect(resolveOfficialOrderQuantity({ amount: 100, price: 0.8 })).toBe(125);
  });

  it('uses fill and remaining counts to produce truthful audit statuses', () => {
    expect(normalizeKalshiOrderStatus({ status: 'executed', fill_count: '0.00', remaining_count: '50.00' })).toBe('OPEN');
    expect(normalizeKalshiOrderStatus({ status: 'executed', fill_count: '12.00', remaining_count: '38.00' })).toBe('PARTIALLY_FILLED');
    expect(normalizeKalshiOrderStatus({ status: 'executed', fill_count: '0.00', remaining_count: '0.00' })).toBe('CANCELED');
    expect(normalizeKalshiOrderStatus({ status: 'executed', fill_count: '50.00', remaining_count: '0.00' })).toBe('EXECUTED');
    expect(normalizeKalshiOrderStatus({ status: 'resting', fill_count_fp: '71.00', remaining_count_fp: '419.19' })).toBe('PARTIALLY_FILLED');
    expect(normalizeKalshiOrderStatus({ status: 'resting', fill_count_fp: '0.00', remaining_count_fp: '490.19' })).toBe('RESTING');
    expect(normalizeKalshiOrderStatus({ status: 'canceled', initial_count_fp: '126.92', fill_count_fp: '23.00', remaining_count_fp: '0.00' })).toBe('PARTIALLY_FILLED_CANCELED');
  });

  it('reads current Kalshi fixed-point dollar position fields', () => {
    expect(summarizeKalshiPositions([
      { market_exposure_dollars: '58.195200', realized_pnl_dollars: '-8.680000' },
      { market_exposure_dollars: '63.144700', realized_pnl_dollars: '-3.000000' },
    ])).toEqual({ positionsValue: 121.3399, pnl: -11.68 });
  });

  it('rejects an official snapshot when a critical Kalshi request failed', () => {
    expect(() => validateOfficialPortfolioSnapshot('kalshi', {
      balance: { balance: 10000 },
      positions: { error: 'authentication failed' },
      orders: { orders: [] },
      fills: { fills: [] },
      settlements: { settlements: [] },
    })).toThrow('Kalshi official portfolio sync failed: positions: authentication failed');

    expect(() => validateOfficialPortfolioSnapshot('kalshi', {
      balance: {}, positions: {}, orders: {}, fills: {}, settlements: { error: 'rate limited' },
    })).toThrow('Kalshi official portfolio sync failed: settlements: rate limited');
  });
});
