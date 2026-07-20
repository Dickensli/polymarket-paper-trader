import { randomUUID, constants, sign as cryptoSign } from 'crypto';
import { readFileSync } from 'fs';
import { getPolymarketUsClient, getPolymarketUsOutcomeOrderBook } from '@/lib/polymarket-us';
import { simulateSellFill } from '@/lib/orderbook-simulator';

type Platform = 'kalshi' | 'polymarket_us';
type Outcome = 'YES' | 'NO';
type Side = 'BUY' | 'SELL';
type TimeInForce = 'GTC' | 'IOC' | 'FOK';
export type OfficialSyncWindow = { ordersMinTs?: number; fillsMinTs?: number; settlementsMinTs?: number };

export type OfficialTradeIntent = {
  platform: Platform;
  slug: string;
  outcome: Outcome;
  side: Side;
  amount?: number;
  shares?: number;
  price?: number;
  clientOrderId?: string;
  timeInForce?: TimeInForce;
};

export type OfficialTradeResult = {
  officialOrderId: string | null;
  clientOrderId: string;
  status: string;
  request: Record<string, unknown>;
  response: Record<string, unknown>;
};

export type OfficialCancelResult = {
  officialOrderId: string;
  status: string;
  response: Record<string, unknown>;
};

export type OfficialPortfolioSnapshot = {
  cash: number;
  positionsValue: number;
  totalValue: number;
  pnl: number;
  unpricedPositionsCount?: number;
  positions: unknown[];
  orders: unknown[];
  fills: unknown[];
  settlements?: unknown[];
  activity: unknown[];
  raw: Record<string, unknown>;
};

