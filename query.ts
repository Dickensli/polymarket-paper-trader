import { getDb } from './src/lib/db';
import { portfolios, paperTrades, positions } from './src/lib/db/schema';
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
  const userId = 'dickens_smith_kalshi';
  
  const userPortfolios = await db.select().from(portfolios).where(eq(portfolios.userId, userId));
  console.log("Portfolios:", userPortfolios);

  const userTrades = await db.select().from(paperTrades).where(eq(paperTrades.userId, userId)).orderBy(desc(paperTrades.executedAt)).limit(20);
  console.log("Recent Trades:", userTrades);
  
  const userPositions = await db.select().from(positions).where(eq(positions.userId, userId));
  console.log("Positions:", userPositions);

  process.exit(0);
}
main().catch(console.error);
