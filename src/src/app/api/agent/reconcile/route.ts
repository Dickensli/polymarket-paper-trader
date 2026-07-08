import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { and, eq } from 'drizzle-orm';
import { auth } from '@/lib/auth';
import { getDb } from '@/lib/db';
import {
  portfolioSnapshots,
  realTradeOrders,
  reconciliationLogs,
  strategies,
} from '@/lib/db/schema';
import {
  getOfficialPortfolioSnapshot,
  type OfficialPortfolioSnapshot,
} from '@/lib/official-trading';
import { getPortfolio } from '@/lib/trading-engine';

const reconcileSchema = z.object({
  strategy_id: z.string().min(1).max(255),
  run_id: z.string().uuid().optional(),
  thresholds: z.object({
    cash: z.number().nonnegative().optional(),
    total_value: z.number().nonnegative().optional(),
    position_quantity: z.number().nonnegative().optional(),
    open_orders: z.number().int().nonnegative().optional(),
  }).optional(),
});

export const DEFAULT_THRESHOLDS = {
  cash: 1,
  total_value: 1,
  position_quantity: 0.000001,
  open_orders: 0,
};

const TERMINAL_ORDER_STATUSES = new Set([
  'CANCELLED',
  'REJECTED',
  'ERROR',
  'CANCEL_ERROR',
  'FILLED',
  'EXECUTED',
  'COMPLETE',
  'COMPLETED',
]);

export type LocalSnapshot = {
  cash: number;
  positions_value: number;
  total_value: number;
  pnl: number;
  positions: unknown[];
  orders: unknown[];
  open_orders: unknown[];
};

export type ReconciliationDifference = {
  type: 'balance' | 'position' | 'order' | 'fill' | 'unknown';
  severity: 'info' | 'warning' | 'critical';
  message: string;
  diff: Record<string, unknown>;
};

function numberFrom(value: unknown): number {
  if (value && typeof value === 'object' && 'value' in value) {
    return numberFrom((value as Record<string, unknown>).value);
  }
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? value as Record<string, unknown> : {};
}

function textFrom(record: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  }
  return '';
}

function normalizeOutcome(value: unknown): string {
  if (typeof value !== 'string') return '';
  const upper = value.toUpperCase();
  if (upper.includes('YES')) return 'YES';
  if (upper.includes('NO')) return 'NO';
  return upper;
}

function marketKey(record: Record<string, unknown>): string {
  return textFrom(record, [
    'marketId',
    'market_id',
    'marketSlug',
    'market_slug',
    'market_slug_or_ticker',
    'marketSlugOrTicker',
    'ticker',
    'market_ticker',
    'slug',
    'tokenId',
    'token_id',
  ]);
}

function positionQuantity(record: Record<string, unknown>): number {
  return numberFrom(
    record.shares ??
      record.quantity ??
      record.count ??
      record.contracts ??
      record.position ??
      record.size ??
      0,
  );
}

function addPosition(
  totals: Map<string, number>,
  record: Record<string, unknown>,
  quantity: number,
  outcomeOverride?: string,
) {
  const market = marketKey(record);
  if (!market) return;
  const outcome = outcomeOverride || normalizeOutcome(record.outcome ?? record.outcomeSide ?? record.side);
  const key = `${market}:${outcome || 'UNKNOWN'}`;
  totals.set(key, (totals.get(key) ?? 0) + quantity);
}

function normalizePositions(rows: unknown[]): Map<string, number> {
  const totals = new Map<string, number>();
  for (const row of rows) {
    const record = asRecord(row);
    if (record.yes_count != null || record.yesCount != null) {
      addPosition(totals, record, numberFrom(record.yes_count ?? record.yesCount), 'YES');
    }
    if (record.no_count != null || record.noCount != null) {
      addPosition(totals, record, numberFrom(record.no_count ?? record.noCount), 'NO');
    }
    if (record.yes_count == null && record.yesCount == null && record.no_count == null && record.noCount == null) {
      addPosition(totals, record, positionQuantity(record));
    }
  }
  return totals;
}

function orderId(record: Record<string, unknown>): string {
  return textFrom(record, [
    'officialOrderId',
    'official_order_id',
    'order_id',
    'orderId',
    'id',
    'clientOrderId',
    'client_order_id',
  ]);
}

function orderStatus(record: Record<string, unknown>): string {
  return textFrom(record, ['status', 'state', 'orderStatus', 'order_status']).toUpperCase();
}

