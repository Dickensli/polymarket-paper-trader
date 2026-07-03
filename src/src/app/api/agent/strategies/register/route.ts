import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { auth } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { strategies } from '@/lib/db/schema';
import { eq, and } from 'drizzle-orm';

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const registerSchema = z.object({
  strategy_name: z.string().min(1).max(255),
  agent_mode: z.enum(['paper', 'real']).default('paper'),
  platform: z.enum(['polymarket', 'kalshi', 'polymarket_us']).default('polymarket'),
  starting_balance: z.number().positive().max(1_000_000).optional().default(10000),
  risk_config: z.record(z.string(), z.unknown()).optional(),
  schedule: z.string().max(100).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

// ---------------------------------------------------------------------------
// POST /api/agent/strategies/register
//
// Idempotent: creates a strategy if it doesn't exist, returns the existing
// one if it does. Never throws on repeated calls — this is by design to
// protect against stateless polling agents calling register every run.
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

    const { strategy_name, agent_mode, platform, starting_balance, risk_config, schedule, metadata } = parsed.data;
    const db = getDb();

    // Check if strategy already exists for this exact (name, mode, platform) triple
    const existing = await db.query.strategies.findFirst({
      where: and(
        eq(strategies.strategyName, strategy_name),
        eq(strategies.agentMode, agent_mode),
        eq(strategies.platform, platform),
      ),
    });

    if (existing) {
      // Idempotent: return the existing strategy without modification
      return NextResponse.json({
        registered: true,
        is_new: false,
        strategy: {
          id: existing.id,
          strategy_name: existing.strategyName,
          agent_mode: existing.agentMode,
          platform: existing.platform,
          status: existing.status,
          starting_balance: Number(existing.startingBalance),
          risk_config: existing.riskConfig,
          schedule: existing.schedule,
          created_at: existing.createdAt,
        },
        message: 'Strategy already registered. No changes made. Proceed to trading.',
      });
    }

    // Create new strategy
    const [created] = await db.insert(strategies).values({
      userId: session.user.id,
      strategyName: strategy_name,
      agentMode: agent_mode,
      platform: platform,
      startingBalance: String(starting_balance),
      riskConfig: risk_config ?? {},
      schedule: schedule ?? null,
      metadata: metadata ?? {},
    }).returning();

    return NextResponse.json({
      registered: true,
      is_new: true,
      strategy: {
        id: created.id,
        strategy_name: created.strategyName,
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
