// =============================================================================
// Polymarket API Client
// =============================================================================
//
// Wraps the Gamma API (market/event listings) and the CLOB API (order book,
// midpoint, spread, last trade, price history).
//
// IMPORTANT implementation notes from API validation:
//  - clobTokenIds, outcomes, outcomePrices are JSON strings inside JSON
//  - All CLOB prices are strings, not numbers
//  - Must filter closed=false (active=true ≠ open for trading)
//  - Default sort returns oldest first — use order=volume24hr&ascending=false
//  - Each market has TWO token IDs: index 0 = YES, index 1 = NO
//  - data-api.polymarket.com is DEAD — do NOT use
// =============================================================================

import type {
  RawPolymarketMarket,
  RawPolymarketEvent,
  RawMidpointResponse,
  RawSpreadResponse,
  RawLastTradePriceResponse,
  RawOrderBookResponse,
  RawPriceHistoryPoint,
  NormalizedMarket,
  NormalizedEvent,
  OrderBook,
  OrderBookLevel,
  PricePoint,
  LastTradePrice,
  FetchMarketsParams,
  FetchEventsParams,
} from '@/lib/types';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const GAMMA_API_BASE = 'https://gamma-api.polymarket.com';
const CLOB_API_BASE = 'https://clob.polymarket.com';

/** Default request timeout in milliseconds. */
const REQUEST_TIMEOUT_MS = 5_000;

// ---------------------------------------------------------------------------
// Error types
// ---------------------------------------------------------------------------

/** Custom error for Polymarket API failures. */
export class PolymarketApiError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number | null,
    public readonly endpoint: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'PolymarketApiError';
  }
}

// ---------------------------------------------------------------------------
// Internal fetch helper
// ---------------------------------------------------------------------------

/**
 * Perform a fetch with timeout and structured error handling.
 * Returns the parsed JSON body or throws a `PolymarketApiError`.
 */
