// =============================================================================
// Polymarket US API Client (polymarket.us — regulated US prediction market)
// =============================================================================
//
// Uses the official `polymarket-us` SDK for all API interactions.
// Handles Ed25519-signed authentication automatically via SDK.
//
// Follows the same export pattern as kalshi.ts.
// =============================================================================

import {
  PolymarketUS,
  type MarketDetail,
  type MarketBBO,
  type MarketBook,
  type Event as PMEvent,
  type GetMarketsResponse,
  type GetMarketResponse,
  type GetEventsResponse,
  type GetEventResponse,
  type SearchResponse,
  type MarketsListParams,
  type EventsListParams,
  type SearchParams,
} from 'polymarket-us';
import type { OrderBook, OrderBookLevel } from '@/lib/types';

// ---------------------------------------------------------------------------
// Singleton client — initialized lazily
// ---------------------------------------------------------------------------

let _client: PolymarketUS | null = null;

function getClient(): PolymarketUS {
  if (!_client) {
    const useDemo = process.env.POLYMARKET_US_USE_DEMO === 'true';
    const keyId = useDemo
      ? process.env.POLYMARKET_US_DEMO_KEY_ID
      : process.env.POLYMARKET_US_KEY_ID;
    const secretKey = useDemo
      ? process.env.POLYMARKET_US_DEMO_SECRET_KEY
      : process.env.POLYMARKET_US_SECRET_KEY;

    _client = new PolymarketUS({
      ...(keyId && secretKey ? { keyId, secretKey } : {}),
      ...(useDemo ? {
        apiBaseUrl: 'https://api.preprod.polymarketexchange.com',
        gatewayBaseUrl: 'https://api.preprod.polymarketexchange.com',
      } : {}),
    });
  }
  return _client;
}

/**
 * Expose the raw SDK client for routes that need direct access.
 */
