import { NextRequest, NextResponse } from 'next/server';
import postgres from 'postgres';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('x-agent-secret');
  if (authHeader !== process.env.AGENT_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const poolerUrl = `postgresql://postgres.htzaskdufpynvtfecgvc:DoggyMatty123%21@aws-0-us-east-1.pooler.supabase.com:6543/postgres?sslmode=require`;
    
    console.log('Trying pooler connection...');
    const sqlPooler = postgres(poolerUrl, {
      connect_timeout: 10,
    });
    
    const result = await sqlPooler`SELECT current_user, current_database() as db`;
    
    return NextResponse.json({ 
      success: true, 
      identity: result,
      source: 'pooler'
    });
  } catch (error: any) {
    return NextResponse.json({ 
      success: false, 
      error: error.message,
      stack: error.stack,
      code: error.code,
      detail: error.detail
    }, { status: 500 });
  }
}
