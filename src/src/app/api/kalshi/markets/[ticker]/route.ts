import { NextRequest, NextResponse } from 'next/server';
import { getKalshiMarket, getKalshiOutcomePrice } from '@/lib/kalshi';

export async function GET(_request: NextRequest, { params }: { params: Promise<{ ticker: string }> }) {
  const { ticker } = await params;
  const market = await getKalshiMarket(ticker);
  if (!market) {
    return NextResponse.json({ error: 'Kalshi market not found' }, { status: 404 });
  }

  const [yesPrice, noPrice] = await Promise.all([
    getKalshiOutcomePrice(ticker, 'YES'),
    getKalshiOutcomePrice(ticker, 'NO'),
  ]);

  return NextResponse.json({
    data: {
      ...market,
      ticker,
      yesPrice,
      noPrice,
    },
  });
}

