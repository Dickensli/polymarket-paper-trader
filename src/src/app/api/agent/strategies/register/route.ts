import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { auth, resolveTargetUserId } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { strategies } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
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