function fillId(record: Record<string, unknown>): string {
  return textFrom(record, [
    'fill_id',
    'fillId',
    'trade_id',
    'tradeId',
    'officialOrderId',
    'official_order_id',
    'order_id',
    'orderId',
    'id',
    'clientOrderId',
    'client_order_id',
  ]);
}

function openOrderIds(rows: unknown[]): Set<string> {
  const ids = new Set<string>();
  for (const row of rows) {
    const record = asRecord(row);
    const status = orderStatus(record);
    if (status && TERMINAL_ORDER_STATUSES.has(status)) continue;
    const id = orderId(record);
    if (id) ids.add(id);
  }
  return ids;
}

function filledIds(rows: unknown[]): Set<string> {
  const ids = new Set<string>();
  for (const row of rows) {
    const record = asRecord(row);
    const status = orderStatus(record);
    if (status && !['FILLED', 'EXECUTED', 'COMPLETE', 'COMPLETED'].includes(status)) continue;
    const id = fillId(record);
    if (id) ids.add(id);
  }
  return ids;
}

function officialFillRows(snapshot: OfficialPortfolioSnapshot): unknown[] {
  const fillRows = [...snapshot.fills];
  for (const row of snapshot.activity) {
    const record = asRecord(row);
    const kind = textFrom(record, ['type', 'activityType', 'activity_type', 'eventType', 'event_type']).toUpperCase();
    if (!kind || kind.includes('FILL') || kind.includes('TRADE') || kind.includes('EXECUTION')) {
      fillRows.push(row);
    }
  }
  return fillRows;
}

function missingFrom(left: Set<string>, right: Set<string>): string[] {
  return [...left].filter((value) => !right.has(value));
}

export function compareSnapshots(
  localSnapshot: LocalSnapshot,
  officialSnapshot: OfficialPortfolioSnapshot,
  thresholds: typeof DEFAULT_THRESHOLDS,
): ReconciliationDifference[] {
  const differences: ReconciliationDifference[] = [];
  const cashDelta = Number((officialSnapshot.cash - localSnapshot.cash).toFixed(6));
  const totalValueDelta = Number((officialSnapshot.totalValue - localSnapshot.total_value).toFixed(6));

  if (Math.abs(cashDelta) > thresholds.cash || Math.abs(totalValueDelta) > thresholds.total_value) {
    differences.push({
      type: 'balance',
      severity: Math.abs(cashDelta) > thresholds.cash * 10 ? 'critical' : 'warning',
      message: 'Official and local balances differ beyond configured thresholds.',
      diff: {
        cash: { official: officialSnapshot.cash, local: localSnapshot.cash, delta: cashDelta },
        total_value: {
          official: officialSnapshot.totalValue,
          local: localSnapshot.total_value,
          delta: totalValueDelta,
        },
      },
    });
  }

  const officialPositions = normalizePositions(officialSnapshot.positions);
  const localPositions = normalizePositions(localSnapshot.positions);
  const positionDiffs: Record<string, { official: number; local: number; delta: number }> = {};
  const positionKeys = new Set([...officialPositions.keys(), ...localPositions.keys()]);
  for (const key of positionKeys) {
    const official = officialPositions.get(key) ?? 0;
    const local = localPositions.get(key) ?? 0;
    const delta = Number((official - local).toFixed(6));
    if (Math.abs(delta) > thresholds.position_quantity) {
      positionDiffs[key] = { official, local, delta };
    }
  }
  if (Object.keys(positionDiffs).length > 0) {
    differences.push({
      type: 'position',
      severity: 'warning',
      message: 'Official and local positions differ beyond configured thresholds.',
      diff: positionDiffs,
    });
  }

  const officialOpenOrders = openOrderIds(officialSnapshot.orders);
  const localOpenOrders = openOrderIds(localSnapshot.open_orders);
  const missingLocally = missingFrom(officialOpenOrders, localOpenOrders);
  const missingOfficially = missingFrom(localOpenOrders, officialOpenOrders);
  if (
    missingLocally.length > thresholds.open_orders ||
    missingOfficially.length > thresholds.open_orders
  ) {
    differences.push({
      type: 'order',
      severity: 'warning',
      message: 'Official and local open orders differ.',
      diff: {
        official_open_order_count: officialOpenOrders.size,
        local_open_order_count: localOpenOrders.size,
        missing_locally: missingLocally,
        missing_officially: missingOfficially,
      },
    });
  }

  const officialFills = officialFillRows(officialSnapshot);
  const officialFillIds = filledIds(officialFills);
  const localFillIds = filledIds(localSnapshot.orders);
  const fillsMissingLocally = missingFrom(officialFillIds, localFillIds);
  const fillsMissingOfficially = missingFrom(localFillIds, officialFillIds);
  if (fillsMissingLocally.length > 0 || fillsMissingOfficially.length > 0) {
    differences.push({
      type: 'fill',
      severity: 'warning',
      message: 'Official and local fills/activity differ.',
      diff: {
        official_fill_count: officialFills.length,
        local_filled_order_count: localFillIds.size,
        missing_locally: fillsMissingLocally,
        missing_officially: fillsMissingOfficially,
      },
    });
  } else if (officialFills.length > 0) {
    differences.push({
      type: 'fill',
      severity: 'info',
      message: 'Official fill/activity records were captured for audit review.',
      diff: {
        official_fill_count: officialFills.length,
        local_filled_order_count: localFillIds.size,
      },
    });
  }

  return differences;
}

