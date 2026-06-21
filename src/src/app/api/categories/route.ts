import { NextResponse } from 'next/server';
import { getDb, eventCache } from '@/lib/db';
import { eq } from 'drizzle-orm';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const db = getDb();

    // In Postgres, we can do a distinct query. Drizzle supports this via a raw query 
    // or by selecting distinct. Let's do a select distinct on category.
    const result = await db
      .selectDistinct({ category: eventCache.category })
      .from(eventCache)
      .where(eq(eventCache.closed, false));

    const categories = result
      .map(r => r.category)
      .filter((c): c is string => Boolean(c))
      .sort();

    // Always put 'All' at the start
    return NextResponse.json({ data: ['All', ...categories] });
  } catch (err) {
    return NextResponse.json({ error: 'Failed to fetch categories' }, { status: 500 });
  }
}
