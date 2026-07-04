import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { auth, resolveTargetUserId } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { strategies } from '@/lib/db/schema';
import { eq, and } from 'drizzle-orm';

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
// POST /api/agent/strategies/register
//
// Idempotent: creates a strategy if it doesn't exist, returns the existing
// one if it does. Never throws on repeated calls.
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

    // Verify that the session user ID matches the deterministic UUID for this account_id + strategy_id
    const expectedUserId = resolveTargetUserId(account_id, strategy_id, platform);
    if (session.user.id !== expectedUserId) {
      return NextResponse.json(
        { error: 'Forbidden: account_id or strategy_id does not match authentication headers' },
        { status: 403 },
      );
    }

    const db = getDb();
    const agentMode = is_paper_trading ? 'paper' : 'real';

    const existing = await db.query.strategies.findFirst({
      where: eq(strategies.userId, session.user.id),
    });

    if (existing) {
      return NextResponse.json({
        registered: true,
        is_new: false,
        strategy: {
          id: existing.id,
          strategy_id: existing.strategyId,
          agent_mode: existing.agentMode,
          platform: existing.platform,
          status: existing.status,
          starting_balance: Number(existing.startingBalance),
          risk_config: existing.riskConfig,
          schedule: existing.schedule,
          created_at: existing.createdAt,
        },
        message: 'Strategy already registered. Proceed to trading.',
      });
    }

    // Create new strategy
    const [created] = await db.insert(strategies).values({
      userId: session.user.id,
      strategyId: strategy_id,
      agentMode: agentMode,
      platform: platform,
      startingBalance: String(balance),
      riskConfig: risk_config ?? {},
      schedule: schedule ?? null,
      metadata: metadata ?? {},
    }).returning();

    return NextResponse.json({
      registered: true,
      is_new: true,
      strategy: {
        id: created.id,
        strategy_id: created.strategyId,
        agent_mode: created.agentMode,
        platform: created.platform,
        status: created.status,
        starting_balance: Number(created.startingBalance),
        risk_config: created.riskConfig,
        schedule: created.schedule,
        created_at: created.createdAt,
      },
    }, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json(
      { error: 'Internal server error', details: message },
      { status: 500 },
    );
  }
}
