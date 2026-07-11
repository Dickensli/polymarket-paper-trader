import fs from 'fs';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
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

  console.log('Listing all strategies:');
  const strats = await db.query.strategies.findMany();

  for (const strat of strats) {
    console.log(`- ${strat.strategyId}: status=${strat.status}, id=${strat.id}, platform=${strat.platform}, mode=${strat.agentMode}`);
  }

  process.exit(0);
}

main().catch(console.error);
