import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { and, asc, eq, gte, ne } from 'drizzle-orm';
import { auth, resolveTargetUserId } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { officialOrderEvents, portfolioSnapshots, realTradeOrders, strategies, strategyDecisions } from '@/lib/db/schema';
import { getOfficialPortfolioSnapshot, resolveOfficialOrderQuantity, submitOfficialRealTrade } from '@/lib/official-trading';
import { getKalshiMarket, getKalshiOrderBook, getKalshiOutcomePrice } from '@/lib/kalshi';
import { getPolymarketUsMarket, getPolymarketUsOutcomeOrderBook, getPolymarketUsOutcomePrice } from '@/lib/polymarket-us';
import { simulateBuyFill, simulateBuySharesFill } from '@/lib/orderbook-simulator';
import { tradeProposalSchema, validateTradeProposal } from '@/lib/trade-proposal';
import { getStrategyGraduation } from '@/lib/strategy-graduation';
import { calculateOfficialRiskGroupExposure, isOfficialBuyRiskReducing, validateRealBuyRisk } from '@/lib/real-risk';
import { isPortfolioSnapshotUsableForPerformance } from '@/lib/strategy-snapshot-quality';
import { resolveStrategyExecutionPolicy } from '@/lib/strategy-execution-policy';

const realTradeSchema = z.object({
  strategy_id: z.string().min(1).max(255),
  slug: z.string().min(1).max(500).describe('Market slug, ticker, or venue market id'),
  outcome: z.enum(['YES', 'NO']).default('YES'),
  side: z.enum(['BUY', 'SELL']).default('BUY'),
  amount: z.number().positive().max(100000).optional(),
  shares: z.number().positive().optional(),
  price: z.number().min(0.001).max(0.999).optional(),
  client_order_id: z.string().min(1).max(255).optional(),
  time_in_force: z.enum(['GTC', 'IOC', 'FOK']).optional(),
  run_id: z.string().uuid().optional(),
  proposal: tradeProposalSchema.optional(),
});

function realTradingEnabled(metadata: unknown): boolean {
  if (!metadata || typeof metadata !== 'object') return false;
  const value = (metadata as Record<string, unknown>).real_trading_enabled;
  return value === true;
}

function strategyMetadata(metadata: unknown): Record<string, unknown> {
  return metadata && typeof metadata === 'object' ? metadata as Record<string, unknown> : {};
}

