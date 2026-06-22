import { NextResponse } from 'next/server';
import { getDb, eventCache, marketCache } from '@/lib/db';
import { getEvents } from '@/lib/polymarket';
import { eq, and, notInArray } from 'drizzle-orm';

/**
 * Sync active events and their nested markets from Polymarket to Supabase.
 * This should be called via a Cron job every 5-10 minutes to pull metadata.
 */
export async function GET() {
  try {
    // 1. Fetch the latest active events from Polymarket.
    // Fetch multiple pages to ensure comprehensive coverage (e.g., 2000 events instead of just 100)
    const pagePromises = Array.from({ length: 20 }).map((_, i) => 
      getEvents({ limit: 100, offset: i * 100, closed: false })
    );
    const pages = await Promise.all(pagePromises);
    const events = pages.flat();
    
    if (!events || events.length === 0) {
      return NextResponse.json({ success: true, message: "No active events found." });
    }

    const db = getDb();
    
    const upsertEventsCount = events.length;
    let upsertMarketsCount = 0;

    // chunk function helper
    const chunkArray = <T,>(arr: T[], size: number): T[][] => {
      return Array.from({ length: Math.ceil(arr.length / size) }, (v, i) =>
        arr.slice(i * size, i * size + size)
      );
    };

    const eventChunks = chunkArray(events, 50);

    for (const chunk of eventChunks) {
      await Promise.all(
        chunk.map(async (event) => {
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
            
            const marketPromises = event.markets.map(async (market) => {
              if (!market.tokenIds || market.tokenIds.length < 2) return;

              await db.insert(marketCache)
                .values({
                  id: market.id,
                  eventId: event.id,
                  question: market.question,
                  conditionId: market.conditionId,
                  endDate: market.endDate ? new Date(market.endDate) : null,
                  image: market.image,
                  icon: market.icon,
                  outcomes: market.outcomes || [],
                  outcomePrices: market.outcomePrices || [],
                  volume24hr: market.volume24hr?.toString(),
                  liquidity: market.liquidity?.toString(),
                  closed: market.closed,
                  tokenIds: market.tokenIds || [],
                  lastSyncedAt: new Date(),
                })
                .onConflictDoUpdate({
                  target: marketCache.id,
                  set: {
                    question: market.question,
                    endDate: market.endDate ? new Date(market.endDate) : null,
                    image: market.image,
                    icon: market.icon,
                    outcomes: market.outcomes || [],
                    outcomePrices: market.outcomePrices || [],
                    volume24hr: market.volume24hr?.toString(),
                    liquidity: market.liquidity?.toString(),
                    closed: market.closed,
                    tokenIds: market.tokenIds || [],
                    lastSyncedAt: new Date(),
                  }
                });
            });
            await Promise.all(marketPromises);
          }
        })
      );
    }
    
    // 3. Mark events and markets as closed if they are not in the active list anymore
    const activeEventIds = events.map((e) => e.id);
    if (activeEventIds.length > 0) {
      // Mark events as closed
      const closedEventsResult = await db
        .update(eventCache)
        .set({ closed: true })
        .where(
          and(
            eq(eventCache.closed, false),
            notInArray(eventCache.id, activeEventIds)
          )
        );

      // Mark nested markets of those events as closed
      await db
        .update(marketCache)
        .set({ closed: true })
        .where(
          and(
            eq(marketCache.closed, false),
            notInArray(marketCache.eventId, activeEventIds)
          )
        );
      
      console.log(`Auto-closed events and markets that are no longer active on Polymarket.`);
    }

    return NextResponse.json({
      success: true,
      message: `Synced ${upsertEventsCount} events and ${upsertMarketsCount} nested markets successfully.`,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('Error syncing Polymarket events:', err);
    return NextResponse.json(
      { success: false, error: 'Internal server error', details: message },
      { status: 500 },
    );
  }
}
