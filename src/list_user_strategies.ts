import fs from 'fs';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { eq } from 'drizzle-orm';
import * as schema from './src/lib/db/schema';

// Poor man's dotenv
const envStr = fs.readFileSync('./.env.local', 'utf-8');
for (const line of envStr.split('\n')) {
  if (line.trim() && !line.startsWith('#')) {
    const [key, ...vals] = line.split('=');
    process.env[key.trim()] = vals.join('=').trim().replace(/(^"|"$)/g, '');
  }
}

async function main() {
  const sql = postgres(process.env.DATABASE_URL!);
  const db = drizzle(sql, { schema });

  const userId = '956e7564-0eca-4bb1-a4ad-e575f03a03d9';
  console.log(`Listing strategies for user: ${userId}`);
  const strats = await db.select().from(schema.strategies).where(eq(schema.strategies.userId, userId));

  for (const strat of strats) {
    console.log(`- ${strat.strategyId}: status=${strat.status}, id=${strat.id}, platform=${strat.platform}, mode=${strat.agentMode}`);
  }

  process.exit(0);
}

main().catch(console.error);
