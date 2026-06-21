import { NextResponse } from 'next/server';
import { getDb, eventCache } from '@/lib/db';

/**
 * Temporary one-off endpoint to clean out all old event cache rows
 * to fix the old category bugs in production.
 */
export async function GET() {
  try {
    const db = getDb();
    
    // Deletes all rows in eventCache (which cascades to marketCache)
    await db.delete(eventCache);

    return NextResponse.json({
      success: true,
      message: `Cleared all events from eventCache. You can now visit /api/sync to pull fresh Polymarket events.`,
    });

  } catch (err) {
    console.error("Cache clear error:", err);
    return NextResponse.json({ error: 'Failed to clear cache', details: String(err) }, { status: 500 });
  }
}
