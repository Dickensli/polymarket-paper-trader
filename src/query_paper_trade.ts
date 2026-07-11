import { getDb } from './src/lib/db';
import { paperTrades, positions } from './src/lib/db/schema';
import { eq, desc } from 'drizzle-orm';
import fs from 'fs';

const envStr = fs.readFileSync('./.env.local', 'utf-8');
for (const line of envStr.split('\n')) {
  if (line.trim() && !line.startsWith('#')) {
    const [key, ...vals] = line.split('=');
    process.env[key.trim()] = vals.join('=').trim().replace(/(^"|"$)/g, '');
  }
}

async function main() {
  const db = getDb();
  
  const trades = await db.select().from(paperTrades)
    .where(eq(paperTrades.marketId, 'KXBTC15M-26JUL100115-15'))
    .orderBy(desc(paperTrades.executedAt));
  console.log("Trades for KXBTC15M-26JUL100115-15:", trades);

  const pos = await db.select().from(positions)
    .where(eq(positions.marketId, 'KXBTC15M-26JUL100115-15'));
  console.log("Positions for KXBTC15M-26JUL100115-15:", pos);
  
  process.exit(0);
}
main().catch(console.error);
