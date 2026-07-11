import { getDb } from './src/lib/db';
import { strategies, paperTrades } from './src/lib/db/schema';
import { eq, desc } from 'drizzle-orm';
import fs from 'fs';

const envStr = fs.readFileSync('./.env.production.local', 'utf-8');
for (const line of envStr.split('\n')) {
  if (line.trim() && !line.startsWith('#')) {
    const [key, ...vals] = line.split('=');
    process.env[key.trim()] = vals.join('=').trim().replace(/(^"|"$)/g, '');
  }
}

async function main() {
  const db = getDb();
  
  const strats = await db.select().from(strategies).where(eq(strategies.strategyId, 'high_freq_real'));
  if (strats.length === 0) return;
  const userId = strats[0].userId;

  const userTrades = await db.select().from(paperTrades)
    .where(eq(paperTrades.userId, userId))
    .orderBy(desc(paperTrades.executedAt))
    .limit(10);
  
  for (const t of userTrades) {
    console.log(`Trade: ${t.action} ${t.shares} @ ${t.pricePerShare}`);
  }

  process.exit(0);
}
main().catch(console.error);
