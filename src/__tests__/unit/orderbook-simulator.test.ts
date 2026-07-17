import { describe, it, expect } from 'vitest';
import {
  simulateBuyFill,
  simulateBuySharesFill,
  simulateSellFill,
  calculateFeeForLevel,
  calculateMidpoint,
} from '@/lib/orderbook-simulator';
import type { OrderBook } from '@/lib/types';

// Helper to create a test order book
function makeOrderBook(
  bids: { price: number; size: number }[],
  asks: { price: number; size: number }[],
): OrderBook {
  return {
    market: 'test-market',
    assetId: 'test-asset',
    timestamp: new Date().toISOString(),
    bids,
    asks,
  };
}

describe('Order Book Simulator', () => {
  // ── Fee Calculation ───────────────────────────────────────────────────
  describe('calculateFeeForLevel', () => {
    it('returns 0 when feeRateBps is 0', () => {
      expect(calculateFeeForLevel(0.5, 100, 0)).toBe(0);
    });

    it('calculates correct fee using Polymarket formula', () => {
      // fee = (200/10000) * min(0.6, 0.4) * 100 = 0.02 * 0.4 * 100 = 0.80
      const fee = calculateFeeForLevel(0.6, 100, 200);
      expect(fee).toBeCloseTo(0.8, 4);
    });

    it('uses min(price, 1-price) correctly for high prices', () => {
      // fee = (200/10000) * min(0.9, 0.1) * 100 = 0.02 * 0.1 * 100 = 0.20
      const fee = calculateFeeForLevel(0.9, 100, 200);
      expect(fee).toBeCloseTo(0.2, 4);
    });

    it('uses min(price, 1-price) correctly for low prices', () => {
      // fee = (200/10000) * min(0.1, 0.9) * 100 = 0.02 * 0.1 * 100 = 0.20
      const fee = calculateFeeForLevel(0.1, 100, 200);
      expect(fee).toBeCloseTo(0.2, 4);
    });
  });

  // ── Midpoint Calculation ──────────────────────────────────────────────
  describe('calculateMidpoint', () => {
    it('calculates midpoint from best bid and ask', () => {
      const ob = makeOrderBook(
        [{ price: 0.48, size: 100 }],
        [{ price: 0.52, size: 100 }],
      );
      expect(calculateMidpoint(ob)).toBeCloseTo(0.5, 4);
    });

    it('returns best bid when no asks', () => {
      const ob = makeOrderBook([{ price: 0.45, size: 100 }], []);
      expect(calculateMidpoint(ob)).toBe(0.45);
    });

    it('returns best ask when no bids', () => {
      const ob = makeOrderBook([], [{ price: 0.55, size: 100 }]);
      expect(calculateMidpoint(ob)).toBe(0.55);
    });

    it('returns 0.5 when book is empty', () => {
      const ob = makeOrderBook([], []);
      expect(calculateMidpoint(ob)).toBe(0.5);
    });
  });

  // ── Buy Fill Simulation ───────────────────────────────────────────────
  describe('simulateBuyFill', () => {
    it('fills a simple buy on a single level', () => {
      const ob = makeOrderBook(
        [{ price: 0.48, size: 1000 }],
        [{ price: 0.52, size: 1000 }],
      );

      const result = simulateBuyFill(ob, 52, 0, 'FAK');
      expect(result.success).toBe(true);
      expect(result.avgPrice).toBeCloseTo(0.52, 4);
      expect(result.totalShares).toBeCloseTo(100, 0);
      expect(result.totalCost).toBeCloseTo(52, 0);
      expect(result.levelsFilled).toBe(1);
      expect(result.isPartial).toBe(false);
    });

    it('walks multiple ask levels with increasing prices', () => {
      const ob = makeOrderBook(
        [{ price: 0.48, size: 100 }],
        [
          { price: 0.50, size: 50 },   // level 1: 50 shares @ $0.50 = $25
          { price: 0.55, size: 50 },   // level 2: 50 shares @ $0.55 = $27.50
          { price: 0.60, size: 100 },  // level 3: remaining
        ],
      );

      // Spend $60: fills 50@0.50 ($25) + 50@0.55 ($27.50) + partial@0.60 ($7.50 ≈ 12.5 shares)
      const result = simulateBuyFill(ob, 60, 0, 'FAK');
      expect(result.success).toBe(true);
      expect(result.levelsFilled).toBe(3);
      expect(result.totalShares).toBeGreaterThan(100);
      expect(result.totalCost).toBeCloseTo(60, 1);
      // Average price should be between 0.50 and 0.60
      expect(result.avgPrice).toBeGreaterThan(0.50);
      expect(result.avgPrice).toBeLessThan(0.60);
    });

    it('returns partial fill with FAK when liquidity is insufficient', () => {
      const ob = makeOrderBook(
        [{ price: 0.48, size: 100 }],
        [{ price: 0.50, size: 20 }], // Only 20 shares available = $10 total
      );

      const result = simulateBuyFill(ob, 100, 0, 'FAK');
      expect(result.success).toBe(true);
      expect(result.isPartial).toBe(true);
      expect(result.totalShares).toBeCloseTo(20, 1);
    });

    it('rejects FOK when liquidity is insufficient', () => {
      const ob = makeOrderBook(
        [{ price: 0.48, size: 100 }],
        [{ price: 0.50, size: 20 }],
      );

      const result = simulateBuyFill(ob, 100, 0, 'FOK');
      expect(result.success).toBe(false);
    });

    it('returns failure when ask side is empty', () => {
      const ob = makeOrderBook([{ price: 0.48, size: 100 }], []);
      const result = simulateBuyFill(ob, 100, 0, 'FAK');
      expect(result.success).toBe(false);
    });

    it('calculates positive slippage when buying above midpoint', () => {
      const ob = makeOrderBook(
        [{ price: 0.40, size: 100 }],
        [{ price: 0.60, size: 100 }],
      );
      // Midpoint = 0.50, fills at 0.60 → slippage should be positive
      const result = simulateBuyFill(ob, 60, 0, 'FAK');
      expect(result.success).toBe(true);
      expect(result.slippageBps).toBeGreaterThan(0);
    });

    it('accounts for fees in fill calculation', () => {
      const ob = makeOrderBook(
        [{ price: 0.48, size: 100 }],
        [{ price: 0.50, size: 1000 }],
      );

      const withoutFee = simulateBuyFill(ob, 100, 0, 'FAK');
      const withFee = simulateBuyFill(ob, 100, 200, 'FAK');

      // With fees, fewer shares should be purchased for the same USD
      expect(withFee.totalShares).toBeLessThan(withoutFee.totalShares);
      expect(withFee.fee).toBeGreaterThan(0);
    });
  });

  describe('simulateBuySharesFill', () => {
    it('walks asks for an exact share quantity', () => {
      const ob = makeOrderBook([], [
        { price: 0.5, size: 10 },
        { price: 0.6, size: 10 },
      ]);
      const result = simulateBuySharesFill(ob, 15, 0, 'FOK');
      expect(result.success).toBe(true);
      expect(result.totalShares).toBe(15);
      expect(result.totalCost).toBe(8);
      expect(result.avgPrice).toBeCloseTo(8 / 15, 6);
      expect(result.levelsFilled).toBe(2);
    });

    it('kills an exact-share order when full live depth is unavailable', () => {
      const ob = makeOrderBook([], [{ price: 0.5, size: 10 }]);
      expect(simulateBuySharesFill(ob, 11, 0, 'FOK').success).toBe(false);
    });
  });

  // ── Sell Fill Simulation ──────────────────────────────────────────────
  describe('simulateSellFill', () => {
    it('fills a simple sell on a single bid level', () => {
      const ob = makeOrderBook(
        [{ price: 0.48, size: 1000 }],
        [{ price: 0.52, size: 1000 }],
      );

      const result = simulateSellFill(ob, 100, 0, 'FAK');
      expect(result.success).toBe(true);
      expect(result.avgPrice).toBeCloseTo(0.48, 4);
      expect(result.totalShares).toBeCloseTo(100, 1);
      expect(result.totalProceeds).toBeCloseTo(48, 0);
      expect(result.levelsFilled).toBe(1);
    });

    it('walks multiple bid levels with decreasing prices', () => {
      const ob = makeOrderBook(
        [
          { price: 0.50, size: 50 },   // level 1: best bid
          { price: 0.45, size: 50 },   // level 2
          { price: 0.40, size: 100 },  // level 3
        ],
        [{ price: 0.52, size: 100 }],
      );

      // Sell 120 shares: 50@0.50 + 50@0.45 + 20@0.40
      const result = simulateSellFill(ob, 120, 0, 'FAK');
      expect(result.success).toBe(true);
      expect(result.levelsFilled).toBe(3);
      expect(result.totalShares).toBeCloseTo(120, 1);
      // Average should be between 0.40 and 0.50
      expect(result.avgPrice).toBeGreaterThan(0.40);
      expect(result.avgPrice).toBeLessThan(0.50);
    });

    it('rejects FOK when bid liquidity is insufficient', () => {
      const ob = makeOrderBook(
        [{ price: 0.48, size: 20 }],
        [{ price: 0.52, size: 100 }],
      );

      const result = simulateSellFill(ob, 100, 0, 'FOK');
      expect(result.success).toBe(false);
    });

    it('returns partial fill with FAK', () => {
      const ob = makeOrderBook(
        [{ price: 0.48, size: 30 }],
        [{ price: 0.52, size: 100 }],
      );

      const result = simulateSellFill(ob, 100, 0, 'FAK');
      expect(result.success).toBe(true);
      expect(result.isPartial).toBe(true);
      expect(result.totalShares).toBeCloseTo(30, 1);
    });

    it('calculates positive slippage (worse execution) when selling below midpoint', () => {
      const ob = makeOrderBook(
        [{ price: 0.40, size: 100 }],
        [{ price: 0.60, size: 100 }],
      );
      // Midpoint = 0.50, fills at 0.40 → slippage should be positive (worse for seller)
      const result = simulateSellFill(ob, 50, 0, 'FAK');
      expect(result.success).toBe(true);
      expect(result.slippageBps).toBeGreaterThan(0);
    });

    it('deducts fees from proceeds', () => {
      const ob = makeOrderBook(
        [{ price: 0.50, size: 1000 }],
        [{ price: 0.52, size: 100 }],
      );

      const withoutFee = simulateSellFill(ob, 100, 0, 'FAK');
      const withFee = simulateSellFill(ob, 100, 200, 'FAK');

      expect(withFee.totalAfterFee).toBeLessThan(withoutFee.totalAfterFee);
      expect(withFee.fee).toBeGreaterThan(0);
    });
  });
});
