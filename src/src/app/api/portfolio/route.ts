// =============================================================================
// /api/portfolio — Portfolio management
// =============================================================================

import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import {
  getPortfolio,
  resetPortfolio,
} from '@/lib/trading-engine';

// ---------------------------------------------------------------------------
// GET /api/portfolio — Current portfolio snapshot
// ---------------------------------------------------------------------------

/**
 * Get the current portfolio including balance, positions, trade history,
 * and calculated P&L.
 */
export async function GET() {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const portfolio = await getPortfolio(session.user.id);
    return NextResponse.json({ data: portfolio });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json(
      { error: 'Internal server error', details: message },
      { status: 500 },
    );
  }
}

// ---------------------------------------------------------------------------
// DELETE /api/portfolio — Reset portfolio
// ---------------------------------------------------------------------------

/**
 * Reset the portfolio to its initial state ($10,000 balance, no positions,
 * no trade history).
 *
 * Returns the fresh portfolio.
 */
export async function DELETE() {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const portfolio = await resetPortfolio(session.user.id);
    return NextResponse.json({
      data: portfolio,
      message: 'Portfolio has been reset to initial state.',
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json(
      { error: 'Internal server error', details: message },
      { status: 500 },
    );
  }
}
