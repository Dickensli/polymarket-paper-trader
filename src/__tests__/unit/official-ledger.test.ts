import { describe, expect, it } from 'vitest';

import {
  normalizeKalshiFill,
  normalizeKalshiOrderEvent,
  normalizeKalshiSettlement,
  buildFillCashLedgerEntries,
  buildSettlementCashLedgerEntries,
  normalizePolymarketUsFill,
  normalizePolymarketUsOrderEvent,
  normalizePolymarketUsSettlement,
} from '@/lib/official-ledger';

describe('official trading ledger normalization', () => {
  it('normalizes a fill into immutable dollar-denominated execution data', () => {
    expect(normalizeKalshiFill({
      fill_id: 'fill-1', trade_id: 'trade-1', order_id: 'order-1', ticker: 'KXBTC-1',
      outcome_side: 'no', action: 'buy', count_fp: '2.50', no_price_dollars: '0.4200',
      fee_cost: '0.0300', is_taker: true, created_time: '2026-07-13T01:00:00Z',
    })).toMatchObject({
      officialFillId: 'fill-1', officialOrderId: 'order-1', marketId: 'KXBTC-1',
      outcome: 'NO', side: 'BUY', quantity: 2.5, price: 0.42, fee: 0.03,
    });
  });

  it('normalizes Polymarket US orders, fills, and settlement activity', () => {
    expect(normalizePolymarketUsOrderEvent({ id: 'o1', state: 'partially_filled', quantity: 10, filledQuantity: 4, updatedAt: '2026-01-01T00:00:00Z' })).toMatchObject({ officialOrderId: 'o1', status: 'PARTIALLY_FILLED', remainingQuantity: 6 });
    expect(normalizePolymarketUsFill({ id: 'f1', orderId: 'o1', marketSlug: 'btc-up', outcomeSide: 'YES', action: 'BUY', quantity: 4, price: { value: '0.55' }, fee: { value: '0.02' }, createdAt: '2026-01-01T00:01:00Z' })).toMatchObject({ officialFillId: 'f1', quantity: 4, price: 0.55, fee: 0.02 });
    expect(normalizePolymarketUsSettlement({ id: 's1', type: 'SETTLEMENT', marketSlug: 'btc-up', outcome: 'YES', quantity: 4, revenue: { value: '4' }, fee: { value: '0' }, createdAt: '2026-01-02T00:00:00Z' })).toMatchObject({ settlementKey: 'polymarket_us:s1', marketId: 'btc-up', revenue: 4 });
    expect(normalizePolymarketUsSettlement({ id: 'x', type: 'DEPOSIT' })).toBeNull();
  });

  it('normalizes the nested activity shape returned by the Polymarket US SDK', () => {
    expect(normalizePolymarketUsSettlement({
      type: 'ACTIVITY_TYPE_POSITION_RESOLUTION',
      positionResolution: {
        tradeId: 'resolution-1', marketSlug: 'usa-market', updateTime: '2026-07-12T00:00:00Z',
        beforePosition: { netPosition: '8', realized: { value: '1.25' }, marketMetadata: { outcome: 'YES' } },
        afterPosition: { netPosition: '0', realized: { value: '5.25' } },
      },
    })).toMatchObject({
      settlementKey: 'polymarket_us:resolution-1', marketId: 'usa-market', marketResult: 'YES',
      yesQuantity: 8, noQuantity: 0, revenue: 4,
    });
  });

  it('creates balanced double-entry postings for fills and settlements', () => {
    const fillEntries = buildFillCashLedgerEntries({ platform: 'kalshi', officialFillId: 'f1', side: 'BUY', quantity: 2, price: 0.4, fee: 0.02, filledAt: new Date('2026-01-01'), payload: {} });
    const settlementEntries = buildSettlementCashLedgerEntries({ platform: 'kalshi', settlementKey: 's1', revenue: 2, fee: 0.01, settledAt: new Date('2026-01-02'), payload: {} });
    expect(fillEntries.reduce((sum, row) => sum + row.amount, 0)).toBeCloseTo(0);
    expect(settlementEntries.reduce((sum, row) => sum + row.amount, 0)).toBeCloseTo(0);
    expect(fillEntries).toEqual(expect.arrayContaining([expect.objectContaining({ accountType: 'CASH', amount: -0.82 }), expect.objectContaining({ accountType: 'FEES', amount: 0.02 })]));
  });

  it('does not invent outcome or action for historical fills that omit them', () => {
    expect(normalizeKalshiFill({ fill_id: 'old', ticker: 'KXOLD', count_fp: '1', yes_price_dollars: '0.5', created_time: '2026-01-01T00:00:00Z' }))
      .toMatchObject({ outcome: null, side: null, price: 0.5 });
  });

  it('creates a stable order event key from lifecycle quantities and venue time', () => {
    expect(normalizeKalshiOrderEvent({
      order_id: 'order-1', status: 'resting', initial_count_fp: '10', fill_count_fp: '4',
      remaining_count_fp: '6', last_update_time: '2026-07-13T01:01:00Z',
    })).toMatchObject({
      officialOrderId: 'order-1', status: 'PARTIALLY_FILLED', requestedQuantity: 10,
      filledQuantity: 4, remainingQuantity: 6,
      eventKey: 'kalshi:order-1:PARTIALLY_FILLED:4:6:2026-07-13T01:01:00Z',
    });
  });

  it('normalizes account settlements without inventing strategy attribution', () => {
    expect(normalizeKalshiSettlement({
      ticker: 'KXBTC-1', event_ticker: 'KXBTC', market_result: 'yes',
      yes_count_fp: '3', yes_total_cost_dollars: '1.20', no_count_fp: '0',
      no_total_cost_dollars: '0', revenue: 300, fee_cost: '0',
      settled_time: '2026-07-13T02:00:00Z',
    })).toMatchObject({
      settlementKey: 'kalshi:KXBTC-1:2026-07-13T02:00:00Z', marketId: 'KXBTC-1',
      marketResult: 'YES', yesQuantity: 3, yesCost: 1.2, revenue: 3,
    });
  });
});