// POST /api/agent/reconcile
//
// Captures local and official venue snapshots, compares balances, positions,
// open orders, and fills/activity, then writes reconciliation logs.
export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    if (session?.error === 'STRATEGY_NOT_REGISTERED') {
      return NextResponse.json({ error: 'Strategy not registered. Call register_strategy first.' }, { status: 404 });
    }
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const sanitizePortfolioSnapshot = (s: any) => ({
      platform: s.platform,
      agentMode: s.agentMode,
      source: s.source,
      cash: Number(s.cash),
      positionsValue: Number(s.positionsValue),
      totalValue: Number(s.totalValue),
      pnl: Number(s.pnl),
      positions: s.positions,
      orders: s.orders,
      capturedAt: s.capturedAt,
    });

    const sanitizeReconciliationLog = (l: any) => ({
      platform: l.platform,
      severity: l.severity,
      differenceType: l.differenceType,
      diff: l.diff,
      threshold: l.threshold,
      message: l.message,
      createdAt: l.createdAt,
    });

    const parsed = reconcileSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? 'Invalid input' },
        { status: 400 },
      );
    }

    const { strategy_id, run_id } = parsed.data;
    const thresholds = { ...DEFAULT_THRESHOLDS, ...parsed.data.thresholds };
    const db = getDb();
    const strategy = await db.query.strategies.findFirst({
      where: and(
        eq(strategies.userId, session.user.id),
        eq(strategies.strategyId, strategy_id),
      ),
    });

    if (!strategy) {
      return NextResponse.json(
        { error: `Strategy "${strategy_id}" is not registered.` },
        { status: 404 },
      );
    }

    const localOrders = strategy.agentMode === 'real'
      ? await db.query.realTradeOrders.findMany({
          where: and(
            eq(realTradeOrders.strategyId, strategy.id),
            eq(realTradeOrders.userId, session.user.id),
          ),
        })
      : [];
    const portfolio = await getPortfolio(session.user.id);
    const localSnapshot: LocalSnapshot = {
      cash: portfolio.balance,
      positions_value: portfolio.totalValue - portfolio.balance,
      total_value: portfolio.totalValue,
      pnl: portfolio.totalPnL,
      positions: portfolio.positions,
      orders: localOrders,
      open_orders: localOrders,
    };

    const [snapshot] = await db
      .insert(portfolioSnapshots)
      .values({
        strategyId: strategy.id,
        userId: session.user.id,
        runId: run_id ?? null,
        platform: strategy.platform,
        agentMode: strategy.agentMode,
        source: 'local',
        cash: portfolio.balance.toFixed(2),
        positionsValue: (portfolio.totalValue - portfolio.balance).toFixed(2),
        totalValue: portfolio.totalValue.toFixed(2),
        pnl: portfolio.totalPnL.toFixed(6),
        positions: portfolio.positions,
        orders: localOrders,
      })
      .returning();

    if (strategy.agentMode !== 'real') {
      const [log] = await db
        .insert(reconciliationLogs)
        .values({
          strategyId: strategy.id,
          userId: session.user.id,
          runId: run_id ?? null,
          platform: strategy.platform,
          severity: 'info',
          differenceType: 'unknown',
          officialSnapshot: {},
          localSnapshot,
          diff: {},
          threshold: thresholds,
          message: 'Paper strategy local snapshot captured; official reconciliation is not required.',
        })
        .returning();

      return NextResponse.json({
        reconciled: true,
        strategy_id,
        platform: strategy.platform,
        agent_mode: strategy.agentMode,
        local_snapshot: sanitizePortfolioSnapshot(snapshot),
        official_snapshot: null,
        reconciliation_logs: [sanitizeReconciliationLog(log)],
        differences: [],
        warnings: [],
      });
    }

    if (strategy.platform === 'polymarket') {
      const [log] = await db
        .insert(reconciliationLogs)
        .values({
          strategyId: strategy.id,
          userId: session.user.id,
          runId: run_id ?? null,
          platform: strategy.platform,
          severity: 'warning',
          differenceType: 'unknown',
          officialSnapshot: {},
          localSnapshot,
          diff: {},
          threshold: thresholds,
          message: 'Polymarket International real trading is unsupported; no official reconciliation source is available.',
        })
        .returning();

      return NextResponse.json({
        reconciled: false,
        strategy_id,
        platform: strategy.platform,
        agent_mode: strategy.agentMode,
        local_snapshot: sanitizePortfolioSnapshot(snapshot),
        official_snapshot: null,
        reconciliation_logs: [sanitizeReconciliationLog(log)],
        differences: [],
        warnings: ['Polymarket International real trading is unsupported; official reconciliation is unavailable.'],
      });
    }

    let officialSnapshot: OfficialPortfolioSnapshot;
    try {
      officialSnapshot = await getOfficialPortfolioSnapshot(strategy.platform as 'kalshi' | 'polymarket_us');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const [log] = await db
        .insert(reconciliationLogs)
        .values({
          strategyId: strategy.id,
          userId: session.user.id,
          runId: run_id ?? null,
          platform: strategy.platform,
          severity: 'warning',
          differenceType: 'unknown',
          officialSnapshot: {},
          localSnapshot,
          diff: { error: message },
          threshold: thresholds,
          message: `Official venue snapshot fetch failed: ${message}`,
        })
        .returning();

      return NextResponse.json({
        reconciled: false,
        strategy_id,
        platform: strategy.platform,
        agent_mode: strategy.agentMode,
        local_snapshot: sanitizePortfolioSnapshot(snapshot),
        official_snapshot: null,
        reconciliation_logs: [sanitizeReconciliationLog(log)],
        differences: [{ type: 'unknown', severity: 'warning', message, diff: { error: message } }],
        warnings: [`Official venue snapshot fetch failed: ${message}`],
      }, { status: 502 });
    }

    const [officialSnapshotRow] = await db
      .insert(portfolioSnapshots)
      .values({
        strategyId: strategy.id,
        userId: session.user.id,
        runId: run_id ?? null,
        platform: strategy.platform,
        agentMode: strategy.agentMode,
        source: 'official',
        cash: officialSnapshot.cash.toFixed(2),
        positionsValue: officialSnapshot.positionsValue.toFixed(2),
        totalValue: officialSnapshot.totalValue.toFixed(2),
        pnl: officialSnapshot.pnl.toFixed(6),
        positions: officialSnapshot.positions,
        orders: officialSnapshot.orders,
      })
      .returning();

    const differences = compareSnapshots(localSnapshot, officialSnapshot, thresholds);
    const logInputs = differences.length > 0
      ? differences
      : [{
          type: 'unknown' as const,
          severity: 'info' as const,
          message: 'Official and local portfolio state are within configured reconciliation thresholds.',
          diff: {},
        }];

    const logs = [];
    for (const difference of logInputs) {
      const [log] = await db
        .insert(reconciliationLogs)
        .values({
          strategyId: strategy.id,
          userId: session.user.id,
          runId: run_id ?? null,
          platform: strategy.platform,
          severity: difference.severity,
          differenceType: difference.type,
          officialSnapshot,
          localSnapshot,
          diff: difference.diff,
          threshold: thresholds,
          message: difference.message,
        })
        .returning();
      logs.push(log);
    }

    return NextResponse.json({
      reconciled: differences.every((difference) => difference.severity === 'info'),
      strategy_id,
      platform: strategy.platform,
      agent_mode: strategy.agentMode,
      local_snapshot: sanitizePortfolioSnapshot(snapshot),
      official_snapshot: sanitizePortfolioSnapshot(officialSnapshotRow),
      official: {
        cash: officialSnapshot.cash,
        positions_value: officialSnapshot.positionsValue,
        total_value: officialSnapshot.totalValue,
        pnl: officialSnapshot.pnl,
        positions: officialSnapshot.positions,
        orders: officialSnapshot.orders,
        fills: officialSnapshot.fills,
        activity: officialSnapshot.activity,
      },
      reconciliation_logs: logs.map(sanitizeReconciliationLog),
      differences,
      warnings: differences
        .filter((difference) => difference.severity !== 'info')
        .map((difference) => difference.message),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json(
      { error: 'Internal server error', details: message },
      { status: 500 },
    );
  }
}
