import { randomUUID, constants, sign as cryptoSign } from 'crypto';
import { readFileSync } from 'fs';
import { getPolymarketUsClient } from '@/lib/polymarket-us';

type Platform = 'kalshi' | 'polymarket_us';
type Outcome = 'YES' | 'NO';
type Side = 'BUY' | 'SELL';
type TimeInForce = 'GTC' | 'IOC' | 'FOK';

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
    : ['portfolio', 'positions', 'orders', 'fills', 'activity'];
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
): { positionsValue: number; pnl: number } {
  let positionsValue = 0;
  let pnl = 0;
  for (const position of positionRows) {
    const hasDollarMarketValue = position.market_exposure_dollars != null || position.market_value_dollars != null;
    const marketValue = Number(
      position.market_exposure_dollars ?? position.market_value_dollars ?? position.market_value ?? position.value ?? 0,
    ) / (hasDollarMarketValue ? 1 : 100);
    const hasDollarPnl = position.realized_pnl_dollars != null;
    const realizedPnl = Number(position.realized_pnl_dollars ?? position.realized_pnl ?? 0) / (hasDollarPnl ? 1 : 100);
    const hasDollarCost = position.position_cost_dollars != null;
    const positionCost = Number(position.position_cost_dollars ?? position.position_cost ?? 0) / (hasDollarCost ? 1 : 100);
    if (Number.isFinite(marketValue)) positionsValue += marketValue;
    if (Number.isFinite(realizedPnl)) pnl += realizedPnl;
    if (!hasDollarPnl && Number.isFinite(marketValue - positionCost)) {
      pnl += marketValue - positionCost;
    }
  }
  return { positionsValue, pnl };
}

export function kalshiOrderQuantity(order: Record<string, unknown>): number | null {
  const quantity = Number(order.initial_count_fp ?? order.initial_count ?? order.count);
  return Number.isFinite(quantity) && quantity > 0 ? quantity : null;
}

