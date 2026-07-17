// =============================================================================
// Order Book Fill Simulator
// =============================================================================
//
// Walks the real Polymarket CLOB order book level-by-level to simulate
// realistic fills with slippage, matching the reference implementation's
// `pm_trader/orderbook.py` approach.
//
// Supports two order types:
//   - FOK (Fill-or-Kill): entire order must fill or nothing executes
//   - FAK (Fill-and-Kill / IOC): partial fills are allowed
// =============================================================================

import type { OrderBook, OrderBookLevel } from '@/lib/types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** How the simulated order should be filled. */
export type FillType = 'FOK' | 'FAK';

/** A single filled level in the order book walk. */
export interface FilledLevel {
  price: number;
  size: number;
  cost: number;
}

/** Result of a simulated buy fill. */
export interface BuyFillResult {
  /** Whether the fill was successful (always true for FAK with any liquidity). */
  success: boolean;
  /** Average fill price across all levels. */
  avgPrice: number;
  /** Total shares acquired. */
  totalShares: number;
  /** Total USD cost (before fees). */
  totalCost: number;
  /** Fee amount in USD. */
  fee: number;
  /** Total cost including fees. */
  totalWithFee: number;
  /** Slippage in basis points vs the midpoint. */
  slippageBps: number;
  /** Number of order book levels consumed. */
  levelsFilled: number;
  /** Whether this was a partial fill (FAK only). */
  isPartial: boolean;
  /** Breakdown of fills per price level. */
  levels: FilledLevel[];
}

/** Result of a simulated sell fill. */
export interface SellFillResult {
  success: boolean;
  /** Average fill price across all levels. */
  avgPrice: number;
  /** Total shares sold. */
  totalShares: number;
  /** Total USD proceeds (before fees). */
  totalProceeds: number;
  /** Fee amount in USD. */
  fee: number;
  /** Total proceeds after fees. */
  totalAfterFee: number;
  /** Slippage in basis points vs the midpoint. */
  slippageBps: number;
  /** Number of order book levels consumed. */
  levelsFilled: number;
  /** Whether this was a partial fill (FAK only). */
  isPartial: boolean;
  /** Breakdown of fills per price level. */
  levels: FilledLevel[];
}

// ---------------------------------------------------------------------------
// Fee calculation (Polymarket formula)
// ---------------------------------------------------------------------------

/**
 * Calculate the Polymarket trading fee.
 * Formula: (feeRateBps / 10_000) * min(price, 1 - price) * shares
 */
export function calculateFeeForLevel(
  price: number,
  shares: number,
  feeRateBps: number,
): number {
  if (feeRateBps === 0) return 0;
  const fee = (feeRateBps / 10_000) * Math.min(price, 1.0 - price) * shares;
  return fee > 0 ? Math.max(fee, 0.0001) : 0;
}

// ---------------------------------------------------------------------------
// Midpoint calculation
// ---------------------------------------------------------------------------

/**
 * Calculate the midpoint from the order book's best bid and ask.
 * Falls back to 0.5 if either side is empty.
 */
export function calculateMidpoint(orderBook: OrderBook): number {
  const bestBid = orderBook.bids.length > 0 ? orderBook.bids[0].price : null;
  const bestAsk = orderBook.asks.length > 0 ? orderBook.asks[0].price : null;

  if (bestBid !== null && bestAsk !== null) {
    return (bestBid + bestAsk) / 2;
  }
  if (bestBid !== null) return bestBid;
  if (bestAsk !== null) return bestAsk;
  return 0.5;
}

// ---------------------------------------------------------------------------
// Buy Fill Simulation
// ---------------------------------------------------------------------------

/**
 * Simulate a buy order by walking the ask side of the order book.
 *
 * For a BUY, we consume ASK levels (sellers) from lowest to highest price.
 * The user specifies `amountUsd` they want to spend.
 *
 * @param orderBook - The full order book for the token
 * @param amountUsd - The USD amount to spend (before fees)
 * @param feeRateBps - Fee rate in basis points (e.g. 200 = 2%)
 * @param fillType - FOK (fill-or-kill) or FAK (partial fill allowed)
 * @returns BuyFillResult
 */
