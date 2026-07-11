import { getDb } from './src/lib/db';
import { users, strategies, portfolios, paperTrades, positions, realTradeOrders } from './src/lib/db/schema';
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

  const realTrades = await db.select().from(realTradeOrders).where(eq(realTradeOrders.userId, userId)).orderBy(desc(realTradeOrders.createdAt)).limit(5);
  console.log("Recent Real Trades:");
  for (const t of realTrades) {
    console.log(`- ${t.side} ${t.quantity} @ ${t.price} (Status: ${t.status}) => officialResponse:`, JSON.stringify(t.officialResponse).substring(0, 200));
  }

  process.exit(0);
}
main().catch(console.error);
