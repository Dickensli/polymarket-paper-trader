import { NextRequest, NextResponse } from 'next/server';
import { getPolymarketUsEvent, getPolymarketUsEventBySlug } from '@/lib/polymarket-us';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;

    // Try numeric ID first, then slug
    const numericId = Number(id);
    const data = Number.isFinite(numericId) && numericId > 0
      ? await getPolymarketUsEvent(numericId)
      : await getPolymarketUsEventBySlug(id);

    if (!data) {
      return NextResponse.json({ error: 'Event not found' }, { status: 404 });
    }
    return NextResponse.json(data);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
