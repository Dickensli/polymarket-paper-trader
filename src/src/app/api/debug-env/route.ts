import { NextResponse } from 'next/server';

export async function GET() {
  const env = {
    KALSHI_USE_DEMO: process.env.KALSHI_USE_DEMO,
    KALSHI_DEMO_PRIVATE_KEY_PEM: process.env.KALSHI_DEMO_PRIVATE_KEY_PEM ? 'SET' : 'MISSING',
    KALSHI_PRIVATE_KEY_PEM: process.env.KALSHI_PRIVATE_KEY_PEM ? 'SET' : 'MISSING',
    KALSHI_DEMO_PRIVATE_KEY_PATH: process.env.KALSHI_DEMO_PRIVATE_KEY_PATH,
    KALSHI_PRIVATE_KEY_PATH: process.env.KALSHI_PRIVATE_KEY_PATH,
  };
  return NextResponse.json(env);
}
