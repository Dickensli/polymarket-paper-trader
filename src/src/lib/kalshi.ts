import type { OrderBook, OrderBookLevel } from '@/lib/types';

/**
 * Resolve the public quote venue independently from the authenticated account
 * venue. KALSHI_USE_DEMO belongs to official execution only; paper/shadow
 * strategies normally consume production liquidity.
 */
export function resolveKalshiMarketDataBaseUrl(
  env: Record<string, string | undefined> = process.env,
): string {
  const explicit = env.KALSHI_MARKET_DATA_BASE_URL || env.KALSHI_BASE_URL;
  if (explicit) return explicit.replace(/\/$/, '');
  return env.KALSHI_MARKET_DATA_ENV?.toLowerCase() === 'demo'
    ? 'https://demo-api.kalshi.co/trade-api/v2'
    : 'https://external-api.kalshi.com/trade-api/v2';
}

/** @deprecated Prefer resolveKalshiMarketDataBaseUrl. */
export const resolveKalshiBaseUrl = resolveKalshiMarketDataBaseUrl;

const KALSHI_MARKET_DATA_BASE_URL = resolveKalshiMarketDataBaseUrl();

type KalshiMarketResponse = {
  market?: Record<string, unknown>;
};

type KalshiMarketsResponse = {
  markets?: Record<string, unknown>[];
};

const KALSHI_MARKET_BATCH_SIZE = 100;
const KALSHI_MARKET_CACHE_TTL_MS = 5 * 60 * 1000;
const KALSHI_MARKET_BATCH_ATTEMPTS = 3;
const marketCache = new Map<string, {
  market: Record<string, unknown>;
  expiresAt: number;
}>();

function marketTicker(market: Record<string, unknown>): string | null {
  return typeof market.ticker === 'string' && market.ticker.length > 0
    ? market.ticker
    : null;
}

function chunks<T>(values: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size));
  }
  return result;
}

function retryDelayMs(response: Response, attempt: number): number {
  const retryAfter = Number(response.headers?.get('retry-after'));
  if (Number.isFinite(retryAfter) && retryAfter >= 0) return Math.min(retryAfter * 1000, 2000);
  return 100 * attempt;
}

async function fetchKalshiMarketBatch(batch: string[]): Promise<Record<string, unknown>[]> {
  const url = new URL(`${KALSHI_MARKET_DATA_BASE_URL}/markets`);
  url.searchParams.set('tickers', batch.join(','));
  url.searchParams.set('limit', String(batch.length));

  for (let attempt = 1; attempt <= KALSHI_MARKET_BATCH_ATTEMPTS; attempt += 1) {
    const res = await fetch(url, {
      headers: { Accept: 'application/json' },
      cache: 'no-store',
      signal: AbortSignal.timeout(5000),
    });
    if (res.ok) {
      const json = (await res.json()) as KalshiMarketsResponse;
      return json.markets ?? [];
    }
    const retryable = res.status === 429 || res.status >= 500;
    if (!retryable || attempt === KALSHI_MARKET_BATCH_ATTEMPTS) {
      console.warn(`[Kalshi] Failed to batch fetch ${batch.length} markets: ${res.status} ${res.statusText}`);
      return [];
    }
    await new Promise((resolve) => setTimeout(resolve, retryDelayMs(res, attempt)));
  }

  return [];
}

function normalizePrice(value: unknown): number | null {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 0) return null;
  return numeric > 1 ? numeric / 100 : numeric;
}

export async function getKalshiMarket(ticker: string): Promise<Record<string, unknown> | null> {
  try {
    const res = await fetch(`${KALSHI_MARKET_DATA_BASE_URL}/markets/${encodeURIComponent(ticker)}`, {
      headers: { Accept: 'application/json' },
      cache: 'no-store',
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) {
      console.warn(`[Kalshi] Failed to fetch market ${ticker}: ${res.status} ${res.statusText}`);
      return null;
    }
    const json = (await res.json()) as KalshiMarketResponse;
    return json.market ?? (json as Record<string, unknown>);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`[Kalshi] Market fetch failed for ${ticker}: ${message}`);
    return null;
  }
}

type KalshiOrderBookResponse = {
  orderbook_fp?: {
    yes_dollars?: unknown;
    no_dollars?: unknown;
  };
  orderbook?: {
    yes?: unknown;
    no?: unknown;
  };
};

function normalizeOrderBookLevels(value: unknown): OrderBookLevel[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((level) => {
    if (!Array.isArray(level) || level.length < 2) return [];
    const rawPrice = Number(level[0]);
    const rawSize = Number(level[1]);
    const price = rawPrice > 1 ? rawPrice / 100 : rawPrice;
    if (!Number.isFinite(price) || !Number.isFinite(rawSize) || price <= 0 || price >= 1 || rawSize <= 0) {
      return [];
    }
    return [{ price, size: rawSize }];
  });
}