async function fetchJson<T>(url: string): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new PolymarketApiError(
        `HTTP ${res.status}: ${res.statusText}`,
        res.status,
        url,
        body,
      );
    }

    return (await res.json()) as T;
  } catch (err) {
    if (err instanceof PolymarketApiError) throw err;

    const message =
      err instanceof DOMException && err.name === 'AbortError'
        ? `Request timed out after ${REQUEST_TIMEOUT_MS}ms`
        : `Network error: ${err instanceof Error ? err.message : String(err)}`;

    throw new PolymarketApiError(message, null, url, err);
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// JSON-string field parsers
// ---------------------------------------------------------------------------

/**
 * Safely parse a JSON-encoded string field.
 * Returns the parsed value or the provided `fallback`.
 */
function safeJsonParse<T>(raw: unknown, fallback: T): T {
  if (typeof raw !== 'string') return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

/**
 * Parse a JSON-encoded string array of number-strings into `number[]`.
 * e.g. '["0.55","0.45"]' → [0.55, 0.45]
 */
function parsePriceArray(raw: unknown): number[] {
  const arr = safeJsonParse<string[]>(raw, []);
  return arr.map((v) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  });
}

// ---------------------------------------------------------------------------
// Normalization helpers
// ---------------------------------------------------------------------------

function normalizeCategory(eventCategory: string, tags: { label: string }[] = []): string {
  const category = eventCategory?.trim();
  if (category && category !== 'None') return category;
  
  if (tags && tags.length > 0) {
    return tags[0].label.trim();
  }
  
  return 'Other';
}

/**
 * Normalize a raw Gamma API market into our domain model.
 * Handles the JSON-inside-JSON quirk for clobTokenIds, outcomes, outcomePrices.
 */
function normalizeMarket(raw: RawPolymarketMarket, eventCategory?: string): NormalizedMarket {
  return {
    id: raw.id,
    question: raw.question ?? '',
    conditionId: raw.conditionId ?? '',
    slug: raw.slug ?? '',
    tokenIds: safeJsonParse<string[]>(raw.clobTokenIds, []),
    outcomes: safeJsonParse<string[]>(raw.outcomes, []),
    outcomePrices: parsePriceArray(raw.outcomePrices),
    lastTradePrice: raw.lastTradePrice ?? null,
    bestBid: raw.bestBid ?? null,
    bestAsk: raw.bestAsk ?? null,
    spread: raw.spread ?? null,
    volume24hr: raw.volume24hr ?? null,
    liquidity: raw.liquidityClob ?? raw.liquidity ?? null,
    image: raw.image ?? null,
    icon: raw.icon ?? null,
    description: raw.description ?? null,
    category: eventCategory ?? raw.category ?? null,
    closed: raw.closed ?? false,
    active: raw.active ?? true,
    startDate: raw.startDate ?? null,
    endDate: raw.endDate ?? null,
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt,
  };
}

/** Normalize a raw Gamma API event and all its nested markets. */
function normalizeEvent(raw: RawPolymarketEvent): NormalizedEvent {
  const eventCategory = normalizeCategory(
    (raw.category as string) ?? '',
    (raw.tags as { label: string }[]) ?? [],
  );

  return {
    id: raw.id,
    slug: raw.slug ?? '',
    title: raw.title ?? '',
    description: raw.description ?? null,
    image: raw.image ?? null,
    icon: raw.icon ?? null,
    category: eventCategory,
    closed: raw.closed ?? false,
    volume24hr: raw.volume24hr ?? null,
    liquidity: raw.liquidityClob ?? raw.liquidity ?? null,
    markets: Array.isArray(raw.markets)
      ? raw.markets.map((m) => normalizeMarket(m, eventCategory))
      : [],
    startDate: raw.startDate ?? null,
    endDate: raw.endDate ?? null,
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt,
  };
}

/** Normalize the raw order book response. */
function normalizeOrderBook(raw: RawOrderBookResponse): OrderBook {
  const parseLevel = (l: { price: string; size: string }): OrderBookLevel => ({
    price: Number(l.price) || 0,
    size: Number(l.size) || 0,
  });

  return {
    market: raw.market ?? '',
    assetId: raw.asset_id ?? '',
    timestamp: raw.timestamp ?? '',
    bids: Array.isArray(raw.bids) ? raw.bids.map(parseLevel) : [],
    asks: Array.isArray(raw.asks) ? raw.asks.map(parseLevel) : [],
  };
}

// ---------------------------------------------------------------------------
// Gamma API — Markets
// ---------------------------------------------------------------------------

/**
 * Fetch a list of active markets from the Gamma API.
 *
 * @param params - Optional query parameters (limit, offset, closed, order, ascending).
 * @returns An array of normalized markets sorted by 24h volume (descending) by default.
 *
 * @example
 * ```ts
 * const markets = await getMarkets({ limit: 10 });
 * ```
 */
export async function getMarkets(
  params: FetchMarketsParams = {},
): Promise<NormalizedMarket[]> {
  const {
    limit = 20,
    offset = 0,
    closed = false,
  } = params;

  // Compile a large list of active markets by fetching the first 10 pages of active events (total 1000 events)
  // This ensures we capture all categories comprehensively (e.g. tech, economics)
  const fetchPromises = Array.from({ length: 10 }).map((_, i) => {
    const url = new URL('/events', GAMMA_API_BASE);
    url.searchParams.set('closed', String(closed));
    url.searchParams.set('limit', '100');
    url.searchParams.set('offset', String(i * 100));
    // CRITICAL: Sort by volume24hr descending to get trending and top markets
    url.searchParams.set('order', 'volume24hr');
    url.searchParams.set('ascending', 'false');
    return fetchJson<RawPolymarketEvent[]>(url.toString());
  });

  const pages = await Promise.all(fetchPromises);
  const rawEvents = pages.flatMap((page) => Array.isArray(page) ? page : []);
  const normalizedEvents = rawEvents.map(normalizeEvent);

  const allMarkets: NormalizedMarket[] = [];
  const marketIdsSeen = new Set<string>();

  for (const ev of normalizedEvents) {
    if (!ev.markets) continue;
    for (const m of ev.markets) {
      // Deduplicate and filter out invalid/empty markets or single outcome tokens
      if (!marketIdsSeen.has(m.id) && m.tokenIds && m.tokenIds.length >= 2) {
        marketIdsSeen.add(m.id);
        allMarkets.push(m);
      }
    }
  }

  // Sort by volume24hr descending so the most popular markets are always first
  allMarkets.sort((a, b) => (b.volume24hr ?? 0) - (a.volume24hr ?? 0));

  return allMarkets.slice(offset, offset + limit);
}

/**
 * Fetch a single market by its Gamma API id.
 *
 * @param id - The market ID.
 * @returns A normalized market object.
 * @throws PolymarketApiError if the market is not found (404).
 */
export async function getMarket(id: string): Promise<NormalizedMarket> {
  const url = `${GAMMA_API_BASE}/markets/${encodeURIComponent(id)}`;
  const raw = await fetchJson<RawPolymarketMarket>(url);
  return normalizeMarket(raw);
}

// ---------------------------------------------------------------------------
// Gamma API — Events
// ---------------------------------------------------------------------------

/**
 * Fetch a list of active events.
 *
 * @param params - Optional query parameters.
 * @returns An array of normalized events (each containing their nested markets).
 */
export async function getEvents(
  params: FetchEventsParams = {},
): Promise<NormalizedEvent[]> {
  const {
    limit = 20,
    offset = 0,
    closed = false,
    order = 'volume24hr',
    ascending = false,
  } = params;

  const url = new URL('/events', GAMMA_API_BASE);
  url.searchParams.set('closed', String(closed));
  url.searchParams.set('order', order);
  url.searchParams.set('ascending', String(ascending));
  url.searchParams.set('limit', String(limit));
  url.searchParams.set('offset', String(offset));

  const raw = await fetchJson<RawPolymarketEvent[]>(url.toString());

  if (!Array.isArray(raw)) return [];
  return raw.map(normalizeEvent);
}

/**
 * Fetch a single event by its Gamma API id.
 *
 * @param id - The event ID.
 * @returns A normalized event with nested markets.
 */
export async function getEvent(id: string): Promise<NormalizedEvent> {
  const url = `${GAMMA_API_BASE}/events/${encodeURIComponent(id)}`;
  const raw = await fetchJson<RawPolymarketEvent>(url);
  return normalizeEvent(raw);
}

// ---------------------------------------------------------------------------
// CLOB API — Pricing
// ---------------------------------------------------------------------------

/**
 * Get the midpoint price for a token.
 *
 * @param tokenId - One of the two CLOB token IDs for a market.
 * @returns The midpoint as a number (e.g. 0.51).
 */
export async function getMidpoint(tokenId: string): Promise<number> {
  const url = `${CLOB_API_BASE}/midpoint?token_id=${encodeURIComponent(tokenId)}`;
  const raw = await fetchJson<RawMidpointResponse>(url);
  return Number(raw.mid) || 0;
}

/**
 * Get the spread for a token.
 *
 * @param tokenId - One of the two CLOB token IDs for a market.
 * @returns The spread as a number.
 */
export async function getSpread(tokenId: string): Promise<number> {
  const url = `${CLOB_API_BASE}/spread?token_id=${encodeURIComponent(tokenId)}`;
  const raw = await fetchJson<RawSpreadResponse>(url);
  return Number(raw.spread) || 0;
}

/**
 * Get the last trade price and side for a token.
 *
 * @param tokenId - One of the two CLOB token IDs for a market.
 * @returns An object with numeric price and string side ("BUY" | "SELL").
 */
export async function getLastTradePrice(
  tokenId: string,
): Promise<LastTradePrice> {
  const url = `${CLOB_API_BASE}/last-trade-price?token_id=${encodeURIComponent(tokenId)}`;
  const raw = await fetchJson<RawLastTradePriceResponse>(url);
  return {
    price: Number(raw.price) || 0,
    side: raw.side ?? 'UNKNOWN',
  };
}

// ---------------------------------------------------------------------------
// CLOB API — Order Book
// ---------------------------------------------------------------------------

/**
 * Fetch the full order book for a token.
 *
 * @param tokenId - One of the two CLOB token IDs for a market.
 * @returns A normalized order book with numeric prices/sizes.
 */
export async function getOrderBook(tokenId: string): Promise<OrderBook> {
  const url = `${CLOB_API_BASE}/book?token_id=${encodeURIComponent(tokenId)}`;
  const raw = await fetchJson<RawOrderBookResponse>(url);
  return normalizeOrderBook(raw);
}

// ---------------------------------------------------------------------------
// CLOB API — Price History
// ---------------------------------------------------------------------------

/**
 * Fetch historical price data for a market (by conditionId).
 * Note: The API may return an empty array for some markets.
 *
 * @param conditionId - The market's conditionId.
 * @param interval - Time interval, defaults to "max".
 * @param fidelity - Data point granularity in minutes, defaults to 60.
 * @returns An array of price points sorted by timestamp.
 */
export async function getPriceHistory(
  conditionId: string,
  interval = 'max',
  fidelity = 60,
): Promise<PricePoint[]> {
  const url = new URL('/prices-history', CLOB_API_BASE);
  url.searchParams.set('market', conditionId);
  url.searchParams.set('interval', interval);
  url.searchParams.set('fidelity', String(fidelity));

  const raw = await fetchJson<RawPriceHistoryPoint[]>(url.toString());

  if (!Array.isArray(raw)) return [];
  return raw.map((p) => ({
    timestamp: p.t,
    price: p.p,
  }));
}

// ---------------------------------------------------------------------------
// CLOB API — Fee Rate
// ---------------------------------------------------------------------------

/** Default fee rate in basis points if the API call fails. */
const DEFAULT_FEE_RATE_BPS = 200; // 2%

/** In-memory cache for fee rates (token → { rate, expiry }) */
const feeRateCache = new Map<string, { rate: number; expiry: number }>();

/**
 * Fetch the trading fee rate for a token from the CLOB API.
 *
 * Polymarket charges a maker/taker fee that varies. The CLOB API
 * exposes the current rate. We cache for 5 minutes to avoid
 * excessive API calls.
 *
 * @param tokenId - The CLOB token ID.
 * @returns Fee rate in basis points (e.g. 200 = 2%).
 */
export async function getFeeRate(tokenId: string): Promise<number> {
  // Check cache first
  const cached = feeRateCache.get(tokenId);
  if (cached && cached.expiry > Date.now()) {
    return cached.rate;
  }

  try {
    const url = `${CLOB_API_BASE}/fee-rate?token_id=${encodeURIComponent(tokenId)}`;
    const raw = await fetchJson<{ fee_rate: string }>(url);
    // The API returns a decimal string like "0.02" (= 200 bps)
    const rateDecimal = Number(raw.fee_rate);
    const rateBps = Math.round(rateDecimal * 10_000);
    const validRate = Number.isFinite(rateBps) && rateBps >= 0 ? rateBps : DEFAULT_FEE_RATE_BPS;

    // Cache for 5 minutes
    feeRateCache.set(tokenId, { rate: validRate, expiry: Date.now() + 5 * 60 * 1000 });
    return validRate;
  } catch {
    // API might not support this endpoint for all tokens — fall back gracefully
    return DEFAULT_FEE_RATE_BPS;
  }
}

