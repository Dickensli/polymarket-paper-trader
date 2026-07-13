const KALSHI_BASE_URL = process.env.KALSHI_BASE_URL || 'https://external-api.kalshi.com/trade-api/v2';

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
  const url = new URL(`${KALSHI_BASE_URL.replace(/\/$/, '')}/markets`);
  url.searchParams.set('tickers', batch.join(','));
  url.searchParams.set('limit', String(batch.length));

  for (let attempt = 1; attempt <= KALSHI_MARKET_BATCH_ATTEMPTS; attempt += 1) {
    const res = await fetch(url, {
      headers: { Accept: 'application/json' },
      cache: 'no-store',
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
  const res = await fetch(`${KALSHI_BASE_URL.replace(/\/$/, '')}/markets/${encodeURIComponent(ticker)}`, {
    headers: { Accept: 'application/json' },
    cache: 'no-store',
  });
  if (!res.ok) {
    console.warn(`[Kalshi] Failed to fetch market ${ticker}: ${res.status} ${res.statusText}`);
    return null;
  }
  const json = (await res.json()) as KalshiMarketResponse;
  return json.market ?? (json as Record<string, unknown>);
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

export async function getKalshiOutcomePrice(ticker: string, outcome: 'YES' | 'NO', side: 'BUY' | 'SELL' = 'BUY'): Promise<number | null> {
  const market = await getKalshiMarket(ticker);
  if (!market) return null;

  // Handle settled/finalized markets
  if (market.status === 'finalized' || market.status === 'settled') {
    const result = String(market.result).toLowerCase();
    if (result === 'yes') return outcome === 'YES' ? 1 : 0;
    if (result === 'no') return outcome === 'NO' ? 1 : 0;
  }

  const prefix = outcome === 'YES' ? 'yes' : 'no';
  const preferred = side === 'BUY' ? `${prefix}_ask` : `${prefix}_bid`;
  const alternates = [
    preferred,
    `${preferred}_dollars`,
    `${prefix}_price`,
    `${prefix}_price_dollars`,
    `${prefix}_mid`,
    `${prefix}_mid_dollars`,
    `${prefix}_bid`,
    `${prefix}_bid_dollars`,
    `${prefix}_ask`,
    `${prefix}_ask_dollars`,
    outcome === 'YES' ? 'last_price' : undefined,
    outcome === 'YES' ? 'last_price_dollars' : undefined,
    'settlement_value_dollars',
    'settlement_value',
  ].filter(Boolean) as string[];

  for (const key of alternates) {
    const price = normalizePrice(market[key]);
    if (price !== null && price <= 1) return price;
  }
  return null;
}

export function kalshiTokenId(ticker: string, outcome: 'YES' | 'NO'): string {
  return `kalshi:${ticker}:${outcome}`;
}

export function parseKalshiTokenId(tokenId: string): { ticker: string; outcome: 'YES' | 'NO' } | null {
  const match = /^kalshi:(.+):(YES|NO)$/.exec(tokenId);
  if (!match) return null;
  return { ticker: match[1], outcome: match[2] as 'YES' | 'NO' };
}