export function simulateBuyFill(
  orderBook: OrderBook,
  amountUsd: number,
  feeRateBps: number = 0,
  fillType: FillType = 'FAK',
): BuyFillResult {
  const emptyResult: BuyFillResult = {
    success: false,
    avgPrice: 0,
    totalShares: 0,
    totalCost: 0,
    fee: 0,
    totalWithFee: 0,
    slippageBps: 0,
    levelsFilled: 0,
    isPartial: false,
    levels: [],
  };

  // Asks should be sorted ascending (cheapest first)
  const asks = [...orderBook.asks].sort((a, b) => a.price - b.price);
  if (asks.length === 0) return emptyResult;

  const midpoint = calculateMidpoint(orderBook);
  let remainingUsd = amountUsd;
  let totalShares = 0;
  let totalCost = 0;
  let totalFee = 0;
  const filledLevels: FilledLevel[] = [];

  for (const level of asks) {
    if (remainingUsd <= 0) break;
    if (level.price <= 0 || level.size <= 0) continue;

    // How many shares can we buy at this level?
    const maxSharesAtLevel = level.size;
    // How much would it cost to buy all shares at this level?
    const costForAll = maxSharesAtLevel * level.price;
    const feeForAll = calculateFeeForLevel(level.price, maxSharesAtLevel, feeRateBps);

    if (costForAll + feeForAll <= remainingUsd) {
      // Consume the entire level
      totalShares += maxSharesAtLevel;
      totalCost += costForAll;
      totalFee += feeForAll;
      remainingUsd -= (costForAll + feeForAll);
      filledLevels.push({ price: level.price, size: maxSharesAtLevel, cost: costForAll });
    } else {
      // Partial fill at this level
      // Solve for shares: shares * price + fee(shares) <= remainingUsd
      // fee = (feeRateBps / 10000) * min(price, 1-price) * shares
      // shares * (price + (feeRateBps/10000) * min(price, 1-price)) <= remainingUsd
      const effectiveRate = level.price + (feeRateBps / 10_000) * Math.min(level.price, 1 - level.price);
      const partialShares = Math.min(remainingUsd / effectiveRate, maxSharesAtLevel);
      
      if (partialShares >= 0.001) {
        const partialCost = partialShares * level.price;
        const partialFee = calculateFeeForLevel(level.price, partialShares, feeRateBps);
        totalShares += partialShares;
        totalCost += partialCost;
        totalFee += partialFee;
        remainingUsd -= (partialCost + partialFee);
        filledLevels.push({ price: level.price, size: partialShares, cost: partialCost });
      }
      break;
    }
  }

  if (totalShares < 0.001) return emptyResult;

  const isPartial = remainingUsd > 0.01;

  // FOK: reject if partial
  if (fillType === 'FOK' && isPartial) {
    return emptyResult;
  }

  const avgPrice = totalCost / totalShares;
  const slippageBps = midpoint > 0
    ? Math.round(((avgPrice - midpoint) / midpoint) * 10_000)
    : 0;

  return {
    success: true,
    avgPrice: roundTo(avgPrice, 6),
    totalShares: roundTo(totalShares, 6),
    totalCost: roundTo(totalCost, 6),
    fee: roundTo(totalFee, 6),
    totalWithFee: roundTo(totalCost + totalFee, 6),
    slippageBps,
    levelsFilled: filledLevels.length,
    isPartial,
    levels: filledLevels,
  };
}

