import { NextRequest, NextResponse } from 'next/server';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { getDb } from '@/lib/db';
import path from 'path';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  // Simple auth check
  const authHeader = req.headers.get('x-agent-secret');
  if (authHeader !== process.env.AGENT_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    console.log('Starting migration...');
    const db = getDb();
    
    // Drizzle migrate needs the path to the migrations folder
    // In Vercel, we need to be careful about the path
    const migrationsFolder = path.join(process.cwd(), 'drizzle');
    
    console.log(`Using migrations folder: ${migrationsFolder}`);
    
    await migrate(db, { migrationsFolder });
    
    return NextResponse.json({ success: true, message: 'Migrations applied successfully' });
  } catch (error: any) {
    console.error('Migration failed:', error);
    return NextResponse.json({ 
      success: false, 
      error: error.message,
      stack: error.stack,
      cwd: process.cwd(),
      env: {
        NODE_ENV: process.env.NODE_ENV,
        HAS_DB_URL: !!process.env.DATABASE_URL
      }
    }, { status: 500 });
  }
}
