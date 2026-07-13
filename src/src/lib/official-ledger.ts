import { normalizeKalshiOrderStatus } from '@/lib/official-trading';

function number(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}
const money = (value: number) => Number(value.toFixed(6));

function requiredText(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length === 0) throw new Error(`Missing Kalshi ${field}`);
  return value;
}

function timestamp(value: unknown, field: string): Date {
  const parsed = new Date(requiredText(value, field));
  if (Number.isNaN(parsed.getTime())) throw new Error(`Invalid Kalshi ${field}`);
  return parsed;
}

export function normalizeKalshiFill(row: Record<string, unknown>) {
  const rawOutcome = row.outcome_side ?? row.side;
  const outcome = rawOutcome == null ? null : String(rawOutcome).toUpperCase() === 'NO' ? 'NO' : 'YES';
  const price = outcome !== 'NO'
    ? number(row.yes_price_dollars ?? row.yes_price) / (row.yes_price_dollars == null ? 100 : 1)
    : number(row.no_price_dollars ?? row.no_price) / (row.no_price_dollars == null ? 100 : 1);
  return {
    platform: 'kalshi' as const,
    officialFillId: requiredText(row.fill_id, 'fill_id'),
    officialTradeId: typeof row.trade_id === 'string' ? row.trade_id : null,
    officialOrderId: typeof row.order_id === 'string' ? row.order_id : null,
    marketId: requiredText(row.ticker ?? row.market_ticker, 'ticker'),
    outcome: outcome as 'YES' | 'NO' | null,
    side: row.action == null ? null : String(row.action).toUpperCase() === 'SELL' ? 'SELL' as const : 'BUY' as const,
    quantity: number(row.count_fp ?? row.count),
    price,
    fee: number(row.fee_cost_dollars ?? row.fee_cost),
    isTaker: typeof row.is_taker === 'boolean' ? row.is_taker : null,
    filledAt: timestamp(row.created_time, 'created_time'),
    payload: row,
  };
}

export function normalizeKalshiOrderEvent(row: Record<string, unknown>) {
  const officialOrderId = requiredText(row.order_id, 'order_id');
  const status = normalizeKalshiOrderStatus(row);
  const requestedQuantity = number(row.initial_count_fp ?? row.initial_count ?? row.count);
  const filledQuantity = number(row.fill_count_fp ?? row.fill_count);
  const remainingQuantity = number(row.remaining_count_fp ?? row.remaining_count);
  const venueTime = requiredText(row.last_update_time ?? row.created_time, 'order time');
  return {
    platform: 'kalshi' as const,
    officialOrderId,
    eventKey: `kalshi:${officialOrderId}:${status}:${filledQuantity}:${remainingQuantity}:${venueTime}`,
    status,
    requestedQuantity,
    filledQuantity,
    remainingQuantity,
    occurredAt: timestamp(venueTime, 'order time'),
    payload: row,
  };
}

export function normalizeKalshiSettlement(row: Record<string, unknown>) {
  const marketId = requiredText(row.ticker, 'settlement ticker');
  const settledTime = requiredText(row.settled_time, 'settled_time');
  return {
    platform: 'kalshi' as const,
    settlementKey: `kalshi:${marketId}:${settledTime}`,
    marketId,
    eventId: typeof row.event_ticker === 'string' ? row.event_ticker : null,
    marketResult: String(row.market_result ?? '').toUpperCase(),
    yesQuantity: number(row.yes_count_fp ?? row.yes_count),
    noQuantity: number(row.no_count_fp ?? row.no_count),
    yesCost: number(row.yes_total_cost_dollars ?? row.yes_total_cost) / (row.yes_total_cost_dollars == null ? 100 : 1),
    noCost: number(row.no_total_cost_dollars ?? row.no_total_cost) / (row.no_total_cost_dollars == null ? 100 : 1),
    revenue: number(row.revenue_dollars ?? row.revenue) / (row.revenue_dollars == null ? 100 : 1),
    fee: number(row.fee_cost_dollars ?? row.fee_cost),
    settledAt: timestamp(settledTime, 'settled_time'),
    payload: row,
  };
}

type CashLedgerSource = {
  platform: 'kalshi' | 'polymarket_us';
  strategyId?: string | null; userId?: string | null; payload: Record<string, unknown>;
};

export function buildFillCashLedgerEntries(fill: CashLedgerSource & {
  officialFillId: string; side: 'BUY' | 'SELL' | null; quantity: number; price: number; fee: number; filledAt: Date;
}) {
  const notional = fill.quantity * fill.price;
  const cash = money(fill.side === 'SELL' ? notional - fill.fee : -(notional + fill.fee));
  const position = money(fill.side === 'SELL' ? -notional : notional);
  const group = `${fill.platform}:fill:${fill.officialFillId}`;
  return [
    { accountType: 'CASH', amount: cash },
    { accountType: 'POSITION_CASHFLOW', amount: position },
    { accountType: 'FEES', amount: money(fill.fee) },
  ].filter((row) => row.amount !== 0).map((row) => ({
    ...row, platform: fill.platform, accountScope: 'default', strategyId: fill.strategyId ?? null, userId: fill.userId ?? null,
    entryKey: `${group}:${row.accountType}`, entryGroup: group, sourceType: 'FILL', sourceId: fill.officialFillId,
    occurredAt: fill.filledAt, payload: fill.payload,
  }));
}

export function buildSettlementCashLedgerEntries(settlement: CashLedgerSource & {
  settlementKey: string; revenue: number; fee: number; settledAt: Date;
}) {
  const group = `${settlement.platform}:settlement:${settlement.settlementKey}`;
  return [
    { accountType: 'CASH', amount: money(settlement.revenue - settlement.fee) },
    { accountType: 'POSITION_SETTLEMENT', amount: money(-settlement.revenue) },
    { accountType: 'FEES', amount: money(settlement.fee) },
  ].filter((row) => row.amount !== 0).map((row) => ({
    ...row, platform: settlement.platform, accountScope: 'default', strategyId: settlement.strategyId ?? null, userId: settlement.userId ?? null,
    entryKey: `${group}:${row.accountType}`, entryGroup: group, sourceType: 'SETTLEMENT', sourceId: settlement.settlementKey,
    occurredAt: settlement.settledAt, payload: settlement.payload,
  }));
}
