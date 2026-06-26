const KALSHI_BASE_URL = process.env.KALSHI_BASE_URL || 'https://external-api.kalshi.com/trade-api/v2';

type KalshiMarketResponse = {
  market?: Record<string, unknown>;
};

function normalizePrice(value: unknown): number | null {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return null;
  return numeric > 1 ? numeric / 100 : numeric;
}

export async function getKalshiMarket(ticker: string): Promise<Record<string, unknown> | null> {
  const res = await fetch(`${KALSHI_BASE_URL.replace(/\/$/, '')}/markets/${encodeURIComponent(ticker)}`, {
    headers: { Accept: 'application/json' },
    cache: 'no-store',
  });
  if (!res.ok) return null;
  const json = (await res.json()) as KalshiMarketResponse;
  return json.market ?? (json as Record<string, unknown>);
}

export async function getKalshiOutcomePrice(ticker: string, outcome: 'YES' | 'NO', side: 'BUY' | 'SELL' = 'BUY'): Promise<number | null> {
  const market = await getKalshiMarket(ticker);
  if (!market) return null;

  const prefix = outcome === 'YES' ? 'yes' : 'no';
  const preferred = side === 'BUY' ? `${prefix}_ask` : `${prefix}_bid`;
  const alternates = [
    preferred,
    `${prefix}_price`,
    `${prefix}_mid`,
    `${prefix}_bid`,
    `${prefix}_ask`,
    outcome === 'YES' ? 'last_price' : undefined,
  ].filter(Boolean) as string[];

  for (const key of alternates) {
    const price = normalizePrice(market[key]);
    if (price !== null && price < 1) return price;
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