export function getPolymarketUsClient(): PolymarketUS {
  return getClient();
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function normalizePrice(value: unknown): number | null {
  if (value == null) return null;

  // SDK Amount type: { value: string, currency: 'USD' }
  if (typeof value === 'object' && 'value' in (value as Record<string, unknown>)) {
    const v = Number((value as { value: string }).value);
    if (!Number.isFinite(v) || v <= 0) return null;
    return v > 1 ? v / 100 : v;
  }

  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return null;
  return numeric > 1 ? numeric / 100 : numeric;
}

type PolymarketUsPricePurpose = 'BUY' | 'SELL' | 'MARK';

function roundPrice(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function complementPrice(value: number | null): number | null {
  return value === null ? null : roundPrice(1 - value);
}

/**
 * Resolve an outcome-aware price from the venue BBO response.
 *
 * Polymarket US exposes one long/YES order book. A marketable NO buy crosses
 * the YES bid (cost = 1 - bestBid), while a NO sell crosses the YES ask
 * (proceeds = 1 - bestAsk). Treating NO as the YES price creates synthetic
 * pairs whose cost is far below $1 and produces impossible paper profits.
 */
export function resolvePolymarketUsOutcomePriceFromBbo(
  raw: unknown,
  outcome: 'YES' | 'NO',
  purpose: PolymarketUsPricePurpose,
): number | null {
  if (!raw || typeof raw !== 'object') return null;
  const wrapped = raw as Record<string, unknown>;
  const bbo = (wrapped.marketData ?? wrapped) as Record<string, unknown>;

  const bestBid = normalizePrice(bbo.bestBid);
  const bestAsk = normalizePrice(bbo.bestAsk);

  if (purpose === 'BUY') {
    return outcome === 'YES' ? bestAsk : complementPrice(bestBid);
  }
  if (purpose === 'SELL') {
    return outcome === 'YES' ? bestBid : complementPrice(bestAsk);
  }

  // Existing long positions are marked at executable liquidation value. A
  // quote/current/midpoint can be useful for display, but cannot be realized
  // and materially overstates NAV when the spread is wide.
  return outcome === 'YES' ? bestBid : complementPrice(bestAsk);
}

function normalizeBookLevels(value: unknown): OrderBookLevel[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((level) => {
    if (!level || typeof level !== 'object') return [];
    const record = level as Record<string, unknown>;
    const price = normalizePrice(record.px);
    const size = Number(record.qty);
    if (price === null || price <= 0 || price >= 1 || !Number.isFinite(size) || size <= 0) return [];
    return [{ price, size }];
  });
}

/** Convert the venue's single YES book into executable YES or NO depth. */
export function normalizePolymarketUsOutcomeOrderBook(
  slug: string,
  outcome: 'YES' | 'NO',
  raw: unknown,
): OrderBook {
  const wrapped = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
  const book = wrapped.marketData && typeof wrapped.marketData === 'object'
    ? wrapped.marketData as Record<string, unknown>
    : wrapped;
  const yesBids = normalizeBookLevels(book.bids);
  const yesOffers = normalizeBookLevels(book.offers);
  const complement = (levels: OrderBookLevel[]) => levels.map((level) => ({
    price: roundPrice(1 - level.price),
    size: level.size,
  }));

  const bids = outcome === 'YES' ? yesBids : complement(yesOffers);
  const asks = outcome === 'YES' ? yesOffers : complement(yesBids);
  return {
    market: slug,
    assetId: polymarketUsTokenId(slug, outcome),
    timestamp: typeof book.transactTime === 'string' ? book.transactTime : new Date().toISOString(),
    bids: bids.sort((a, b) => b.price - a.price),
    asks: asks.sort((a, b) => a.price - b.price),
  };
}

export async function getPolymarketUsOutcomeOrderBook(
  slug: string,
  outcome: 'YES' | 'NO',
): Promise<OrderBook | null> {
  const raw = await getPolymarketUsMarketBook(slug);
  return raw ? normalizePolymarketUsOutcomeOrderBook(slug, outcome, raw) : null;
}

// ---------------------------------------------------------------------------
// Market endpoints
// ---------------------------------------------------------------------------

/**
 * Fetch a single market by slug from the Polymarket US API.
 */
export async function getPolymarketUsMarket(
  slug: string,
): Promise<MarketDetail | null> {
  try {
    const res: GetMarketResponse = await getClient().markets.retrieveBySlug(slug);
    return res.market ?? null;
  } catch {
    return null;
  }
}

/**
 * Fetch a list of markets with optional filters.
 */
export async function getPolymarketUsMarkets(
  params?: MarketsListParams,
): Promise<GetMarketsResponse | null> {
  try {
    return await getClient().markets.list(params);
  } catch {
    return null;
  }
}

/**
 * Fetch the full order book for a market.
 */
export async function getPolymarketUsMarketBook(
  slug: string,
): Promise<MarketBook | null> {
  try {
    return await getClient().markets.book(slug);
  } catch {
    return null;
  }
}

/**
 * Fetch best bid/offer for a market.
 */
export async function getPolymarketUsMarketBBO(
  slug: string,
): Promise<MarketBBO | null> {
  try {
    return await getClient().markets.bbo(slug);
  } catch {
    return null;
  }
}

/** Fetch the venue's authoritative settlement price for one US market. */
export type PolymarketUsMarketSettlement = {
  marketSlug: string;
  settlementPrice: { value: string; currency: 'USD' };
  settledAt?: string;
};

export async function getPolymarketUsMarketSettlement(
  slug: string,
): Promise<PolymarketUsMarketSettlement | null> {
  try {
    const raw = await getClient().markets.settlement(slug) as unknown as Record<string, unknown>;
    const amount = raw.settlementPrice && typeof raw.settlementPrice === 'object'
      ? raw.settlementPrice as Record<string, unknown>
      : null;
    const value = amount?.value ?? raw.settlement;
    if (!Number.isFinite(Number(value))) return null;
    return {
      marketSlug: String(raw.marketSlug ?? raw.slug ?? slug),
      settlementPrice: { value: String(value), currency: 'USD' },
      ...(typeof raw.settledAt === 'string' ? { settledAt: raw.settledAt } : {}),
    };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Event endpoints
// ---------------------------------------------------------------------------

/**
 * Fetch a list of events with optional filters.
 */
export async function getPolymarketUsEvents(
  params?: EventsListParams,
): Promise<GetEventsResponse | null> {
  try {
    return await getClient().events.list(params);
  } catch {
    return null;
  }
}

/**
 * Fetch a single event by ID (numeric).
 */
export async function getPolymarketUsEvent(
  id: number,
): Promise<GetEventResponse | null> {
  try {
    return await getClient().events.retrieve(id);
  } catch {
    return null;
  }
}

/**
 * Fetch a single event by slug.
 */
export async function getPolymarketUsEventBySlug(
  slug: string,
): Promise<GetEventResponse | null> {
  try {
    return await getClient().events.retrieveBySlug(slug);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

/**
 * Search for events/markets.
 */
export async function searchPolymarketUs(
  params?: SearchParams,
): Promise<SearchResponse | null> {
  try {
    return await getClient().search.query(params);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Price helpers
// ---------------------------------------------------------------------------

/**
 * Get the best price for a given outcome and side using the BBO endpoint.
 *
 * - BUY  → uses the best ask (cheapest available offer)
 * - SELL → uses the best bid (highest available bid)
 *
 * Note: The actual SDK responses nest data under `marketData`, so we
 * handle both the typed shape and the actual runtime shape.
 */
export async function getPolymarketUsOutcomePrice(
  slug: string,
  outcome: 'YES' | 'NO',
  side: PolymarketUsPricePurpose = 'BUY',
): Promise<number | null> {
  // Use BBO for top-of-book pricing
  const bboRaw = await getPolymarketUsMarketBBO(slug) as Record<string, unknown> | null;
  if (bboRaw) {
    const price = resolvePolymarketUsOutcomePriceFromBbo(bboRaw, outcome, side);
    if (price !== null && price > 0 && price < 1) return price;
  }

  if (side === 'MARK') return null;

  // Fallback: try the full order book
  const bookRaw = await getPolymarketUsMarketBook(slug) as Record<string, unknown> | null;
  if (bookRaw) {
    const book = (bookRaw.marketData ?? bookRaw) as Record<string, unknown>;
    const offers = book.offers as Array<{ px: unknown }> | undefined;
    const bids = book.bids as Array<{ px: unknown }> | undefined;
    const bestAsk = offers
      ?.map((level) => normalizePrice(level.px))
      .filter((price): price is number => price !== null)
      .sort((a, b) => a - b)[0] ?? null;
    const bestBid = bids
      ?.map((level) => normalizePrice(level.px))
      .filter((price): price is number => price !== null)
      .sort((a, b) => b - a)[0] ?? null;
    const price = side === 'BUY'
      ? (outcome === 'YES' ? bestAsk : complementPrice(bestBid))
      : (outcome === 'YES' ? bestBid : complementPrice(bestAsk));
    if (price !== null && price > 0 && price < 1) return price;
  }

  return null;
}

// ---------------------------------------------------------------------------
// Token ID helpers
// ---------------------------------------------------------------------------

/**
 * Generate a deterministic token ID for a Polymarket US market/outcome pair.
 */
export function polymarketUsTokenId(
  slug: string,
  outcome: 'YES' | 'NO',
): string {
  return `polymarket_us:${slug}:${outcome}`;
}

/**
 * Parse a Polymarket US token ID back into slug and outcome.
 */
export function parsePolymarketUsTokenId(
  tokenId: string,
): { slug: string; outcome: 'YES' | 'NO' } | null {
  const match = /^polymarket_us:(.+):(YES|NO)$/.exec(tokenId);
  if (!match) return null;
  return { slug: match[1], outcome: match[2] as 'YES' | 'NO' };
}

// Re-export SDK types for use in routes
export type {
  MarketDetail,
  MarketBBO,
  MarketBook,
  PMEvent,
  GetMarketsResponse,
  GetMarketResponse,
  GetEventsResponse,
  GetEventResponse,
  SearchResponse,
  MarketsListParams,
  EventsListParams,
  SearchParams,
};
