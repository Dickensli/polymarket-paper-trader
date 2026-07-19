import { NextResponse } from 'next/server';

export async function POST() {
  return NextResponse.json({
    error: 'This legacy route is retired. Strategy agents must use /api/agent/trades so identity, proposal, depth, risk, and audit controls cannot be bypassed.',
    code: 'LEGACY_TRADE_ROUTE_RETIRED',
  }, { status: 410 });
}
