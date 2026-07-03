import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { getPortfolio, resetPortfolio } from '@/lib/trading-engine';

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
    return NextResponse.json({ error: 'Internal server error', details: message }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const balanceParam = searchParams.get('balance');
    const initialBalance = balanceParam ? parseFloat(balanceParam) : undefined;

    const portfolio = await resetPortfolio(session.user.id, initialBalance);
    return NextResponse.json({ data: portfolio, message: 'Polymarket US paper portfolio reset.' });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: 'Internal server error', details: message }, { status: 500 });
  }
}