function yesSidePrice(outcome: Outcome, price: number): number {
  return outcome === 'YES' ? price : 1 - price;
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

function polymarketUsOutcomeSide(outcome: Outcome): string {
  return outcome === 'YES' ? 'OUTCOME_SIDE_YES' : 'OUTCOME_SIDE_NO';
}

function polymarketUsAction(side: Side): string {
  return side === 'BUY' ? 'ORDER_ACTION_BUY' : 'ORDER_ACTION_SELL';
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

function kalshiBaseUrl(): string {
  if (process.env.KALSHI_BASE_URL) {
    return process.env.KALSHI_BASE_URL.replace(/\/$/, '');
  }
  const useDemo = process.env.KALSHI_USE_DEMO === 'true';
  return useDemo ? 'https://demo-api.kalshi.co/trade-api/v2' : 'https://external-api.kalshi.com/trade-api/v2';
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

async function getKalshiCollection(path: string, key: string): Promise<Record<string, unknown>> {
  const rows = await collectKalshiCursorPages<Record<string, unknown>>(async (cursor) => {
    const params = new URLSearchParams({ limit: '1000' });
    if (cursor) params.set('cursor', cursor);
    const response = await kalshiRequest<Record<string, unknown>>('GET', `${path}?${params}`);
    return {
      rows: Array.isArray(response[key]) ? response[key] as Record<string, unknown>[] : [],
      cursor: typeof response.cursor === 'string' ? response.cursor : undefined,
    };
  });
  return { [key]: rows };
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
  const price = yesSidePrice(intent.outcome, clampPrice(intent.price ?? NaN));
  const quantity = resolveQuantity(intent);
  const clientOrderId = intent.clientOrderId ?? randomUUID();

  const request = {
    ticker: intent.slug,
    client_order_id: clientOrderId,
    side: kalshiBookSide(intent.outcome, intent.side),
    count: formatKalshiCount(quantity),
    price: price.toFixed(4),
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

async function getKalshiSnapshot(): Promise<OfficialPortfolioSnapshot> {
  const [balance, positions, orders, fills, settlements] = await Promise.all([
    kalshiRequest<Record<string, unknown>>('GET', '/portfolio/balance').catch((error) => ({ error: String(error) })),
    kalshiRequest<Record<string, unknown>>('GET', '/portfolio/positions').catch((error) => ({ error: String(error) })),
    getKalshiCollection('/portfolio/orders', 'orders').catch((error) => ({ error: String(error) })),
    getKalshiCollection('/portfolio/fills', 'fills').catch((error) => ({ error: String(error) })),
    getKalshiCollection('/portfolio/settlements', 'settlements').catch((error) => ({ error: String(error) })),
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

  const { positionsValue, pnl } = summarizeKalshiPositions(positionRows);
  const totalValue = cash + positionsValue;

  return {
    cash,
    positionsValue,
    totalValue,
    pnl,
    positions: positionRows,
    orders: orderRows,
    fills: fillRows,
    settlements: settlementRows,
    activity: [],
    raw: { balance: balanceRecord, positions: positionsRecord, orders: ordersRecord, fills: fillsRecord, settlements: settlementsRecord },
  };
}

async function submitPolymarketUsTrade(intent: OfficialTradeIntent): Promise<OfficialTradeResult> {
  const price = yesSidePrice(intent.outcome, clampPrice(intent.price ?? NaN));
  const quantity = resolveQuantity(intent);
  const clientOrderId = intent.clientOrderId ?? randomUUID();
  const client = getPolymarketUsClient() as unknown as {
    orders: {
      create(params: Record<string, unknown>): Promise<Record<string, unknown>>;
    };
  };
  const request = {
    marketSlug: intent.slug,
    type: 'ORDER_TYPE_LIMIT',
    price: { value: fixed(price, 4), currency: 'USD' },
    quantity,
    tif: polymarketUsTif(intent.timeInForce),
    outcomeSide: polymarketUsOutcomeSide(intent.outcome),
    action: polymarketUsAction(intent.side),
    clientOrderId,
  };
  const response = await client.orders.create(request);
  const officialOrderId =
    typeof response.id === 'string'
      ? response.id
      : typeof response.orderId === 'string'
        ? response.orderId
        : null;

  return {
    officialOrderId,
    clientOrderId,
    status: String(response.state ?? response.status ?? 'SUBMITTED'),
    request,
    response,
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
    portfolio?: {
      retrieve?(): Promise<Record<string, unknown>>;
      positions?(): Promise<Record<string, unknown>>;
    };
    orders?: {
      list?(): Promise<Record<string, unknown>>;
    };
    fills?: {
      list?(): Promise<Record<string, unknown>>;
    };
    activity?: {
      list?(): Promise<Record<string, unknown>>;
    };
  };
  const [portfolio, positions, orders, fills, activity] = await Promise.all([
    client.portfolio?.retrieve?.().catch((error) => ({ error: String(error) })) ?? Promise.resolve({}),
    client.portfolio?.positions?.().catch((error) => ({ error: String(error) })) ?? Promise.resolve({}),
    client.orders?.list?.().catch((error) => ({ error: String(error) })) ?? Promise.resolve({}),
    client.fills?.list?.().catch((error) => ({ error: String(error) })) ?? Promise.resolve({}),
    client.activity?.list?.().catch((error) => ({ error: String(error) })) ?? Promise.resolve({}),
  ]);
  const portfolioRecord = portfolio as Record<string, unknown>;
  const positionsRecord = positions as Record<string, unknown>;
  const ordersRecord = orders as Record<string, unknown>;
  const fillsRecord = fills as Record<string, unknown>;
  const activityRecord = activity as Record<string, unknown>;

  validateOfficialPortfolioSnapshot('polymarket_us', {
    portfolio: portfolioRecord,
    positions: positionsRecord,
    orders: ordersRecord,
    fills: fillsRecord,
    activity: activityRecord,
  });

  const cash = Number(portfolioRecord.cash ?? portfolioRecord.availableBalance ?? portfolioRecord.balance ?? 0);
  const positionRows = Array.isArray(positionsRecord.positions) ? positionsRecord.positions : [];
  const orderRows = Array.isArray(ordersRecord.orders) ? ordersRecord.orders : [];
  const fillRows = Array.isArray(fillsRecord.fills) ? fillsRecord.fills : [];
  const activityRows = Array.isArray(activityRecord.activity) ? activityRecord.activity : [];
  return {
    cash,
    positionsValue: Number(portfolioRecord.positionsValue ?? 0),
    totalValue: Number(portfolioRecord.totalValue ?? cash),
    pnl: Number(portfolioRecord.pnl ?? 0),
    positions: positionRows,
    orders: orderRows,
    fills: fillRows,
    activity: activityRows,
    raw: {
      portfolio: portfolioRecord,
      positions: positionsRecord,
      orders: ordersRecord,
      fills: fillsRecord,
      activity: activityRecord,
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

export async function getOfficialPortfolioSnapshot(platform: Platform): Promise<OfficialPortfolioSnapshot> {
  if (platform === 'kalshi') return getKalshiSnapshot();
  return getPolymarketUsSnapshot();
}
