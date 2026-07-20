import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { auth, resolveTargetUserId } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { strategies, users, portfolios } from '@/lib/db/schema';
import { eq, isNotNull, and } from 'drizzle-orm';
import crypto from 'crypto';
import { buildInitialStrategyMetadata, existingStrategyUpdate } from '@/lib/strategy-registration-policy';

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const registerSchema = z.object({
  strategy_id: z.string().min(1).max(255),
  account_id: z.string().min(1).max(255),
  is_paper_trading: z.boolean().default(true),
  platform: z.enum(['polymarket', 'kalshi', 'polymarket_us']).default('polymarket'),
  balance: z.number().positive().max(1_000_000).optional().default(10000),
  risk_config: z.record(z.string(), z.unknown()).optional(),
  schedule: z.string().max(100).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

// ---------------------------------------------------------------------------
// Color palette for leaderboard chart lines
// ---------------------------------------------------------------------------

const STRATEGY_COLOR_PALETTE = [
  '#5AC8FA', '#30D158', '#BF5AF2', '#FF9F0A',
  '#FF453A', '#64D2FF', '#FF6482', '#FFD60A',
  '#AC8E68', '#00C7BE', '#5E5CE6', '#FF2D55',
  '#34C759', '#AF52DE', '#FF6B35', '#32ADE6',
];

/** Assign a persistent leaderboard color if the user doesn't have one yet. */
async function ensureUserColor(db: ReturnType<typeof getDb>, userId: string) {
  const user = await db.query.users.findFirst({
    where: eq(users.id, userId),
    columns: { color: true },
  });
  if (user?.color) return;

  const usedRows = await db
    .select({ color: users.color })
    .from(users)
    .where(isNotNull(users.color));
  const usedColors = new Set(usedRows.map((r) => r.color));

  let color = STRATEGY_COLOR_PALETTE.find((c) => !usedColors.has(c));
  if (!color) {
    // Deterministic fallback from userId hash
    const hash = crypto.createHash('md5').update(userId).digest('hex');
    color = `#${hash.slice(0, 6)}`;
  }

  await db.update(users).set({ color }).where(eq(users.id, userId));
}

// ---------------------------------------------------------------------------
// POST /api/agent/strategies/register
// ---------------------------------------------------------------------------

export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const parsed = registerSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? 'Invalid input' },
        { status: 400 },
      );
    }

    const { strategy_id, account_id, is_paper_trading, platform, balance, risk_config, schedule, metadata } = parsed.data;

    // Verify deterministic identity
    const sessionUser = (session as any).user || (session as any).proposedUser;
    if (!sessionUser?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const expectedUserId = resolveTargetUserId(account_id, strategy_id, platform);
    if (sessionUser.id !== expectedUserId) {
      return NextResponse.json({ 
        error: 'Forbidden: Identity mismatch'
      }, { status: 403 });
    }

    const sanitizeStrategy = (s: any) => ({
      strategyId: s.strategyId,
      platform: s.platform,
      status: s.status,
      startingBalance: s.startingBalance,
      agentMode: s.agentMode,
    });

    try {
      const db = getDb();
      
      let finalBalance = balance;
      if (!is_paper_trading) {
        try {
          const { getOfficialPortfolioSnapshot } = await import('@/lib/official-trading');
          const venue = platform === 'polymarket_us' ? 'polymarket_us' : 'kalshi';
          const officialSnapshot = await getOfficialPortfolioSnapshot(venue);
          // A real strategy starts from full account equity. Using cash alone
          // would misclassify pre-existing position value as future profit.
          finalBalance = officialSnapshot.totalValue;
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          console.warn('[Register Strategy] Failed to fetch real initial balance:', message);
          return NextResponse.json(
            { error: 'Failed to fetch official account balance for real trading strategy', details: message },
            { status: 502 }
          );
        }
      }
      // If session had no error, the user already exists. Check if strategy is already registered.
      if (!session.error) {
        const existing = await db.query.strategies.findFirst({
          where: and(
            eq(strategies.userId, sessionUser.id),
            eq(strategies.strategyId, strategy_id),
          ),
        });

        if (existing) {
          const requestedMode = is_paper_trading ? 'paper' : 'real';
          if (existing.platform !== platform || existing.agentMode !== requestedMode) {
            return NextResponse.json({
              error: 'Existing strategy venue and trading mode are immutable',
            }, { status: 409 });
          }
          let current = existing;
          const invalidStartingBalance = !Number.isFinite(Number(existing.startingBalance)) || Number(existing.startingBalance) <= 0;
          let repairedStartingBalance = finalBalance;
          if (invalidStartingBalance && is_paper_trading) {
            const existingPortfolio = await db.query.portfolios.findFirst({
              where: eq(portfolios.userId, sessionUser.id),
            });
            const portfolioBaseline = Number(existingPortfolio?.initialBalance);
            if (Number.isFinite(portfolioBaseline) && portfolioBaseline > 0) repairedStartingBalance = portfolioBaseline;
          }
          const safeUpdate = existingStrategyUpdate(existing, {
            riskConfig: risk_config,
            metadata,
            schedule,
          });
          if (Object.keys(safeUpdate).length > 0 || invalidStartingBalance) {
            const [updated] = await db.update(strategies).set({
              ...(invalidStartingBalance ? { startingBalance: repairedStartingBalance.toFixed(2) } : {}),
              ...safeUpdate,
              updatedAt: new Date(),
            }).where(eq(strategies.id, existing.id)).returning();
            current = updated ?? existing;
          }
          try { await ensureUserColor(db, sessionUser.id); } catch { /* non-fatal */ }
          return NextResponse.json({
            registered: true,
            is_new: false,
            strategy: sanitizeStrategy(current),
            message: 'Strategy already registered; schedule synchronized. Risk and security configuration are immutable.'
          });
        }
      }

      if (!is_paper_trading) {
        const competingRealStrategy = await db.query.strategies.findFirst({
          where: and(
            eq(strategies.platform, platform),
            eq(strategies.agentMode, 'real'),
            eq(strategies.status, 'active'),
          ),
        });
        if (competingRealStrategy) {
          return NextResponse.json({
            error: 'A real strategy already owns this deployment\'s shared official venue account.',
            code: 'SHARED_ACCOUNT_STRATEGY_AMBIGUITY',
          }, { status: 409 });
        }
      }

      // Transactional creation of User, Portfolio, and Strategy
      const result = await db.transaction(async (tx) => {
        // Ensure user row exists
        let dbUser = await tx.query.users.findFirst({ where: eq(users.id, expectedUserId) });
        if (!dbUser) {
          const cleanAccount = strategy_id.replace(/[^a-zA-Z0-9_-]/g, '_');
          const isUuid = (val: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(val);
          let rawAgentName = isUuid(account_id) ? 'AI Agent' : account_id;
          let strategyName = strategy_id.startsWith(rawAgentName) ? strategy_id : `${rawAgentName}("${strategy_id}")`;
          let strategyEmail = `agent+${platform}+${rawAgentName.replace(/\s+/g, '_')}+${cleanAccount}@polymarkettraders.com`;

          await tx.insert(users).values({
            id: expectedUserId,
            email: strategyEmail,
            name: strategyName,
            settings: { strategyId: strategy_id, platform, defaultTradeSize: 100, slippageEnabled: false, slippageBps: 50, theme: "system" }
          });
        }

        // Ensure portfolio exists
        let dbPort = await tx.query.portfolios.findFirst({ where: eq(portfolios.userId, expectedUserId) });
        if (!dbPort) {
          await tx.insert(portfolios).values({
            id: crypto.randomUUID(),
            userId: expectedUserId,
            balance: String(finalBalance),
            initialBalance: String(finalBalance)
          });
        }

        // Ensure strategy exists
        let strat = await tx.query.strategies.findFirst({
          where: and(
            eq(strategies.userId, expectedUserId),
            eq(strategies.strategyId, strategy_id)
          )
        });

        if (!strat) {
          [strat] = await tx.insert(strategies).values({
            id: crypto.randomUUID(),
            userId: expectedUserId,
            strategyId: strategy_id,
            agentMode: is_paper_trading ? 'paper' : 'real',
            platform: platform,
            startingBalance: String(finalBalance),
            riskConfig: risk_config ?? {},
            schedule: schedule ?? null,
            metadata: buildInitialStrategyMetadata(is_paper_trading ? 'paper' : 'real', metadata),
          }).returning();
        }

        return strat;
      });

      try { await ensureUserColor(db, expectedUserId); } catch { /* non-fatal */ }

      return NextResponse.json({
        registered: true,
        is_new: true,
        strategy: sanitizeStrategy(result),
        message: 'Strategy registered successfully.'
      }, { status: 201 });

    } catch (dbErr) {
      // Never claim registration succeeded when its durable identity and risk
      // configuration were not committed.
      console.error('[Register Route] Database transaction failed:', dbErr);
      throw dbErr;
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json(
      { error: 'Internal server error', details: message },
      { status: 500 },
    );
  }
}