export function validateOfficialPortfolioSnapshot(
  platform: Platform,
  raw: Record<string, unknown>,
): void {
  const criticalKeys = platform === 'kalshi'
    ? ['balance', 'positions', 'orders', 'fills', 'settlements']
    : ['balances', 'positions', 'orders', 'activity'];
  for (const key of criticalKeys) {
    const value = raw[key];
    if (value && typeof value === 'object' && 'error' in value) {
      const message = String((value as Record<string, unknown>).error);
      const label = platform === 'kalshi' ? 'Kalshi' : 'Polymarket US';
      throw new Error(`${label} official portfolio sync failed: ${key}: ${message}`);
    }
  }
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function fixed(value: number, decimals = 4): string {
  return value.toFixed(decimals);
}

function objectAmount(value: unknown): number {
  if (value && typeof value === 'object' && 'value' in value) {
    const parsed = Number((value as { value: unknown }).value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function resolvePolymarketUsPosition(position: Record<string, unknown>): {
  slug: string;
  outcome: Outcome;
  shares: number;
  riskGroupId: string;
} {
  const metadata = position.marketMetadata && typeof position.marketMetadata === 'object'
    ? position.marketMetadata as Record<string, unknown>
    : {};
  const netPosition = Number(position.netPosition);
  const rawShares = Number(position.qtyAvailable ?? Math.abs(netPosition));
  const rawOutcome = String(position.outcome ?? position.outcomeSide ?? metadata.outcome ?? (netPosition < 0 ? 'NO' : 'YES')).toUpperCase();
  const slug = String(position.marketSlug ?? position.market_slug ?? position.slug ?? metadata.slug ?? '');
  return {
    slug,
    outcome: rawOutcome === 'NO' ? 'NO' : 'YES',
    shares: Number.isFinite(rawShares) ? Math.abs(rawShares) : 0,
    riskGroupId: String(position.eventSlug ?? position.event_slug ?? metadata.eventSlug ?? slug),
  };
}

function clampPrice(price: number): number {
  if (!Number.isFinite(price) || price <= 0 || price >= 1) {
    throw new Error('Real order price must be between 0 and 1.');
  }
  return price;
}

function resolveQuantity(intent: OfficialTradeIntent): number {
  if (intent.shares) return intent.shares;
  if (intent.amount && intent.price) return intent.amount / intent.price;
  throw new Error('Real order requires shares, or amount plus price.');
}

export function resolveOfficialOrderQuantity(intent: Pick<OfficialTradeIntent, 'shares' | 'amount' | 'price'>): number {
  return resolveQuantity(intent as OfficialTradeIntent);
}

export function normalizeKalshiOrderStatus(order: Record<string, unknown>): string {
  const fillCount = Number(order.fill_count_fp ?? order.fill_count ?? 0);
  const remainingCount = Number(order.remaining_count_fp ?? order.remaining_count ?? 0);
  const initialCount = Number(order.initial_count_fp ?? order.initial_count ?? order.count ?? 0);
  const officialStatus = typeof order.status === 'string' ? order.status.toUpperCase() : '';

  // Counts are more useful than the lifecycle label for audit reporting. In
  // particular, Kalshi can report an order as "executed" when its lifecycle is
  // over even though no contracts filled.
  if (remainingCount > 0 && fillCount > 0) return 'PARTIALLY_FILLED';
  if (remainingCount > 0) return officialStatus === 'RESTING' ? 'RESTING' : 'OPEN';
  if (
    fillCount > 0 && initialCount > fillCount
    && (officialStatus === 'CANCELED' || officialStatus === 'CANCELLED')
  ) return 'PARTIALLY_FILLED_CANCELED';
  if (fillCount > 0) return 'EXECUTED';
  if (officialStatus === 'CANCELED' || officialStatus === 'CANCELLED' || officialStatus === 'EXECUTED') {
    return 'CANCELED';
  }
  return officialStatus || 'SUBMITTED';
}

export function summarizeKalshiPositions(
  positionRows: Record<string, unknown>[],
  marketByTicker: Map<string, Record<string, unknown>> = new Map(),
): { positionsValue: number; pnl: number; unpricedTickers: string[] } {
  let positionsValue = 0;
  let pnl = 0;
  const unpricedTickers: string[] = [];
  for (const position of positionRows) {
    const ticker = String(position.ticker ?? position.market_ticker ?? '');
    const market = marketByTicker.get(ticker);
    const positionFp = Number(position.position_fp ?? position.position ?? 0) / (position.position_fp != null ? 1 : 100);
    const explicitMarketValue = position.market_value_dollars != null
      ? Number(position.market_value_dollars)
      : position.market_value != null
        ? Number(position.market_value) / 100
        : null;
    const quoteField = positionFp >= 0
      ? market?.yes_bid_dollars ?? market?.yes_bid
      : market?.no_bid_dollars ?? market?.no_bid;
    const rawBid = Number(quoteField);
    const bid = quoteField == null || !Number.isFinite(rawBid)
      ? null
      : rawBid > 1 ? rawBid / 100 : rawBid;
    const hasExecutableMark = explicitMarketValue != null && Number.isFinite(explicitMarketValue)
      || bid != null && bid > 0 && bid < 1;
    const marketValue = explicitMarketValue != null && Number.isFinite(explicitMarketValue)
      ? explicitMarketValue
      : bid != null && bid > 0 && bid < 1
        ? Math.abs(positionFp) * bid
        : 0;
    if (!hasExecutableMark && ticker) unpricedTickers.push(ticker);
    const hasDollarPnl = position.realized_pnl_dollars != null;
    const realizedPnl = Number(position.realized_pnl_dollars ?? position.realized_pnl ?? 0) / (hasDollarPnl ? 1 : 100);
    const hasDollarCost = position.position_cost_dollars != null;
    const positionCost = Number(
      position.position_cost_dollars
      ?? position.market_exposure_dollars
      ?? position.position_cost
      ?? 0,
    ) / (hasDollarCost || position.market_exposure_dollars != null ? 1 : 100);

    if (Number.isFinite(marketValue)) positionsValue += marketValue;
    if (Number.isFinite(realizedPnl)) pnl += realizedPnl;
    if (Number.isFinite(positionCost)) pnl += marketValue - positionCost;
  }
  return { positionsValue, pnl, unpricedTickers };
}

export function kalshiOrderQuantity(order: Record<string, unknown>): number | null {
  const quantity = Number(order.initial_count_fp ?? order.initial_count ?? order.count);
  return Number.isFinite(quantity) && quantity > 0 ? quantity : null;
}

function yesSidePrice(outcome: Outcome, price: number): number {
  return outcome === 'YES' ? price : 1 - price;
}

function quantizeKalshiOutcomePrice(price: number, side: Side): number {
  const scaled = price * 100;
  const cents = side === 'BUY'
    ? Math.ceil(scaled - Number.EPSILON * 100)
    : Math.floor(scaled + Number.EPSILON * 100);
  const quantized = cents / 100;
  if (quantized <= 0 || quantized >= 1) {
    throw new Error('Kalshi real order price must resolve to a valid cent tick between 0 and 1.');
  }
  return quantized;
}

function kalshiBookSide(outcome: Outcome, side: Side): 'bid' | 'ask' {
  if (outcome === 'YES') return side === 'BUY' ? 'bid' : 'ask';
  return side === 'BUY' ? 'ask' : 'bid';
}

function kalshiTimeInForce(tif: TimeInForce | undefined): string {
  if (tif === 'GTC') return 'good_till_canceled';
  if (tif === 'FOK') return 'fill_or_kill';
  return 'immediate_or_cancel';
}

function formatKalshiCount(quantity: number): string {
  if (!Number.isFinite(quantity)) {
    throw new Error('Real order quantity must be finite.');
  }
  const fixedPointQuantity = Math.floor(quantity * 100) / 100;
  if (fixedPointQuantity < 0.01) {
    throw new Error('Kalshi real order quantity must be at least 0.01 contracts.');
  }
  return fixedPointQuantity.toFixed(2);
}

function polymarketUsTif(tif: TimeInForce | undefined): string {
  if (tif === 'GTC') return 'TIME_IN_FORCE_GOOD_TILL_CANCEL';
  if (tif === 'FOK') return 'TIME_IN_FORCE_FILL_OR_KILL';
  return 'TIME_IN_FORCE_IMMEDIATE_OR_CANCEL';
}

function polymarketUsIntent(outcome: Outcome, side: Side): string {
  if (outcome === 'YES') {
    return side === 'BUY' ? 'ORDER_INTENT_BUY_LONG' : 'ORDER_INTENT_SELL_LONG';
  }
  return side === 'BUY' ? 'ORDER_INTENT_BUY_SHORT' : 'ORDER_INTENT_SELL_SHORT';
}

function loadKalshiPrivateKey(): string {
  const useDemo = process.env.KALSHI_USE_DEMO === 'true';
  const pem = useDemo ? process.env.KALSHI_DEMO_PRIVATE_KEY_PEM : process.env.KALSHI_PRIVATE_KEY_PEM;
  if (pem) {
    return pem.replace(/\\n/g, '\n');
  }
  const pathVar = useDemo ? 'KALSHI_DEMO_PRIVATE_KEY_PATH' : 'KALSHI_PRIVATE_KEY_PATH';
  return readFileSync(requireEnv(pathVar), 'utf8');
}

export function resolveKalshiExecutionBaseUrl(
  env: Record<string, string | undefined> = process.env,
): string {
  const explicit = env.KALSHI_EXECUTION_BASE_URL || env.KALSHI_BASE_URL;
  if (explicit) {
    return explicit.replace(/\/$/, '');
  }
  const useDemo = env.KALSHI_USE_DEMO === 'true';
  return useDemo ? 'https://demo-api.kalshi.co/trade-api/v2' : 'https://external-api.kalshi.com/trade-api/v2';
}

function kalshiBaseUrl(): string {
  return resolveKalshiExecutionBaseUrl();
}

function kalshiSign(method: string, path: string): Record<string, string> {
  const timestamp = Date.now().toString();
  const cleanPath = path.split('?')[0];
  const signedPath = cleanPath.startsWith('/trade-api/v2') ? cleanPath : `/trade-api/v2${cleanPath}`;
  
  const message = Buffer.from(`${timestamp}${method.toUpperCase()}${signedPath}`, 'utf8');
  const signature = cryptoSign('sha256', message, {
    key: loadKalshiPrivateKey(),
    padding: constants.RSA_PKCS1_PSS_PADDING,
    saltLength: constants.RSA_PSS_SALTLEN_DIGEST,
  }).toString('base64');

  const useDemo = process.env.KALSHI_USE_DEMO === 'true';
  const apiKeyId = useDemo ? requireEnv('KALSHI_DEMO_API_KEY_ID') : requireEnv('KALSHI_API_KEY_ID');

  return {
    'KALSHI-ACCESS-KEY': apiKeyId,
    'KALSHI-ACCESS-TIMESTAMP': timestamp,
    'KALSHI-ACCESS-SIGNATURE': signature,
  };
}

async function kalshiRequest<T>(
  method: string,
  path: string,
  body?: Record<string, unknown>,
): Promise<T> {
  const response = await fetch(`${kalshiBaseUrl()}${path}`, {
    method,
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      ...kalshiSign(method, path),
    },
    body: body ? JSON.stringify(body) : undefined,
    cache: 'no-store',
  });

  const json = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`Kalshi API ${response.status}: ${JSON.stringify(json)}`);
  }
  return json as T;
}

export async function collectKalshiCursorPages<T>(
  fetchPage: (cursor?: string) => Promise<{ rows: T[]; cursor?: string }>,
): Promise<T[]> {
  const rows: T[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < 50; page += 1) {
    const response = await fetchPage(cursor);
    rows.push(...response.rows);
    if (!response.cursor) return rows;
    cursor = response.cursor;
  }
  throw new Error('Kalshi pagination exceeded 50 pages');
}

async function getKalshiCollection(path: string, key: string, query: Record<string, string> = {}): Promise<Record<string, unknown>> {
  const rows = await collectKalshiCursorPages<Record<string, unknown>>(async (cursor) => {
    const params = new URLSearchParams({ limit: '1000', ...query });
    if (cursor) params.set('cursor', cursor);
    const response = await kalshiRequest<Record<string, unknown>>('GET', `${path}?${params}`);
    return {
      rows: Array.isArray(response[key]) ? response[key] as Record<string, unknown>[] : [],
      cursor: typeof response.cursor === 'string' ? response.cursor : undefined,
    };
  });
  return { [key]: rows };
}

export async function getOfficialKalshiHistoricalFills(): Promise<Record<string, unknown>[]> {
  const response = await getKalshiCollection('/historical/fills', 'fills');
  return response.fills as Record<string, unknown>[];
}

async function submitKalshiTrade(intent: OfficialTradeIntent): Promise<OfficialTradeResult> {
  const { request, clientOrderId } = buildKalshiOrderRequest(intent);

  const response = await kalshiRequest<Record<string, unknown>>('POST', '/portfolio/events/orders', request);
  const officialOrderId =
    typeof response.order_id === 'string'
      ? response.order_id
      : typeof (response.order as Record<string, unknown> | undefined)?.order_id === 'string'
        ? String((response.order as Record<string, unknown>).order_id)
        : null;

  return {
    officialOrderId,
    clientOrderId,
    status: normalizeKalshiOrderStatus(response),
    request,
    response,
  };
}

export function buildKalshiOrderRequest(intent: OfficialTradeIntent): {
  clientOrderId: string;
  request: Record<string, unknown>;
} {
  const outcomePrice = quantizeKalshiOutcomePrice(
    clampPrice(intent.price ?? NaN),
    intent.side,
  );
  const price = yesSidePrice(intent.outcome, outcomePrice);
  const quantity = resolveQuantity(intent);
  const clientOrderId = intent.clientOrderId ?? randomUUID();

  const request = {
    ticker: intent.slug,
    client_order_id: clientOrderId,
    side: kalshiBookSide(intent.outcome, intent.side),
    count: formatKalshiCount(quantity),
    price: price.toFixed(2),
    time_in_force: kalshiTimeInForce(intent.timeInForce),
    self_trade_prevention_type: 'taker_at_cross',
    post_only: false,
    cancel_order_on_pause: false,
    reduce_only: intent.side === 'SELL' && (intent.timeInForce === 'IOC' || intent.timeInForce === 'FOK'),
  };

  return {
    clientOrderId,
    request,
  };
}

async function cancelKalshiOrder(orderId: string): Promise<OfficialCancelResult> {
  const response = await kalshiRequest<Record<string, unknown>>(
    'DELETE',
    `/portfolio/events/orders/${encodeURIComponent(orderId)}`,
  );
  return {
    officialOrderId: orderId,
    status: 'CANCELLED',
    response,
  };
}

async function getKalshiSnapshot(window: OfficialSyncWindow = {}): Promise<OfficialPortfolioSnapshot> {
  const [balance, positions, orders, fills, settlements] = await Promise.all([
    kalshiRequest<Record<string, unknown>>('GET', '/portfolio/balance').catch((error) => ({ error: String(error) })),
    kalshiRequest<Record<string, unknown>>('GET', '/portfolio/positions').catch((error) => ({ error: String(error) })),
    getKalshiCollection('/portfolio/orders', 'orders', window.ordersMinTs ? { min_ts: String(window.ordersMinTs) } : {}).catch((error) => ({ error: String(error) })),
    getKalshiCollection('/portfolio/fills', 'fills', window.fillsMinTs ? { min_ts: String(window.fillsMinTs) } : {}).catch((error) => ({ error: String(error) })),
    getKalshiCollection('/portfolio/settlements', 'settlements', window.settlementsMinTs ? { min_ts: String(window.settlementsMinTs) } : {}).catch((error) => ({ error: String(error) })),
  ]);
  const balanceRecord = balance as Record<string, unknown>;
  const positionsRecord = positions as Record<string, unknown>;
  const ordersRecord = orders as Record<string, unknown>;
  const fillsRecord = fills as Record<string, unknown>;
  const settlementsRecord = settlements as Record<string, unknown>;

  validateOfficialPortfolioSnapshot('kalshi', {
    balance: balanceRecord,
    positions: positionsRecord,
    orders: ordersRecord,
    fills: fillsRecord,
    settlements: settlementsRecord,
  });

  const cash =
    Number(balanceRecord.balance_dollars) ||
    (balanceRecord.balance ? Number(balanceRecord.balance) / 100 : 0) ||
    Number(balanceRecord.available_balance) ||
    0;
  const positionRows = Array.isArray(positionsRecord.market_positions) ? positionsRecord.market_positions : 
                       (Array.isArray(positionsRecord.positions) ? positionsRecord.positions : []);
  const orderRows = Array.isArray(ordersRecord.orders) ? ordersRecord.orders : [];
  const fillRows = Array.isArray(fillsRecord.fills) ? fillsRecord.fills : [];
  const settlementRows = Array.isArray(settlementsRecord.settlements) ? settlementsRecord.settlements : [];

  const executionMarkets = new Map<string, Record<string, unknown>>();
  await Promise.all(positionRows.map(async (position) => {
    const ticker = String((position as Record<string, unknown>).ticker ?? '');
    if (!ticker || executionMarkets.has(ticker)) return;
    const response = await kalshiRequest<Record<string, unknown>>(
      'GET',
      `/markets/${encodeURIComponent(ticker)}`,
    ).catch(() => null);
    if (!response) return;
    const market = response.market && typeof response.market === 'object'
      ? response.market as Record<string, unknown>
      : response;
    executionMarkets.set(ticker, market);
  }));
  const { positionsValue, pnl, unpricedTickers } = summarizeKalshiPositions(positionRows, executionMarkets);
  const totalValue = cash + positionsValue;
  const unpricedTickerSet = new Set(unpricedTickers);
  const positionsWithPricingQuality = positionRows.map((position) => {
    const row = position as Record<string, unknown>;
    const ticker = String(row.ticker ?? row.market_ticker ?? '');
    const market = executionMarkets.get(ticker);
    return {
      ...row,
      risk_group_id: market?.event_ticker ?? market?.eventTicker ?? ticker,
      pricing_status: unpricedTickerSet.has(ticker) ? 'unpriced' : 'priced',
    };
  });

  return {
    cash,
    positionsValue,
    totalValue,
    pnl,
    unpricedPositionsCount: unpricedTickers.length,
    positions: positionsWithPricingQuality,
    orders: orderRows,
    fills: fillRows,
    settlements: settlementRows,
    activity: [],
    raw: {
      balance: balanceRecord,
      positions: positionsRecord,
      orders: ordersRecord,
      fills: fillsRecord,
      settlements: settlementsRecord,
      valuation: {
        source: 'execution_venue_liquidation_bid',
        unpriced_tickers: unpricedTickers,
      },
    },
  };
}

async function submitPolymarketUsTrade(intent: OfficialTradeIntent): Promise<OfficialTradeResult> {
  const { request, clientOrderId } = buildPolymarketUsOrderRequest(intent);
  const client = getPolymarketUsClient() as unknown as {
    orders: {
      create(params: Record<string, unknown>): Promise<Record<string, unknown>>;
    };
  };
  const response = await client.orders.create(request);
  const officialOrderId =
    typeof response.id === 'string'
      ? response.id
      : typeof response.orderId === 'string'
        ? response.orderId
        : null;
  const executions = Array.isArray(response.executions)
    ? response.executions as Array<Record<string, unknown>>
    : [];
  const latestOrder = executions.at(-1)?.order;
  const status = latestOrder && typeof latestOrder === 'object'
    ? String((latestOrder as Record<string, unknown>).state ?? 'SUBMITTED')
    : String(response.state ?? response.status ?? 'SUBMITTED');

  return {
    officialOrderId,
    clientOrderId,
    status,
    request,
    response,
  };
}

export function buildPolymarketUsOrderRequest(intent: OfficialTradeIntent): {
  clientOrderId: string;
  request: Record<string, unknown>;
} {
  const price = yesSidePrice(intent.outcome, clampPrice(intent.price ?? NaN));
  const quantity = resolveQuantity(intent);
  const clientOrderId = intent.clientOrderId ?? randomUUID();
  const request = {
    marketSlug: intent.slug,
    intent: polymarketUsIntent(intent.outcome, intent.side),
    type: 'ORDER_TYPE_LIMIT',
    price: { value: fixed(price, 4), currency: 'USD' },
    quantity,
    tif: polymarketUsTif(intent.timeInForce),
  };

  return {
    clientOrderId,
    request,
  };
}

async function cancelPolymarketUsOrder(orderId: string, marketSlug?: string): Promise<OfficialCancelResult> {
  const client = getPolymarketUsClient() as unknown as {
    orders: {
      cancel(orderId: string, params?: Record<string, unknown>): Promise<Record<string, unknown>>;
    };
  };
  const response = await client.orders.cancel(orderId, marketSlug ? { marketSlug } : undefined);
  return {
    officialOrderId: orderId,
    status: 'CANCELLED',
    response: response ?? {},
  };
}

async function getPolymarketUsSnapshot(): Promise<OfficialPortfolioSnapshot> {
  const client = getPolymarketUsClient() as unknown as {
    account: { balances(): Promise<Record<string, unknown>> };
    portfolio: {
      positions(params?: { limit?: number }): Promise<Record<string, unknown>>;
      activities(params?: { limit?: number }): Promise<Record<string, unknown>>;
    };
    orders?: {
      list?(): Promise<Record<string, unknown>>;
    };
  };
  const [balances, positions, orders, activity] = await Promise.all([
    client.account.balances().catch((error) => ({ error: String(error) })),
    client.portfolio.positions({ limit: 1000 }).catch((error) => ({ error: String(error) })),
    client.orders?.list?.().catch((error) => ({ error: String(error) })) ?? Promise.resolve({}),
    client.portfolio.activities({ limit: 1000 }).catch((error) => ({ error: String(error) })),
  ]);
  const balancesRecord = balances as Record<string, unknown>;
  const positionsRecord = positions as Record<string, unknown>;
  const ordersRecord = orders as Record<string, unknown>;
  const activityRecord = activity as Record<string, unknown>;

  validateOfficialPortfolioSnapshot('polymarket_us', {
    balances: balancesRecord,
    positions: positionsRecord,
    orders: ordersRecord,
    activity: activityRecord,
  });

  const balanceRows = Array.isArray(balancesRecord.balances) ? balancesRecord.balances as Array<Record<string, unknown>> : [];
  const usdBalance = balanceRows.find((row) => String(row.currency ?? '').toUpperCase() === 'USD') ?? balanceRows[0] ?? {};
  const cash = Number(usdBalance.currentBalance ?? usdBalance.buyingPower ?? 0);
  const positionMap = positionsRecord.positions && typeof positionsRecord.positions === 'object' ? positionsRecord.positions as Record<string, unknown> : {};
  const positionRows = Object.values(positionMap);
  const orderRows = Array.isArray(ordersRecord.orders) ? ordersRecord.orders : [];
  const activityRows = Array.isArray(activityRecord.activities) ? activityRecord.activities : [];
  const fillRows = activityRows.filter((row) => row && typeof row === 'object' && String((row as Record<string, unknown>).type) === 'ACTIVITY_TYPE_TRADE');
  const positionsWithPricingQuality = await Promise.all(positionRows.map(async (row) => {
    const record = row as Record<string, unknown>;
    const resolved = resolvePolymarketUsPosition(record);
    const book = resolved.slug && resolved.shares > 0
      ? await getPolymarketUsOutcomeOrderBook(resolved.slug, resolved.outcome).catch(() => null)
      : null;
    const fill = book ? simulateSellFill(book, resolved.shares, 0, 'FOK') : null;
    const liquidationValue = fill?.success ? fill.totalAfterFee : 0;
    return {
      ...record,
      market_slug: resolved.slug,
      outcome: resolved.outcome,
      shares: resolved.shares,
      risk_group_id: resolved.riskGroupId,
      liquidation_value: liquidationValue,
      pricing_status: fill?.success ? 'priced' : 'unpriced',
    };
  }));
  const positionsValue = positionsWithPricingQuality.reduce(
    (sum, row) => sum + Number(row.liquidation_value || 0),
    0,
  );
  const pnl = positionsWithPricingQuality.reduce((sum, row) => {
    const record = row as Record<string, unknown>;
    const realized = objectAmount(record.realized);
    const cost = Math.abs(objectAmount(record.cost));
    return sum + realized + Number(row.liquidation_value || 0) - cost;
  }, 0);
  const unpricedPositionsCount = positionsWithPricingQuality
    .filter((row) => row.pricing_status === 'unpriced').length;
  return {
    cash,
    positionsValue,
    totalValue: cash + positionsValue,
    pnl,
    unpricedPositionsCount,
    positions: positionsWithPricingQuality,
    orders: orderRows,
    fills: fillRows,
    activity: activityRows,
    raw: {
      balances: balancesRecord,
      positions: positionsRecord,
      orders: ordersRecord,
      activity: activityRecord,
      valuation: { source: 'execution_venue_full_depth_liquidation_bid' },
    },
  };
}

export async function submitOfficialRealTrade(intent: OfficialTradeIntent): Promise<OfficialTradeResult> {
  if (intent.platform === 'kalshi') return submitKalshiTrade(intent);
  return submitPolymarketUsTrade(intent);
}

export async function cancelOfficialRealOrder(
  platform: Platform,
  orderId: string,
  marketSlug?: string,
): Promise<OfficialCancelResult> {
  if (platform === 'kalshi') return cancelKalshiOrder(orderId);
  return cancelPolymarketUsOrder(orderId, marketSlug);
}

export async function getOfficialPortfolioSnapshot(platform: Platform, window: OfficialSyncWindow = {}): Promise<OfficialPortfolioSnapshot> {
  if (platform === 'kalshi') return getKalshiSnapshot(window);
  return getPolymarketUsSnapshot();
}
