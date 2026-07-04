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
  raw: Record<string, unknown>;
};

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
  if (process.env.KALSHI_PRIVATE_KEY_PEM) {
    return process.env.KALSHI_PRIVATE_KEY_PEM.replace(/\\n/g, '\n');
  }
  return readFileSync(requireEnv('KALSHI_PRIVATE_KEY_PATH'), 'utf8');
}

function kalshiBaseUrl(): string {
  return (process.env.KALSHI_BASE_URL || 'https://external-api.kalshi.com/trade-api/v2').replace(/\/$/, '');
}

function kalshiSign(method: string, path: string): Record<string, string> {
  const timestamp = Date.now().toString();
  const message = Buffer.from(`${timestamp}${method.toUpperCase()}${path.split('?')[0]}`, 'utf8');
  const signature = cryptoSign('sha256', message, {
    key: loadKalshiPrivateKey(),
    padding: constants.RSA_PKCS1_PSS_PADDING,
    saltLength: constants.RSA_PSS_SALTLEN_DIGEST,
  }).toString('base64');

  return {
    'KALSHI-ACCESS-KEY': requireEnv('KALSHI_API_KEY_ID'),
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

async function submitKalshiTrade(intent: OfficialTradeIntent): Promise<OfficialTradeResult> {
  const price = yesSidePrice(intent.outcome, clampPrice(intent.price ?? NaN));
  const quantity = resolveQuantity(intent);
  const clientOrderId = intent.clientOrderId ?? randomUUID();
  const request = {
    ticker: intent.slug,
    client_order_id: clientOrderId,
    side: kalshiBookSide(intent.outcome, intent.side),
    count: fixed(quantity, 2),
    price: fixed(price, 4),
    time_in_force: kalshiTimeInForce(intent.timeInForce),
    self_trade_prevention_type: 'taker_at_cross',
    post_only: false,
    cancel_order_on_pause: false,
    reduce_only: intent.side === 'SELL',
  };

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
    status: 'SUBMITTED',
    request,
    response,
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
  const [balance, positions, orders] = await Promise.all([
    kalshiRequest<Record<string, unknown>>('GET', '/portfolio/balance').catch((error) => ({ error: String(error) })),
    kalshiRequest<Record<string, unknown>>('GET', '/portfolio/positions').catch((error) => ({ error: String(error) })),
    kalshiRequest<Record<string, unknown>>('GET', '/portfolio/orders').catch((error) => ({ error: String(error) })),
  ]);
  const balanceRecord = balance as Record<string, unknown>;
  const positionsRecord = positions as Record<string, unknown>;
  const ordersRecord = orders as Record<string, unknown>;

  const cash =
    Number(balanceRecord.balance) / (Number(balanceRecord.balance) > 1_000_000 ? 100 : 1) ||
    Number(balanceRecord.available_balance) ||
    0;
  const positionRows = Array.isArray(positionsRecord.positions) ? positionsRecord.positions : [];
  const orderRows = Array.isArray(ordersRecord.orders) ? ordersRecord.orders : [];

  return {
    cash,
    positionsValue: 0,
    totalValue: cash,
    pnl: 0,
    positions: positionRows,
    orders: orderRows,
    raw: { balance: balanceRecord, positions: positionsRecord, orders: ordersRecord },
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
  };
  const [portfolio, positions, orders] = await Promise.all([
    client.portfolio?.retrieve?.().catch((error) => ({ error: String(error) })) ?? Promise.resolve({}),
    client.portfolio?.positions?.().catch((error) => ({ error: String(error) })) ?? Promise.resolve({}),
    client.orders?.list?.().catch((error) => ({ error: String(error) })) ?? Promise.resolve({}),
  ]);
  const portfolioRecord = portfolio as Record<string, unknown>;
  const positionsRecord = positions as Record<string, unknown>;
  const ordersRecord = orders as Record<string, unknown>;

  const cash = Number(portfolioRecord.cash ?? portfolioRecord.availableBalance ?? portfolioRecord.balance ?? 0);
  const positionRows = Array.isArray(positionsRecord.positions) ? positionsRecord.positions : [];
  const orderRows = Array.isArray(ordersRecord.orders) ? ordersRecord.orders : [];
  return {
    cash,
    positionsValue: Number(portfolioRecord.positionsValue ?? 0),
    totalValue: Number(portfolioRecord.totalValue ?? cash),
    pnl: Number(portfolioRecord.pnl ?? 0),
    positions: positionRows,
    orders: orderRows,
    raw: { portfolio: portfolioRecord, positions: positionsRecord, orders: ordersRecord },
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
