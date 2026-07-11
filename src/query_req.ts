import { getDb } from './src/lib/db';
import { strategies, realTradeOrders } from './src/lib/db/schema';
import { eq, desc, and } from 'drizzle-orm';
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

  const realTrades = await db.select().from(realTradeOrders)
    .where(and(eq(realTradeOrders.userId, userId), eq(realTradeOrders.status, 'EXECUTED')))
    .orderBy(desc(realTradeOrders.createdAt)).limit(5);
  
  console.log("EXECUTED Real Trades:");
  for (const t of realTrades) {
    console.log(`- Request:`, JSON.stringify(t.request));
    console.log(`  OfficialResp:`, JSON.stringify(t.officialResponse));
  }

  process.exit(0);
}
main().catch(console.error);
