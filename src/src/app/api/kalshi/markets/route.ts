import { NextRequest, NextResponse } from 'next/server';
import { resolveKalshiMarketDataBaseUrl } from '@/lib/kalshi';

const KALSHI_BASE_URL = resolveKalshiMarketDataBaseUrl();

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const upstream = new URL(`${KALSHI_BASE_URL.replace(/\/$/, '')}/markets`);
  for (const [key, value] of searchParams.entries()) {
    upstream.searchParams.set(key, value);
  }

  const res = await fetch(upstream, { headers: { Accept: 'application/json' }, cache: 'no-store' });
  const text = await res.text();
  return new NextResponse(text, {
    status: res.status,
    headers: { 'Content-Type': res.headers.get('content-type') || 'application/json' },
  });
}
