// =============================================================================
// Polymarket Paper Trading — Type Definitions
// =============================================================================

// -----------------------------------------------------------------------------
// Raw Polymarket API types (Gamma API)
// -----------------------------------------------------------------------------

/** Raw market object returned by the Gamma API. Only the fields we actually use. */
export interface RawPolymarketMarket {
  id: string;
  question: string;
  conditionId: string;
  slug: string;
  /** JSON-encoded string: e.g. '["token0","token1"]' */
  clobTokenIds: string;
  /** JSON-encoded string: e.g. '["Yes","No"]' */
  outcomes: string;
  /** JSON-encoded string: e.g. '["0.55","0.45"]' */
  outcomePrices: string;
  lastTradePrice: number | null;
  bestBid: number | null;
  bestAsk: number | null;
  spread: number | null;
  volume: number | null;
  volume24hr: number | null;
  volumeNum: number | null;
  liquidityClob: number | null;
  liquidity: number | null;
  startDate: string | null;
  endDate: string | null;
  image: string | null;
  icon: string | null;
  description: string | null;
  category: string | null;
  closed: boolean;
  archived: boolean;
  active: boolean;
  /** ISO 8601 */
  createdAt: string;
  updatedAt: string;
  /** Any other fields the API may return */
  [key: string]: unknown;
}

/** Raw event object returned by the Gamma API. */
export interface RawPolymarketEvent {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  startDate: string | null;
  endDate: string | null;
  image: string | null;
  icon: string | null;
  category: string | null;
  closed: boolean;
  archived: boolean;
  active: boolean;
  volume: number | null;
  volume24hr: number | null;
  liquidityClob: number | null;
  liquidity: number | null;
  markets: RawPolymarketMarket[];
  createdAt: string;
  updatedAt: string;
  [key: string]: unknown;
}

// -----------------------------------------------------------------------------
// Raw CLOB API types
// -----------------------------------------------------------------------------

export interface RawMidpointResponse {
  mid: string;
}

export interface RawSpreadResponse {
  spread: string;
}

export interface RawLastTradePriceResponse {
  price: string;
  side: string;
}

export interface RawOrderBookResponse {
  market: string;
  asset_id: string;
  hash: string;
  timestamp: string;
  bids: RawOrderBookLevel[];
  asks: RawOrderBookLevel[];
}

export interface RawOrderBookLevel {
  price: string;
  size: string;
}

export interface RawPriceHistoryPoint {
  t: number; // unix timestamp
  p: number; // price
}

// -----------------------------------------------------------------------------
// Normalized domain models (what the rest of the app uses)
// -----------------------------------------------------------------------------

export interface NormalizedMarket {
  id: string;
  question: string;
  conditionId: string;
  slug: string;
  /** Parsed array of token IDs. Index 0 = YES, Index 1 = NO. */
  tokenIds: string[];
  /** Parsed array of outcome labels, e.g. ["Yes", "No"]. */
  outcomes: string[];
  /** Parsed array of outcome prices as numbers. */
  outcomePrices: number[];
  lastTradePrice: number | null;
  bestBid: number | null;
  bestAsk: number | null;
  spread: number | null;
  volume24hr: number | null;
  liquidity: number | null;
  image: string | null;
  icon: string | null;
  description: string | null;
  category: string | null;
  closed: boolean;
  startDate: string | null;
  endDate: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface NormalizedEvent {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  image: string | null;
  icon: string | null;
  category: string | null;
  closed: boolean;
  volume24hr: number | null;
  liquidity: number | null;
  markets: NormalizedMarket[];
  startDate: string | null;
  endDate: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface OrderBookLevel {
  price: number;
  size: number;
}

export interface OrderBook {
  market: string;
  assetId: string;
  timestamp: string;
  bids: OrderBookLevel[];
  asks: OrderBookLevel[];
}

export interface PricePoint {
  timestamp: number;
  price: number;
}

export interface LastTradePrice {
  price: number;
  side: string;
}

// -----------------------------------------------------------------------------
// Trading engine types
// -----------------------------------------------------------------------------

export type OutcomeLabel = 'YES' | 'NO';
export type TradeSide = 'BUY' | 'SELL';

export interface Position {
  id: string;
  marketId: string;
  marketQuestion: string;
  tokenId: string;
  outcome: OutcomeLabel;
  shares: number;
  avgEntryPrice: number;
  currentPrice: number;
  unrealizedPnL: number;
  unrealizedPnLPercent: number;
  createdAt: string;
}

export interface Trade {
  id: string;
  marketId: string;
  marketQuestion: string;
  tokenId: string;
  outcome: OutcomeLabel;
  side: TradeSide;
  shares: number;
  price: number;
  total: number;
  timestamp: string;
}

export interface Portfolio {
  balance: number;
  positions: Position[];
  tradeHistory: Trade[];
  totalValue: number;
  totalPnL: number;
  totalPnLPercent: number;
}

export interface TradeParams {
  marketId: string;
  marketQuestion: string;
  tokenId: string;
  outcome: OutcomeLabel;
  side: TradeSide;
  shares: number;
  /** The execution price (midpoint or user-specified). */
  price: number;
  idempotencyKey?: string;
  slippageApplied?: number;
}

// -----------------------------------------------------------------------------
// API route request / response shapes
// -----------------------------------------------------------------------------

export interface MarketsQueryParams {
  limit?: number;
  offset?: number;
  category?: string;
  search?: string;
}

export interface TradeRequest {
  marketId: string;
  marketQuestion: string;
  tokenId: string;
  outcome: OutcomeLabel;
  side: TradeSide;
  shares: number;
  price: number;
}

export interface ApiErrorResponse {
  error: string;
  details?: string;
}

export interface ApiSuccessResponse<T> {
  data: T;
}

// -----------------------------------------------------------------------------
// Polymarket API client parameter types
// -----------------------------------------------------------------------------

export interface FetchMarketsParams {
  limit?: number;
  offset?: number;
  closed?: boolean;
  order?: string;
  ascending?: boolean;
}

export interface FetchEventsParams {
  limit?: number;
  offset?: number;
  closed?: boolean;
  order?: string;
  ascending?: boolean;
}
