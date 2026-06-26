import { NextRequest, NextResponse } from 'next/server';

const KALSHI_BASE_URL = process.env.KALSHI_BASE_URL || 'https://external-api.kalshi.com/trade-api/v2';

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