/** Walk asks for an exact number of shares, preserving FOK semantics. */
export function simulateBuySharesFill(
  orderBook: OrderBook,
  sharesToBuy: number,
  feeRateBps: number = 0,
  fillType: FillType = 'FAK',
): BuyFillResult {
  const emptyResult: BuyFillResult = {
    success: false, avgPrice: 0, totalShares: 0, totalCost: 0, fee: 0,
    totalWithFee: 0, slippageBps: 0, levelsFilled: 0, isPartial: false, levels: [],
  };
  if (!Number.isFinite(sharesToBuy) || sharesToBuy <= 0) return emptyResult;

  const asks = [...orderBook.asks].sort((a, b) => a.price - b.price);
  const midpoint = calculateMidpoint(orderBook);
  let remainingShares = sharesToBuy;
  let totalShares = 0;
  let totalCost = 0;
  let totalFee = 0;
  const levels: FilledLevel[] = [];

  for (const level of asks) {
    if (remainingShares <= 0.001) break;
    if (level.price <= 0 || level.size <= 0) continue;
    const size = Math.min(remainingShares, level.size);
    const cost = size * level.price;
    const fee = calculateFeeForLevel(level.price, size, feeRateBps);
    totalShares += size;
    totalCost += cost;
    totalFee += fee;
    remainingShares -= size;
    levels.push({ price: level.price, size, cost });
  }

  if (totalShares < 0.001) return emptyResult;
  const isPartial = remainingShares > 0.001;
  if (fillType === 'FOK' && isPartial) return emptyResult;
  const avgPrice = totalCost / totalShares;
  return {
    success: true,
    avgPrice: roundTo(avgPrice, 6),
    totalShares: roundTo(totalShares, 6),
    totalCost: roundTo(totalCost, 6),
    fee: roundTo(totalFee, 6),
    totalWithFee: roundTo(totalCost + totalFee, 6),
    slippageBps: midpoint > 0 ? Math.round(((avgPrice - midpoint) / midpoint) * 10_000) : 0,
    levelsFilled: levels.length,
    isPartial,
    levels,
  };
}

// ---------------------------------------------------------------------------
// Sell Fill Simulation
// ---------------------------------------------------------------------------

/**
 * Simulate a sell order by walking the bid side of the order book.
 *
 * For a SELL, we consume BID levels (buyers) from highest to lowest price.
 * The user specifies `sharesToSell`.
 *
 * @param orderBook - The full order book for the token
 * @param sharesToSell - Number of shares to sell
 * @param feeRateBps - Fee rate in basis points
 * @param fillType - FOK or FAK
 * @returns SellFillResult
 */
export function simulateSellFill(
  orderBook: OrderBook,
  sharesToSell: number,
  feeRateBps: number = 0,
  fillType: FillType = 'FAK',
): SellFillResult {
  const emptyResult: SellFillResult = {
    success: false,
    avgPrice: 0,
    totalShares: 0,
    totalProceeds: 0,
    fee: 0,
    totalAfterFee: 0,
    slippageBps: 0,
    levelsFilled: 0,
    isPartial: false,
    levels: [],
  };

  // Bids should be sorted descending (highest price first)
  const bids = [...orderBook.bids].sort((a, b) => b.price - a.price);
  if (bids.length === 0) return emptyResult;

  const midpoint = calculateMidpoint(orderBook);
  let remainingShares = sharesToSell;
  let totalShares = 0;
  let totalProceeds = 0;
  let totalFee = 0;
  const filledLevels: FilledLevel[] = [];

  for (const level of bids) {
    if (remainingShares <= 0.001) break;
    if (level.price <= 0 || level.size <= 0) continue;

    const fillSize = Math.min(remainingShares, level.size);
    const proceeds = fillSize * level.price;
    const fee = calculateFeeForLevel(level.price, fillSize, feeRateBps);

    totalShares += fillSize;
    totalProceeds += proceeds;
    totalFee += fee;
    remainingShares -= fillSize;
    filledLevels.push({ price: level.price, size: fillSize, cost: proceeds });
  }

  if (totalShares < 0.001) return emptyResult;

  const isPartial = remainingShares > 0.001;

  // FOK: reject if partial
  if (fillType === 'FOK' && isPartial) {
    return emptyResult;
  }

  const avgPrice = totalProceeds / totalShares;
  const slippageBps = midpoint > 0
    ? Math.round(((midpoint - avgPrice) / midpoint) * 10_000)
    : 0;

  return {
    success: true,
    avgPrice: roundTo(avgPrice, 6),
    totalShares: roundTo(totalShares, 6),
    totalProceeds: roundTo(totalProceeds, 6),
    fee: roundTo(totalFee, 6),
    totalAfterFee: roundTo(totalProceeds - totalFee, 6),
    slippageBps,
    levelsFilled: filledLevels.length,
    isPartial,
    levels: filledLevels,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function roundTo(n: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(n * factor) / factor;
}
