import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { strategies } from '@/lib/db/schema';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('x-agent-secret');
  if (authHeader !== process.env.AGENT_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const db = await getDb();
    const allStrategies = await db.select().from(strategies);
    
    return NextResponse.json({ 
      success: true, 
      strategies: allStrategies
    });
  } catch (error: any) {
    return NextResponse.json({ 
      success: false, 
      error: error.message
    }, { status: 500 });
  }
}