export function normalizeKalshiOrderBook(
  ticker: string,
  outcome: 'YES' | 'NO',
  response: KalshiOrderBookResponse,
): OrderBook {
  const yesBids = normalizeOrderBookLevels(
    response.orderbook_fp?.yes_dollars ?? response.orderbook?.yes,
  );
  const noBids = normalizeOrderBookLevels(
    response.orderbook_fp?.no_dollars ?? response.orderbook?.no,
  );
  const outcomeBids = outcome === 'YES' ? yesBids : noBids;
  const oppositeBids = outcome === 'YES' ? noBids : yesBids;

  return {
    market: ticker,
    assetId: kalshiTokenId(ticker, outcome),
    timestamp: new Date().toISOString(),
    bids: outcomeBids.sort((a, b) => b.price - a.price),
    asks: oppositeBids
      .map((level) => ({ price: Number((1 - level.price).toFixed(6)), size: level.size }))
      .sort((a, b) => a.price - b.price),
  };
}

export async function getKalshiOrderBook(
  ticker: string,
  outcome: 'YES' | 'NO',
): Promise<OrderBook | null> {
  const res = await fetch(
    `${KALSHI_MARKET_DATA_BASE_URL}/markets/${encodeURIComponent(ticker)}/orderbook?depth=0`,
    { headers: { Accept: 'application/json' }, cache: 'no-store' },
  );
  if (!res.ok) {
    console.warn(`[Kalshi] Failed to fetch orderbook ${ticker}: ${res.status} ${res.statusText}`);
    return null;
  }
  return normalizeKalshiOrderBook(ticker, outcome, await res.json() as KalshiOrderBookResponse);
}

/**
 * Resolve many Kalshi tickers without issuing one request per market. Kalshi's
 * list endpoint accepts a comma-separated `tickers` filter, which avoids the
 * burst of 429 responses caused by dashboard-wide Promise.all enrichment.
 */
export async function getKalshiMarkets(
  tickers: string[],
): Promise<Map<string, Record<string, unknown>>> {
  const uniqueTickers = [...new Set(tickers.filter(Boolean))];
  const result = new Map<string, Record<string, unknown>>();
  const now = Date.now();
  const missing: string[] = [];

  for (const ticker of uniqueTickers) {
    const cached = marketCache.get(ticker);
    if (cached && cached.expiresAt > now) {
      result.set(ticker, cached.market);
    } else {
      marketCache.delete(ticker);
      missing.push(ticker);
    }
  }

  for (const batch of chunks(missing, KALSHI_MARKET_BATCH_SIZE)) {
    for (const market of await fetchKalshiMarketBatch(batch)) {
      const ticker = marketTicker(market);
      if (!ticker) continue;
      result.set(ticker, market);
      marketCache.set(ticker, {
        market,
        expiresAt: now + KALSHI_MARKET_CACHE_TTL_MS,
      });
    }
  }

  return result;
}

export function getKalshiOutcomePriceFromMarket(
  market: Record<string, unknown>,
  outcome: 'YES' | 'NO',
  side: 'BUY' | 'SELL' = 'BUY',
): number | null {
  const status = String(market.status ?? '').toLowerCase();
  // Handle settled/finalized markets
  if (status === 'finalized' || status === 'settled') {
    const result = String(market.result).toLowerCase();
    if (result === 'yes') return outcome === 'YES' ? 1 : 0;
    if (result === 'no') return outcome === 'NO' ? 1 : 0;
  }

  // A closed market can spend time waiting for the venue's authoritative
  // result. Its empty book often exposes a synthetic zero bid, which is not
  // an executable liquidation price and must not erase paper NAV.
  if (status === 'closed') return null;

  const prefix = outcome === 'YES' ? 'yes' : 'no';
  const preferred = side === 'BUY' ? `${prefix}_ask` : `${prefix}_bid`;
  // Execution quotes must come from the requested side of the book. Falling
  // back from an absent bid to the ask (or vice versa) invents liquidity.
  const alternates = [preferred, `${preferred}_dollars`];

  for (const key of alternates) {
    const price = normalizePrice(market[key]);
    if (price !== null && price <= 1) return price;
  }
  return null;
}

export async function getKalshiOutcomePrice(ticker: string, outcome: 'YES' | 'NO', side: 'BUY' | 'SELL' = 'BUY'): Promise<number | null> {
  const market = await getKalshiMarket(ticker);
  return market ? getKalshiOutcomePriceFromMarket(market, outcome, side) : null;
}

export function kalshiTokenId(ticker: string, outcome: 'YES' | 'NO'): string {
  return `kalshi:${ticker}:${outcome}`;
}

export function parseKalshiTokenId(tokenId: string): { ticker: string; outcome: 'YES' | 'NO' } | null {
  const match = /^kalshi:(.+):(YES|NO)$/.exec(tokenId);
  if (!match) return null;
  return { ticker: match[1], outcome: match[2] as 'YES' | 'NO' };
}
