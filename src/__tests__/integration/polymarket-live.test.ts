// =============================================================================
// Integration Tests: Polymarket API — Live Endpoint Validation
// =============================================================================
//
// These tests hit the REAL Polymarket APIs (Gamma + CLOB) to validate
// our client against actual response shapes. They serve as a canary
// to detect API schema changes or endpoint deprecations before they
// break production.
//
// Note: These tests are network-dependent and may be slow. They should
//       be run as part of a CI smoke suite, not on every commit.
// =============================================================================

import { describe, it, expect } from 'vitest';
import {
  getMarkets,
  getMarket,
  getEvents,
  getMidpoint,
  getSpread,
  getLastTradePrice,
  getOrderBook,
  getPriceHistory,
  PolymarketApiError,
} from '@/lib/polymarket';

// ---------------------------------------------------------------------------
// Gamma API — Markets
// ---------------------------------------------------------------------------

describe('Live Gamma API — getMarkets', () => {
  it('fetches and normalizes active markets', async () => {
    const markets = await getMarkets({ limit: 3 });
    expect(markets.length).toBeGreaterThan(0);
    expect(markets.length).toBeLessThanOrEqual(3);

    const m = markets[0];
    expect(m.id).toBeDefined();
    expect(typeof m.question).toBe('string');
    expect(m.question.length).toBeGreaterThan(0);
    expect(Array.isArray(m.tokenIds)).toBe(true);
    expect(Array.isArray(m.outcomes)).toBe(true);
    expect(Array.isArray(m.outcomePrices)).toBe(true);
    expect(m.closed).toBe(false); // we default to open markets
  });

  it('returns markets with parsed tokenIds (2 per market)', async () => {
    const markets = await getMarkets({ limit: 5 });
    for (const m of markets) {
      // Most binary markets have exactly 2 tokens
      if (m.tokenIds.length > 0) {
        expect(m.tokenIds.length).toBe(2);
        expect(typeof m.tokenIds[0]).toBe('string');
        expect(m.tokenIds[0].length).toBeGreaterThan(0);
      }
    }
  });

  it('respects limit parameter', async () => {
    const markets = await getMarkets({ limit: 1 });
    expect(markets).toHaveLength(1);
  });

  it('respects offset parameter', async () => {
    const first = await getMarkets({ limit: 1, offset: 0 });
    const second = await getMarkets({ limit: 1, offset: 1 });

    // Should be different markets
    if (first.length > 0 && second.length > 0) {
      expect(first[0].id).not.toBe(second[0].id);
    }
  });
});

// ---------------------------------------------------------------------------
// Gamma API — Single Market
// ---------------------------------------------------------------------------

describe('Live Gamma API — getMarket', () => {
  it('fetches a specific market by ID', async () => {
    // First get a valid ID
    const markets = await getMarkets({ limit: 1 });
    expect(markets.length).toBeGreaterThan(0);

    const market = await getMarket(markets[0].id);
    expect(market.id).toBe(markets[0].id);
    expect(market.question).toBe(markets[0].question);
  });
});

// ---------------------------------------------------------------------------
// Gamma API — Events
// ---------------------------------------------------------------------------

describe('Live Gamma API — getEvents', () => {
  it('fetches active events with nested markets', async () => {
    const events = await getEvents({ limit: 3 });
    expect(events.length).toBeGreaterThan(0);

    const ev = events[0];
    expect(ev.id).toBeDefined();
    expect(typeof ev.title).toBe('string');
    expect(Array.isArray(ev.markets)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// CLOB API — Pricing
// ---------------------------------------------------------------------------

describe('Live CLOB API — Pricing', () => {
  let validTokenId: string;

  // Get a real token ID for CLOB tests
  beforeAll(async () => {
    const markets = await getMarkets({ limit: 5 });
    const withTokens = markets.find((m) => m.tokenIds.length >= 2);
    if (!withTokens) throw new Error('No markets with token IDs found');
    validTokenId = withTokens.tokenIds[0]; // YES token
  });

  it('getMidpoint returns a number between 0 and 1', async () => {
    const midpoint = await getMidpoint(validTokenId);
    expect(typeof midpoint).toBe('number');
    expect(midpoint).toBeGreaterThanOrEqual(0);
    expect(midpoint).toBeLessThanOrEqual(1);
  });

  it('getSpread returns a non-negative number', async () => {
    const spread = await getSpread(validTokenId);
    expect(typeof spread).toBe('number');
    expect(spread).toBeGreaterThanOrEqual(0);
  });

  it('getLastTradePrice returns price and side', async () => {
    const ltp = await getLastTradePrice(validTokenId);
    expect(typeof ltp.price).toBe('number');
    expect(typeof ltp.side).toBe('string');
    expect(ltp.price).toBeGreaterThanOrEqual(0);
    expect(ltp.price).toBeLessThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------
// CLOB API — Order Book
// ---------------------------------------------------------------------------

describe('Live CLOB API — Order Book', () => {
  let validTokenId: string;

  beforeAll(async () => {
    const markets = await getMarkets({ limit: 5 });
    const withTokens = markets.find((m) => m.tokenIds.length >= 2);
    if (!withTokens) throw new Error('No markets with token IDs found');
    validTokenId = withTokens.tokenIds[0];
  });

  it('returns a valid order book structure', async () => {
    const book = await getOrderBook(validTokenId);
    expect(typeof book.market).toBe('string');
    expect(typeof book.assetId).toBe('string');
    expect(Array.isArray(book.bids)).toBe(true);
    expect(Array.isArray(book.asks)).toBe(true);

    // If there are bids/asks, they should have numeric price/size
    if (book.bids.length > 0) {
      expect(typeof book.bids[0].price).toBe('number');
      expect(typeof book.bids[0].size).toBe('number');
    }
  });
});

// ---------------------------------------------------------------------------
// CLOB API — Price History
// ---------------------------------------------------------------------------

describe('Live CLOB API — Price History', () => {
  it('returns price history points for a known market', async () => {
    const markets = await getMarkets({ limit: 5 });
    const withCondition = markets.find((m) => m.conditionId);
    if (!withCondition) return; // skip if no suitable market

    const history = await getPriceHistory(withCondition.conditionId, 'max', 60);
    expect(Array.isArray(history)).toBe(true);

    if (history.length > 0) {
      expect(typeof history[0].timestamp).toBe('number');
      expect(typeof history[0].price).toBe('number');
    }
  });
});
