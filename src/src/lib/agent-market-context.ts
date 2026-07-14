export type AgentMarketContext = {
  market_id: string;
  ticker: string | null;
  market_slug: string | null;
  market_title: string | null;
  market_status: string | null;
  close_time: string | null;
  settlement_result: string | null;
  yes_price?: number | null;
  no_price?: number | null;
};

function text(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

export async function getAgentMarketContext(
  platform: 'kalshi' | 'polymarket' | 'polymarket_us',
  marketId: string,
): Promise<AgentMarketContext> {
  const fallback: AgentMarketContext = {
    market_id: marketId,
    ticker: platform === 'kalshi' ? marketId : null,
    market_slug: platform === 'kalshi' ? null : marketId,
    market_title: null,
    market_status: null,
    close_time: null,
    settlement_result: null,
    yes_price: null,
    no_price: null,
  };

  try {
    if (platform === 'kalshi') {
      const { getKalshiMarket, getKalshiOutcomePriceFromMarket } = await import('@/lib/kalshi');
      const market = await getKalshiMarket(marketId);
      if (!market) return fallback;
      return {
        ...fallback,
        market_title: text(market.title) ?? text(market.subtitle),
        market_status: text(market.status),
        close_time: text(market.close_time) ?? text(market.expected_expiration_time),
        settlement_result: text(market.result),
        yes_price: getKalshiOutcomePriceFromMarket(market, 'YES'),
        no_price: getKalshiOutcomePriceFromMarket(market, 'NO'),
      };
    }

    if (platform === 'polymarket_us') {
      const { getPolymarketUsMarket, getPolymarketUsOutcomePrice } = await import('@/lib/polymarket-us');
      const market = await getPolymarketUsMarket(marketId);
      if (!market) return fallback;
      return {
        ...fallback,
        market_id: String(market.id),
        market_slug: market.slug,
        market_title: market.title,
        market_status: market.closed ? 'closed' : market.active ? 'active' : 'inactive',
        settlement_result: market.closed ? market.outcome : null,
        yes_price: await getPolymarketUsOutcomePrice(market.slug, 'YES'),
        no_price: await getPolymarketUsOutcomePrice(market.slug, 'NO'),
      };
    }

    const { getMarket } = await import('@/lib/polymarket');
    const market = await getMarket(marketId);
    return {
      ...fallback,
      market_id: market.id,
      market_slug: market.slug,
      market_title: market.question,
      market_status: market.closed ? 'closed' : market.active ? 'active' : 'inactive',
      close_time: market.endDate,
      settlement_result: null,
      yes_price: market.outcomePrices?.[0] ?? null,
      no_price: market.outcomePrices?.[1] ?? null,
    };
  } catch {
    return fallback;
  }
}

export async function enrichOpenOrdersWithMarkets(
  platform: 'kalshi' | 'polymarket' | 'polymarket_us',
  orders: Record<string, unknown>[],
): Promise<Record<string, unknown>[]> {
  const cache = new Map<string, Promise<AgentMarketContext>>();
  return Promise.all(orders.map(async (order) => {
    const marketId = String(order.ticker ?? order.market_slug ?? order.market_id ?? '');
    if (!marketId) return order;
    if (!cache.has(marketId)) cache.set(marketId, getAgentMarketContext(platform, marketId));
    return { ...order, ...(await cache.get(marketId)!) };
  }));
}

export async function enrichPositionRowsWithMarkets(
  platform: 'kalshi' | 'polymarket' | 'polymarket_us',
  positions: unknown,
): Promise<unknown> {
  if (!Array.isArray(positions)) return positions;
  const cache = new Map<string, Promise<AgentMarketContext>>();
  return Promise.all(positions.map(async (position) => {
    if (!position || typeof position !== 'object') return position;
    const row = position as Record<string, unknown>;
    const marketId = String(row.ticker ?? row.marketId ?? row.market_id ?? row.slug ?? '');
    if (!marketId) return row;
    if (!cache.has(marketId)) cache.set(marketId, getAgentMarketContext(platform, marketId));
    const context = await cache.get(marketId)!;

    let extra = {};
    if (platform === 'kalshi') {
      const rawShares = Number(row.position_fp ?? 0);
      const shares = Math.abs(rawShares);
      const outcome = rawShares >= 0 ? 'YES' : 'NO';
      const totalTraded = Number(row.total_traded_dollars ?? 0);
      
      const avgPrice = outcome === 'YES' 
        ? (shares > 0 ? totalTraded / shares : 0)
        : (shares > 0 ? 1 - (totalTraded / shares) : 0);
        
      const currentPrice = outcome === 'YES' ? context.yes_price : context.no_price;
      
      const val = currentPrice != null 
        ? (shares * currentPrice) 
        : (outcome === 'YES' 
            ? Number(row.market_exposure_dollars ?? 0) 
            : shares - Number(row.market_exposure_dollars ?? 0));
            
      const cost = shares * avgPrice;
      const pnl = val - cost;

      extra = {
        outcome,
        shares,
        avgPrice,
        currentPrice,
        value: val,
        pnl,
        unrealizedPnL: pnl,
      };
    }

    return {
      ...row,
      ...extra,
      marketQuestion: context.market_title ?? row.marketQuestion ?? row.market_question ?? marketId,
      market_context: context,
    };
  }));
}

export async function enrichSettledRowsWithMarkets<T extends {
  platform: string;
  market_id: string;
  market: string;
}>(rows: T[]): Promise<T[]> {
  const kalshiTickers = [...new Set(rows
    .filter((row) => row.platform === 'kalshi')
    .map((row) => row.market_id)
    .filter(Boolean))];
  const kalshiMarkets = kalshiTickers.length > 0
    ? await import('@/lib/kalshi')
      .then(({ getKalshiMarkets }) => getKalshiMarkets(kalshiTickers))
      .catch(() => new Map<string, Record<string, unknown>>())
    : new Map<string, Record<string, unknown>>();
  const cache = new Map<string, Promise<AgentMarketContext>>();
  return Promise.all(rows.map(async (row) => {
    if (row.platform !== 'kalshi' && row.platform !== 'polymarket' && row.platform !== 'polymarket_us') return row;
    if (row.platform === 'kalshi') {
      const market = kalshiMarkets.get(row.market_id);
      return {
        ...row,
        market: text(market?.title) ?? text(market?.subtitle) ?? row.market,
      };
    }
    const key = `${row.platform}:${row.market_id}`;
    if (!cache.has(key)) {
      cache.set(key, getAgentMarketContext(row.platform, row.market_id));
    }
    const context = await cache.get(key)!;
    return {
      ...row,
      market: context.market_title ?? row.market,
    };
  }));
}