// POST /api/agent/real-trades
//
// Audit-first real trading route. This validates server-side strategy binding,
// persists the official write request, submits through the platform client, and
// captures an official snapshot when the write succeeds.
export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    if (session?.error === 'STRATEGY_NOT_REGISTERED') {
      return NextResponse.json({ error: 'Strategy not registered. Call register_strategy first.' }, { status: 404 });
    }
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const sanitizeRealOrder = (o: Record<string, unknown>) => ({
      platform: o.platform,
      officialOrderId: o.officialOrderId,
      clientOrderId: o.clientOrderId,
      marketId: o.marketId,
      marketSlugOrTicker: o.marketSlugOrTicker,
      side: o.side,
      quantity: o.quantity ? Number(o.quantity) : null,
      price: o.price ? Number(o.price) : null,
      status: o.status,
      request: o.request,
      officialResponse: o.officialResponse,
      error: o.error,
      createdAt: o.createdAt,
      updatedAt: o.updatedAt,
    });

    const parsed = realTradeSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? 'Invalid input' },
        { status: 400 },
      );
    }

    const order = parsed.data;
    if (order.price !== undefined) {
      return NextResponse.json(
        { error: 'Caller-supplied prices are not allowed; real orders use a fresh server executable quote' },
        { status: 400 },
      );
    }
    if (Boolean(order.amount) === Boolean(order.shares)) {
      return NextResponse.json(
        { error: 'Provide exactly one of amount or shares' },
        { status: 400 },
      );
    }
    const db = getDb();
    const strategy = await db.query.strategies.findFirst({
      where: and(
        eq(strategies.userId, session.user.id),
        eq(strategies.strategyId, order.strategy_id),
        eq(strategies.agentMode, 'real'),
      ),
    });

    if (!strategy) {
      return NextResponse.json(
        { error: `Real strategy "${order.strategy_id}" is not registered.` },
        { status: 404 },
      );
    }

    if (strategy.status !== 'active') {
      return NextResponse.json(
        { error: `Strategy is ${strategy.status}. Trading is suspended.` },
        { status: 403 },
      );
    }

    const competingRealStrategy = await db.query.strategies.findFirst({
      where: and(
        eq(strategies.platform, strategy.platform),
        eq(strategies.agentMode, 'real'),
        eq(strategies.status, 'active'),
        ne(strategies.id, strategy.id),
      ),
    });
    if (competingRealStrategy && competingRealStrategy.id !== strategy.id) {
      return NextResponse.json({
        error: 'This deployment uses one shared official venue account. Multiple active real strategies cannot be attributed safely.',
        code: 'SHARED_ACCOUNT_STRATEGY_AMBIGUITY',
      }, { status: 409 });
    }

    if (strategy.platform === 'polymarket') {
      const [audit] = await db
        .insert(realTradeOrders)
        .values({
          strategyId: strategy.id,
          userId: session.user.id,
          runId: order.run_id ?? null,
          platform: strategy.platform,
          clientOrderId: order.client_order_id ?? null,
          marketSlugOrTicker: order.slug,
          side: order.side,
          quantity: order.shares?.toFixed(6) ?? null,
          price: null,
          status: 'REJECTED',
          request: order,
          error: { code: 'UNSUPPORTED_PLATFORM', message: 'Polymarket International real trading is out of scope.' },
        })
        .returning();

      return NextResponse.json(
        { error: 'Polymarket International real trading is not supported.', audit: sanitizeRealOrder(audit) },
        { status: 400 },
      );
    }

    let executionPrice: number | undefined;
    let executableDepth = 0;
    let shadowFill: Record<string, unknown> | null = null;
    let riskGroupId = order.slug;
    if (!executionPrice) {
      if (strategy.platform === 'kalshi') {
        const market = await getKalshiMarket(order.slug).catch(() => null);
        const status = String(market?.status ?? '').toLowerCase();
        if (!market || (status !== 'open' && status !== 'active')) {
          return NextResponse.json({ error: 'Kalshi market not found or not tradable' }, { status: 400 });
        }
        riskGroupId = String(market.event_ticker ?? market.eventTicker ?? order.slug);
        if (order.side === 'BUY') {
          const book = await getKalshiOrderBook(order.slug, order.outcome).catch(() => null);
          if (book) {
            executableDepth = book.asks.reduce((sum, level) => sum + level.size, 0);
            const fill = order.shares
              ? simulateBuySharesFill(book, order.shares, 0, 'FOK')
              : simulateBuyFill(book, order.amount ?? 0, 0, 'FOK');
            if (fill.success) {
              executionPrice = fill.avgPrice;
              shadowFill = fill as unknown as Record<string, unknown>;
            }
          }
        } else {
          executionPrice = await getKalshiOutcomePrice(order.slug, order.outcome, order.side).catch(() => null) ?? undefined;
        }
      } else {
        const market = await getPolymarketUsMarket(order.slug).catch(() => null);
        if (!market || market.closed || market.active === false) {
          return NextResponse.json({ error: 'Polymarket US market not found or not tradable' }, { status: 400 });
        }
        riskGroupId = String(market.eventSlug ?? order.slug);
        if (order.side === 'BUY') {
          const book = await getPolymarketUsOutcomeOrderBook(order.slug, order.outcome).catch(() => null);
          if (book) {
            executableDepth = book.asks.reduce((sum, level) => sum + level.size, 0);
            const fill = order.shares
              ? simulateBuySharesFill(book, order.shares, 0, 'FOK')
              : simulateBuyFill(book, order.amount ?? 0, 0, 'FOK');
            if (fill.success) {
              executionPrice = fill.avgPrice;
              shadowFill = fill as unknown as Record<string, unknown>;
            }
          }
        } else {
          executionPrice = await getPolymarketUsOutcomePrice(order.slug, order.outcome, order.side).catch(() => null) ?? undefined;
        }
      }
      if (!executionPrice || executionPrice <= 0 || executionPrice >= 1) {
        return NextResponse.json(
          { error: `No executable ${order.side} quote is available for this real market order` },
          { status: 409 },
        );
      }
    }
    const resolvedQuantity = resolveOfficialOrderQuantity({ ...order, price: executionPrice });
    const auditedOrder = {
      ...order,
      price: executionPrice,
      price_source: 'server_executable_quote',
    };

    const enabled = realTradingEnabled(strategy.metadata);
    if (!enabled) {
      const [audit] = await db
        .insert(realTradeOrders)
        .values({
          strategyId: strategy.id,
          userId: session.user.id,
          runId: order.run_id ?? null,
          platform: strategy.platform,
          clientOrderId: order.client_order_id ?? null,
          marketSlugOrTicker: order.slug,
          side: order.side,
          quantity: resolvedQuantity.toFixed(6),
          price: executionPrice.toFixed(6),
          status: 'REJECTED',
          request: auditedOrder,
          error: { code: 'REAL_TRADING_DISABLED', message: 'Strategy metadata.real_trading_enabled must be true.' },
        })
        .returning();

      return NextResponse.json(
        {
          error: 'Real trading is disabled for this strategy.',
          audit: sanitizeRealOrder(audit),
        },
        { status: 403 },
      );
    }

    const metadata = strategyMetadata(strategy.metadata);
    const executionPolicy = resolveStrategyExecutionPolicy(
      strategy.platform,
      strategy.agentMode,
      strategy.strategyId,
    );
    const officialSnapshotForBuy = order.side === 'BUY'
      ? await getOfficialPortfolioSnapshot(strategy.platform as 'kalshi' | 'polymarket_us')
      : null;
    const riskReducingBuy = order.side === 'BUY' && officialSnapshotForBuy
      ? isOfficialBuyRiskReducing(officialSnapshotForBuy.positions, order.slug, order.outcome, resolvedQuantity)
      : false;
    if (order.side === 'BUY' && !riskReducingBuy && metadata.require_shadow_graduation === true) {
      const accountId = request.headers.get('x-agent-account-id');
      const sourceStrategyId = String(metadata.graduation_source_strategy_id ?? '');
      const sourceUserId = accountId && sourceStrategyId
        ? resolveTargetUserId(accountId, sourceStrategyId, strategy.platform)
        : null;
      const sourceStrategy = sourceUserId ? await db.query.strategies.findFirst({
        where: and(
          eq(strategies.userId, sourceUserId),
          eq(strategies.strategyId, sourceStrategyId),
          eq(strategies.agentMode, 'paper'),
          eq(strategies.platform, strategy.platform),
        ),
      }) : null;
      const graduation = sourceStrategy ? await getStrategyGraduation(sourceStrategy) : null;
      if (!graduation?.graduated) {
        await db.insert(strategyDecisions).values({
          strategyId: strategy.id, userId: session.user.id, runId: order.run_id ?? null,
          platform: strategy.platform, agentMode: strategy.agentMode, marketId: order.slug,
          outcome: order.outcome, side: order.side, proposal: order.proposal ?? {},
          serverQuote: { graduation }, status: 'REJECTED',
          rejectionReasons: ['SHADOW_GRADUATION_REQUIRED'],
        });
        return NextResponse.json({
          error: 'Shadow graduation criteria have not passed. New real-money risk is blocked.',
          code: 'SHADOW_GRADUATION_REQUIRED',
          graduation,
        }, { status: 403 });
      }
    }

    let acceptedDecisionId: string | null = null;
    if (order.side === 'BUY') {
      const officialSnapshot = officialSnapshotForBuy!;
      const dayStart = new Date();
      dayStart.setUTCHours(0, 0, 0, 0);
      const [snapshots, dailyOrders] = await Promise.all([
        db.query.portfolioSnapshots.findMany({
          where: eq(portfolioSnapshots.strategyId, strategy.id),
          orderBy: [asc(portfolioSnapshots.capturedAt)],
        }),
        db.query.realTradeOrders.findMany({
          where: and(
            eq(realTradeOrders.strategyId, strategy.id),
            gte(realTradeOrders.createdAt, dayStart),
          ),
        }),
      ]);
      const validNavs = snapshots
        .filter(isPortfolioSnapshotUsableForPerformance)
        .map((snapshot) => Number(snapshot.totalValue))
        .filter(Number.isFinite);
      const todayNavs = snapshots
        .filter((snapshot) => snapshot.capturedAt >= dayStart && isPortfolioSnapshotUsableForPerformance(snapshot))
        .map((snapshot) => Number(snapshot.totalValue))
        .filter(Number.isFinite);
      const dailyStartNav = todayNavs[0] ?? officialSnapshot.totalValue;
      const peakNav = Math.max(Number(strategy.startingBalance || 0), officialSnapshot.totalValue, ...validNavs);
      const dailyBuyTrades = dailyOrders.filter((candidate) => (
        candidate.side === 'BUY'
        && !['REJECTED', 'ERROR', 'CANCELLED', 'CANCELED'].includes(String(candidate.status).toUpperCase())
      )).length;
      const runBuyTrades = order.run_id ? dailyOrders.filter((candidate) => (
        candidate.runId === order.run_id
        && candidate.side === 'BUY'
        && !['REJECTED', 'ERROR', 'CANCELLED', 'CANCELED'].includes(String(candidate.status).toUpperCase())
      )).length : 0;
      const riskError = riskReducingBuy ? null : (
        (officialSnapshot.unpricedPositionsCount ?? 0) > 0
          ? 'Cannot add real-money risk while one or more official positions are unpriced'
          : validateRealBuyRisk({
              nav: officialSnapshot.totalValue,
              cash: officialSnapshot.cash,
              notional: resolvedQuantity * executionPrice,
              existingRiskGroupExposure: calculateOfficialRiskGroupExposure(
                officialSnapshot.positions,
                riskGroupId,
                order.slug,
              ),
              dailyStartNav,
              peakNav,
              dailyBuyTrades,
              riskConfig: strategy.riskConfig,
              maxDailyBuyTrades: executionPolicy.maxDailyBuyTrades,
              runBuyTrades,
              maxRunBuyTrades: executionPolicy.maxBuyTradesPerRun,
            })
      );
      if (riskError) {
        const [audit] = await db.insert(realTradeOrders).values({
          strategyId: strategy.id, userId: session.user.id, runId: order.run_id ?? null,
          platform: strategy.platform, clientOrderId: order.client_order_id ?? null,
          marketSlugOrTicker: order.slug, side: order.side,
          quantity: resolvedQuantity.toFixed(6), price: executionPrice.toFixed(6),
          status: 'REJECTED', request: auditedOrder,
          error: { code: 'SERVER_RISK_REJECTED', message: riskError },
        }).returning();
        await db.insert(strategyDecisions).values({
          strategyId: strategy.id, userId: session.user.id, runId: order.run_id ?? null,
          platform: strategy.platform, agentMode: strategy.agentMode, marketId: order.slug,
          outcome: order.outcome, side: order.side, proposal: order.proposal ?? {},
          serverQuote: { executable_price: executionPrice, risk_group_id: riskGroupId },
          status: 'REJECTED', rejectionReasons: ['SERVER_RISK_REJECTED'],
        });
        return NextResponse.json({
          error: riskError,
          code: 'SERVER_RISK_REJECTED',
          audit: sanitizeRealOrder(audit),
        }, { status: 403 });
      }

      const validation = riskReducingBuy
        ? { valid: true, reasons: [] as string[] }
        : order.proposal
        ? validateTradeProposal(order.proposal, {
            executablePrice: executionPrice,
            executableDepth,
            requestedShares: resolvedQuantity,
            requestedNotional: resolvedQuantity * executionPrice,
            portfolioNav: officialSnapshot.totalValue,
            minimumNetEdge: executionPolicy.minimumNetEdge,
          })
        : { valid: false, reasons: ['MISSING_STRUCTURED_PROPOSAL'] };
      if (!shadowFill) validation.reasons.push('INSUFFICIENT_EXECUTABLE_DEPTH');
      if (validation.reasons.length > 0) validation.valid = false;
      const [decision] = await db.insert(strategyDecisions).values({
        strategyId: strategy.id, userId: session.user.id, runId: order.run_id ?? null,
        platform: strategy.platform, agentMode: strategy.agentMode, marketId: order.slug,
        outcome: order.outcome, side: order.side, proposal: order.proposal ?? {},
        serverQuote: {
          executable_price: executionPrice,
          executable_depth: executableDepth,
          shadow_fill: shadowFill,
          risk_reducing_buy: riskReducingBuy,
        },
        status: validation.valid ? 'ACCEPTED' : 'REJECTED', rejectionReasons: validation.reasons,
      }).returning();
      if (!validation.valid) {
        return NextResponse.json({
          error: 'Structured trade proposal failed server validation',
          code: 'PROPOSAL_REJECTED', reasons: validation.reasons,
        }, { status: 422 });
      }
      acceptedDecisionId = decision?.id ?? null;
    }

    const [audit] = await db
      .insert(realTradeOrders)
      .values({
        strategyId: strategy.id,
        userId: session.user.id,
        runId: order.run_id ?? null,
        platform: strategy.platform,
        clientOrderId: order.client_order_id ?? null,
        marketSlugOrTicker: order.slug,
        side: order.side,
        quantity: resolvedQuantity.toFixed(6),
        price: executionPrice.toFixed(6),
        status: 'SUBMITTING',
        request: auditedOrder,
      })
      .returning();

    if (acceptedDecisionId) {
      await db.update(strategyDecisions).set({ realTradeOrderId: audit.id })
        .where(eq(strategyDecisions.id, acceptedDecisionId));
    }

    const writeLifecycleEvent = async (status: string, officialOrderId: string, payload: Record<string, unknown>, filled = 0, remaining = resolvedQuantity) => {
      const occurredAt = new Date();
      await db.insert(officialOrderEvents).values({
        realTradeOrderId: audit.id, strategyId: strategy.id, userId: session.user.id,
        platform: strategy.platform, officialOrderId,
        eventKey: `${strategy.platform}:${officialOrderId}:${status}:${occurredAt.toISOString()}`,
        status, requestedQuantity: resolvedQuantity.toFixed(6), filledQuantity: filled.toFixed(6),
        remainingQuantity: remaining.toFixed(6), occurredAt, payload,
      }).returning();
    };
    await writeLifecycleEvent('SUBMITTING', `local:${audit.id}`, auditedOrder);

    try {
      const official = await submitOfficialRealTrade({
        platform: strategy.platform as 'kalshi' | 'polymarket_us',
        slug: order.slug,
        outcome: order.outcome,
        side: order.side,
        amount: order.amount,
        shares: order.shares,
        price: executionPrice,
        clientOrderId: order.client_order_id,
        timeInForce: order.time_in_force,
      });

      const [updatedAudit] = await db
        .update(realTradeOrders)
        .set({
          officialOrderId: official.officialOrderId,
          clientOrderId: official.clientOrderId,
          status: official.status,
          request: auditedOrder,
          officialResponse: {
            ...official.response,
            submitted_request: official.request,
          },
          error: {},
          updatedAt: new Date(),
        })
        .where(eq(realTradeOrders.id, audit.id))
        .returning();
      const executions = Array.isArray(official.response.executions)
        ? official.response.executions.filter((value): value is Record<string, unknown> => Boolean(value && typeof value === 'object'))
        : [];
      const executionFilled = executions.reduce((sum, execution) => sum + Number(execution.lastShares ?? 0), 0);
      const latestExecutionOrder = executions.at(-1)?.order;
      const latestLeavesQuantity = latestExecutionOrder && typeof latestExecutionOrder === 'object'
        ? Number((latestExecutionOrder as Record<string, unknown>).leavesQuantity)
        : NaN;
      const immediateFilled = Number(
        official.response.fill_count
        ?? official.response.fill_count_fp
        ?? official.response.filledQuantity
        ?? executionFilled,
      );
      const immediateRemaining = Number(
        official.response.remaining_count
        ?? official.response.remaining_count_fp
        ?? official.response.remainingQuantity
        ?? (Number.isFinite(latestLeavesQuantity) ? latestLeavesQuantity : Math.max(0, resolvedQuantity - immediateFilled)),
      );
      await writeLifecycleEvent(official.status, official.officialOrderId ?? `local:${audit.id}`, {
        ...official.response, submitted_request: official.request,
      }, Number.isFinite(immediateFilled) ? immediateFilled : 0, Number.isFinite(immediateRemaining) ? immediateRemaining : resolvedQuantity);

      return NextResponse.json({
        data: sanitizeRealOrder(updatedAudit),
        official_order: official,
        portfolio_sync: 'pending_next_context_refresh',
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const [updatedAudit] = await db
        .update(realTradeOrders)
        .set({
          status: 'ERROR',
          error: { code: 'OFFICIAL_TRADE_FAILED', message },
          updatedAt: new Date(),
        })
        .where(eq(realTradeOrders.id, audit.id))
        .returning();
      await writeLifecycleEvent('ERROR', `local:${audit.id}`, { message });

      return NextResponse.json(
        {
          error: 'Official real trade failed.',
          details: message,
          audit: sanitizeRealOrder(updatedAudit),
        },
        { status: 502 },
      );
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json(
      { error: 'Internal server error', details: message },
      { status: 500 },
    );
  }
}
