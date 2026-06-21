import { NextResponse } from 'next/server';
import { getDb, eventCache, marketCache } from '@/lib/db';
import { getEvents } from '@/lib/polymarket';

/**
 * Sync active events and their nested markets from Polymarket to Supabase.
 * This should be called via a Cron job every 5-10 minutes to pull metadata.
 */
export async function GET() {
  try {
    // 1. Fetch the latest active events from Polymarket.
    // For a real deployment, we might iterate over multiple pages or specific tags like "iran".
    // Here we pull a large page of active events to demonstrate the metadata sync.
    const events = await getEvents({ limit: 100, closed: false });
    
    if (!events || events.length === 0) {
      return NextResponse.json({ success: true, message: "No active events found." });
    }

    const db = getDb();
    
    const upsertEventsCount = events.length;
    let upsertMarketsCount = 0;

    // We can wrap upserts in a transaction if needed, but since we are just caching,
    // parallel or sequential upserts are fine.
    for (const event of events) {
      // Upsert the Event
      await db.insert(eventCache)
        .values({
          id: event.id,
          title: event.title,
          slug: event.slug,
          description: event.description,
          image: event.image,
          icon: event.icon,
          category: event.category,
          closed: event.closed,
          lastSyncedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: eventCache.id,
          set: {
            title: event.title,
            slug: event.slug,
            description: event.description,
            image: event.image,
            icon: event.icon,
            category: event.category,
            closed: event.closed,
            lastSyncedAt: new Date(),
          }
        });

      // Upsert the nested Markets for this Event
      if (event.markets && event.markets.length > 0) {
        upsertMarketsCount += event.markets.length;
        
        for (const market of event.markets) {
          // We only cache valid markets (e.g. ones with tokenIds)
          if (!market.tokenIds || market.tokenIds.length < 2) continue;
          
          await db.insert(marketCache)
            .values({
              id: market.id,
              eventId: event.id,
              question: market.question,
              conditionId: market.conditionId,
              outcomes: market.outcomes,
              outcomePrices: market.outcomePrices,
              tokenIds: market.tokenIds,
              volume24hr: market.volume24hr?.toString(),
              liquidity: market.liquidity?.toString(),
              category: market.category,
              image: market.image,
              icon: market.icon,
              closed: market.closed,
              endDate: market.endDate ? new Date(market.endDate) : null,
              lastSyncedAt: new Date(),
            })
            .onConflictDoUpdate({
              target: marketCache.id,
              set: {
                eventId: event.id,
                question: market.question,
                conditionId: market.conditionId,
                outcomes: market.outcomes,
                outcomePrices: market.outcomePrices,
                tokenIds: market.tokenIds,
                volume24hr: market.volume24hr?.toString(),
                liquidity: market.liquidity?.toString(),
                category: market.category,
                image: market.image,
                icon: market.icon,
                closed: market.closed,
                endDate: market.endDate ? new Date(market.endDate) : null,
                lastSyncedAt: new Date(),
              }
            });
        }
      }
    }

    return NextResponse.json({
      success: true,
      message: `Synced ${upsertEventsCount} events and ${upsertMarketsCount} nested markets successfully.`,
    });

  } catch (err) {
    console.error("Metadata Sync Error:", err);
    return NextResponse.json({ error: 'Failed to sync metadata', details: String(err) }, { status: 500 });
  }
}
