import { NextRequest, NextResponse } from 'next/server';
import { desc, eq } from 'drizzle-orm';
import { auth } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { buildOfficialOrderHistory } from '@/lib/agent-order-history';
import { parseTradingHistoryQuery, toCsv } from '@/lib/trading-history';
import { officialOrderEvents, officialSettlementAllocations, officialSettlements, officialTradeFills, realTradeOrders, strategies } from '@/lib/db/schema';

const GLOBAL_VIEWERS = new Set(['dickenslihaocheng@gmail.com']);
const numeric = (value: unknown) => Number.isFinite(Number(value)) ? Number(value) : 0;
const iso = (value: Date | string | null | undefined) => value ? new Date(value).toISOString() : null;

export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const query = parseTradingHistoryQuery(request.nextUrl.searchParams);
  const db = getDb(); const global = GLOBAL_VIEWERS.has(session.user.email ?? '');
  const allStrategies = global ? await db.select().from(strategies) : await db.select().from(strategies).where(eq(strategies.userId, session.user.id));
  const visibleStrategyIds = new Set(allStrategies.map((row) => row.id));
  let rows: Record<string, unknown>[] = [];

  if (query.type === 'orders') {
    const [orders, fills, events] = await Promise.all([
      global ? db.select().from(realTradeOrders).orderBy(desc(realTradeOrders.createdAt)).limit(5000) : db.select().from(realTradeOrders).where(eq(realTradeOrders.userId, session.user.id)).orderBy(desc(realTradeOrders.createdAt)).limit(5000),
      global ? db.select().from(officialTradeFills).orderBy(desc(officialTradeFills.filledAt)).limit(5000) : db.select().from(officialTradeFills).where(eq(officialTradeFills.userId, session.user.id)).orderBy(desc(officialTradeFills.filledAt)).limit(5000),
      global ? db.select().from(officialOrderEvents).orderBy(desc(officialOrderEvents.occurredAt)).limit(5000) : db.select().from(officialOrderEvents).where(eq(officialOrderEvents.userId, session.user.id)).orderBy(desc(officialOrderEvents.occurredAt)).limit(5000),
    ]);
    const history = buildOfficialOrderHistory(fills, events);
    rows = orders.map((order) => ({ id: order.id, strategy_id: order.strategyId, platform: order.platform, market: order.marketSlugOrTicker ?? order.marketId, side: order.side, requested_quantity: numeric(order.quantity), limit_price: numeric(order.price), status: order.status, official_order_id: order.officialOrderId, client_order_id: order.clientOrderId, submitted_at: iso(order.createdAt), updated_at: iso(order.updatedAt), ...(order.officialOrderId ? history.get(order.officialOrderId) : {}) }));
  } else if (query.type === 'executions') {
    const fills = global ? await db.select().from(officialTradeFills).orderBy(desc(officialTradeFills.filledAt)).limit(5000) : await db.select().from(officialTradeFills).where(eq(officialTradeFills.userId, session.user.id)).orderBy(desc(officialTradeFills.filledAt)).limit(5000);
    rows = fills.map((fill) => ({ id: fill.id, strategy_id: fill.strategyId, platform: fill.platform, market: fill.marketId, outcome: fill.outcome, side: fill.side, quantity: numeric(fill.quantity), price: numeric(fill.price), fee: numeric(fill.fee), liquidity: fill.isTaker == null ? null : fill.isTaker ? 'TAKER' : 'MAKER', official_fill_id: fill.officialFillId, official_order_id: fill.officialOrderId, executed_at: iso(fill.filledAt) }));
  } else {
    const [allocations, settlements] = await Promise.all([
      db.select().from(officialSettlementAllocations).orderBy(desc(officialSettlementAllocations.updatedAt)).limit(5000),
      db.select().from(officialSettlements).orderBy(desc(officialSettlements.settledAt)).limit(5000),
    ]);
    const settlementById = new Map(settlements.map((row) => [row.id, row]));
    rows = allocations.filter((row) => visibleStrategyIds.has(row.strategyId)).flatMap((allocation) => {
      const settlement = settlementById.get(allocation.settlementId); if (!settlement) return [];
      return [{ id: allocation.id, strategy_id: allocation.strategyId, platform: settlement.platform, market: settlement.marketId, outcome: allocation.outcome, market_result: settlement.marketResult, quantity: numeric(allocation.quantity), cost_basis: numeric(allocation.costBasis), proceeds: numeric(allocation.proceeds), fee: numeric(allocation.settlementFee), realized_pnl: numeric(allocation.realizedPnl), allocation_method: allocation.allocationMethod, settled_at: iso(settlement.settledAt) }];
    });
  }

  rows = rows.filter((row) => {
    if (row.strategy_id && !visibleStrategyIds.has(String(row.strategy_id))) return false;
    if (query.strategyId && row.strategy_id !== query.strategyId) return false;
    if (query.platform && row.platform !== query.platform) return false;
    if (query.market && !String(row.market ?? '').toLowerCase().includes(query.market.toLowerCase())) return false;
    if (query.status && !String(row.status ?? '').toLowerCase().includes(query.status.toLowerCase())) return false;
    const time = String(row.submitted_at ?? row.executed_at ?? row.settled_at ?? '');
    if (query.dateFrom && time && time < new Date(query.dateFrom).toISOString()) return false;
    if (query.dateTo && time && time > new Date(query.dateTo).toISOString()) return false;
    return true;
  });
  if (query.format === 'csv') return new Response(toCsv(rows), { headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="${query.type}.csv"` } });
  const total = rows.length; const start = (query.page - 1) * query.pageSize;
  return NextResponse.json({ type: query.type, page: query.page, page_size: query.pageSize, total, total_pages: Math.max(1, Math.ceil(total / query.pageSize)), rows: rows.slice(start, start + query.pageSize) });
}
