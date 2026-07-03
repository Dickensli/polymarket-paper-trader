import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';

/**
 * Backtest API — server-side "what-if" trade replay engine.
 *
 * POST /api/backtest
 * Body: {
 *   platform: "polymarket" | "kalshi",
 *   trades: [{ market, outcome, side?, amount, entry_price, exit_price }],
 *   starting_balance?: number (default 10000)
 * }
 *
 * Returns simulated performance metrics: P&L, ROI, Sharpe, win rate, max drawdown.
 */

interface BacktestTrade {
  market: string;
  outcome: string;
  side?: string;
  amount: number;
  entry_price: number;
  exit_price: number;
}

interface TradeResult {
  market: string;
  outcome: string;
  side: string;
  amount: number;
  entry_price: number;
  exit_price: number;
  shares: number;
  exit_value: number;
  pnl: number;
  roi_pct: number;
  won: boolean;
}

export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const {
      platform = 'polymarket',
      trades,
      starting_balance: startingBalance = 10000,
    } = body as {
      platform?: string;
      trades?: BacktestTrade[];
      starting_balance?: number;
    };

    if (!trades || !Array.isArray(trades) || trades.length === 0) {
      return NextResponse.json(
        { error: 'trades must be a non-empty array' },
        { status: 400 },
      );
    }

    // Validate each trade
    for (const t of trades) {
      if (
        !t.market ||
        t.amount == null ||
        t.entry_price == null ||
        t.exit_price == null
      ) {
        return NextResponse.json(
          {
            error:
              'Each trade must have: market, amount, entry_price, exit_price',
          },
          { status: 400 },
        );
      }
      if (
        t.entry_price <= 0 ||
        t.entry_price >= 1 ||
        t.exit_price <= 0 ||
        t.exit_price >= 1
      ) {
        return NextResponse.json(
          { error: 'entry_price and exit_price must be between 0 and 1 (exclusive)' },
          { status: 400 },
        );
      }
    }

    // ── Simulate trades ──────────────────────────────────────────────
    const tradeResults: TradeResult[] = [];
    let cash = startingBalance;
    let peak = startingBalance;
    let maxDrawdown = 0;
    const dailyPnls: number[] = [];

    for (const t of trades) {
      const side = (t.side || 'BUY').toUpperCase();
      const shares = t.amount / t.entry_price;
      const exitValue = shares * t.exit_price;
      const pnl = side === 'BUY' ? exitValue - t.amount : t.amount - exitValue;
      const roiPct = (pnl / t.amount) * 100;
      const won = pnl > 0;

      tradeResults.push({
        market: t.market,
        outcome: t.outcome || 'YES',
        side,
        amount: t.amount,
        entry_price: t.entry_price,
        exit_price: t.exit_price,
        shares: round(shares, 4),
        exit_value: round(exitValue, 2),
        pnl: round(pnl, 2),
        roi_pct: round(roiPct, 2),
        won,
      });

      // Update running cash
      cash += pnl;
      dailyPnls.push(pnl);

      // Track drawdown
      if (cash > peak) peak = cash;
      if (peak > 0) {
        const dd = (peak - cash) / peak;
        if (dd > maxDrawdown) maxDrawdown = dd;
      }
    }

    // ── Aggregate metrics ────────────────────────────────────────────
    const totalPnl = round(cash - startingBalance, 2);
    const roiPct = round((totalPnl / startingBalance) * 100, 2);
    const wins = tradeResults.filter((r) => r.won).length;
    const winRate = tradeResults.length > 0 ? round(wins / tradeResults.length, 4) : 0;

    // Sharpe ratio (annualized, treating each trade as a "period")
    let sharpe = 0;
    if (dailyPnls.length >= 2) {
      const returns = dailyPnls.map((p) => p / startingBalance);
      const meanRet = returns.reduce((a, b) => a + b, 0) / returns.length;
      const variance =
        returns.reduce((a, b) => a + (b - meanRet) ** 2, 0) /
        (returns.length - 1);
      const stdRet = Math.sqrt(variance);
      if (stdRet > 0) {
        sharpe = round((meanRet / stdRet) * Math.sqrt(365), 4);
      }
    }

    const result = {
      platform,
      starting_balance: startingBalance,
      ending_value: round(cash, 2),
      pnl: totalPnl,
      roi_pct: roiPct,
      total_trades: tradeResults.length,
      win_count: wins,
      loss_count: tradeResults.length - wins,
      win_rate: winRate,
      sharpe_ratio: sharpe,
      max_drawdown: round(maxDrawdown, 4),
      trade_results: tradeResults,
    };

    return NextResponse.json({ data: result });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json(
      { error: 'Internal server error', details: message },
      { status: 500 },
    );
  }
}

function round(n: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(n * factor) / factor;
}
