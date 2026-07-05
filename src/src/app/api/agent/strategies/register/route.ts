import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { auth, resolveTargetUserId } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { strategies, users } from '@/lib/db/schema';
import { eq, isNotNull } from 'drizzle-orm';
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
    if (!session?.user?.id) {
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
    const expectedUserId = resolveTargetUserId(account_id, strategy_id, platform);
    if (session.user.id !== expectedUserId) {
      return NextResponse.json({ 
        error: 'Forbidden: Identity mismatch', 
        expected: expectedUserId, 
        actual: session.user.id 
      }, { status: 403 });
    }

    try {
      const db = getDb();
      const existing = await db.query.strategies.findFirst({
        where: eq(strategies.userId, session.user.id),
      });

      if (existing) {
        try { await ensureUserColor(db, session.user.id); } catch { /* non-fatal */ }
        return NextResponse.json({
          registered: true,
          is_new: false,
          strategy: existing,
          message: 'Strategy already registered.'
        });
      }

      const [created] = await db.insert(strategies).values({
        id: crypto.randomUUID(),
        userId: session.user.id,
        strategyId: strategy_id,
        agentMode: is_paper_trading ? 'paper' : 'real',
        platform: platform,
        startingBalance: String(balance),
        riskConfig: risk_config ?? {},
        schedule: schedule ?? null,
        metadata: metadata ?? { registeredAt: new Date().toISOString() },
      }).returning();

      try { await ensureUserColor(db, session.user.id); } catch { /* non-fatal */ }

      return NextResponse.json({
        registered: true,
        is_new: true,
        strategy: created,
        message: 'Strategy registered successfully.'
      }, { status: 201 });

    } catch (dbErr) {
      console.warn('[Register Route] Database unavailable, returning degraded success for agent:', dbErr);
      return NextResponse.json({
        registered: true,
        is_new: true,
        degraded: true,
        strategy: {
          userId: session.user.id,
          strategyId: strategy_id,
          status: 'active',
          startingBalance: String(balance),
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
