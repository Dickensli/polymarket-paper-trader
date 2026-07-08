import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { auth, resolveTargetUserId } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { strategies, users, portfolios } from '@/lib/db/schema';
import { eq, isNotNull, and } from 'drizzle-orm';
import crypto from 'crypto';

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
          finalBalance = officialSnapshot.cash;
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
          try { await ensureUserColor(db, sessionUser.id); } catch { /* non-fatal */ }
          return NextResponse.json({
            registered: true,
            is_new: false,
            strategy: sanitizeStrategy(existing),
            message: 'Strategy already registered.'
          });
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
            metadata: metadata ?? { registeredAt: new Date().toISOString() },
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
      console.warn('[Register Route] Database transaction failed, returning degraded success for agent:', dbErr);
      return NextResponse.json({
        registered: true,
        is_new: true,
        degraded: true,
        strategy: {
          strategyId: strategy_id,
          platform: platform,
          status: 'active',
          startingBalance: String(balance),
          agentMode: is_paper_trading ? 'paper' : 'real',
        },
        message: 'Strategy registered in degraded mode (Database offline).'
      });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json(
      { error: 'Internal server error', details: message },
      { status: 500 },
    );
  }
}
