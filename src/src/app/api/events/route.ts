import { NextRequest, NextResponse } from 'next/server';
import { getDb, eventCache, marketCache } from '@/lib/db';
import { desc, eq, and, or, ilike } from 'drizzle-orm';

/**
 * Fetch a paginated list of active Events with their nested Markets from Supabase.
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = request.nextUrl;
    
    const limit = Math.min(parseInt(searchParams.get('limit') ?? '20', 10), 100);
    const offset = Math.max(parseInt(searchParams.get('offset') ?? '0', 10), 0);
    const category = searchParams.get('category')?.trim() || undefined;
    const search = searchParams.get('search')?.trim().toLowerCase() || undefined;

    const db = getDb();

    // Base filters
    const filters = [eq(eventCache.closed, false)];
    if (category) {
      filters.push(eq(eventCache.category, category));
    }
    if (search) {
      filters.push(
        or(
          ilike(eventCache.title, `%${search}%`),
          ilike(eventCache.description, `%${search}%`)
        )
      );
    }

    // Fetch Events
    const events = await db.select()
      .from(eventCache)
      .where(and(...(filters as any)))
      .orderBy(desc(eventCache.createdAt)) // or some volume column if we had one on events
      .limit(limit)
      .offset(offset);

    // Fetch Markets for these Events
    const eventIds = events.map(e => e.id);
    let markets: any[] = [];
    
    if (eventIds.length > 0) {
      // In Drizzle, we can use an 'inArray' or just fetch them all and map
      // Since it's a small page size, we can fetch all markets for these events
      markets = await db.query.marketCache.findMany({
        where: (fields, { inArray }) => inArray(fields.eventId, eventIds),
      });
    }

    // Group markets by event
    const data = events.map(event => ({
      ...event,
      markets: markets.filter(m => m.eventId === event.id)
    }));

    return NextResponse.json({
      data,
      meta: { limit, offset, count: data.length }
    });

  } catch (err) {
    return NextResponse.json({ error: 'Failed to fetch events', details: String(err) }, { status: 500 });
  }
}
