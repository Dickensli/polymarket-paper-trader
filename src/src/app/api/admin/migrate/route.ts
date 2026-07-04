import { NextRequest, NextResponse } from 'next/server';
import postgres from 'postgres';
import fs from 'fs';
import path from 'path';

export async function POST(req: NextRequest) {
  const authHeader = req.headers.get('x-agent-secret') || req.headers.get('x-migrate-secret');
  
  // Use the default AGENT_SECRET or a one-time migration secret
  if (authHeader !== 'jetski_migration_2024' && authHeader !== process.env.AGENT_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    return NextResponse.json({ error: 'DATABASE_URL is not set in production' }, { status: 500 });
  }

  const sql = postgres(databaseUrl, { ssl: 'require' });

  try {
    const drizzleDir = path.join(process.cwd(), 'drizzle');
    const files = fs.readdirSync(drizzleDir)
      .filter(f => f.endsWith('.sql'))
      .sort();
    
    console.log(`Found ${files.length} migrations: ${files.join(', ')}`);
    const results = [];

    for (const file of files) {
      const migrationPath = path.join(drizzleDir, file);
      const migrationSql = fs.readFileSync(migrationPath, 'utf8');
      
      console.log(`Applying migration ${file}...`);
      try {
        await sql.unsafe(migrationSql);
        results.push({ file, status: 'success' });
      } catch (err: any) {
        console.warn(`Migration ${file} failed or already applied:`, err.message);
        results.push({ file, status: 'skipped/failed', error: err.message });
      }
    }
    
    return NextResponse.json({ 
      success: true, 
      message: 'Migration process completed',
      results
    });
  } catch (err: any) {
    console.error('Migration API failed:', err);
    return NextResponse.json({ 
      error: err.message,
      stack: err.stack
    }, { status: 500 });
  } finally {
    await sql.end();
  }
}
