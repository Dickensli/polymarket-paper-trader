import fs from 'fs';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { eq, like } from 'drizzle-orm';
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

  const strategyId = 'aggressive_retro_real';
  console.log(`Looking for strategy: ${strategyId}`);

  const strats = await db.query.strategies.findMany({
    where: like(schema.strategies.strategyId, `%${strategyId}%`)
  });

  if (strats.length === 0) {
    console.log('No strategy found.');
    process.exit(0);
  }

  for (const strat of strats) {
    console.log(`Deleting strategy: ${strat.strategyId} (id: ${strat.id})`);
    
    // Delete logs and snapshots first
    await db.delete(schema.reconciliationLogs).where(eq(schema.reconciliationLogs.strategyId, strat.id));
    await db.delete(schema.portfolioSnapshots).where(eq(schema.portfolioSnapshots.strategyId, strat.id));
    await db.delete(schema.realTradeOrders).where(eq(schema.realTradeOrders.strategyId, strat.id));
    
    // Delete the strategy itself
    await db.delete(schema.strategies).where(eq(schema.strategies.id, strat.id));
    
    // Delete the portfolio for this user
    await db.delete(schema.portfolios).where(eq(schema.portfolios.userId, strat.userId));
    
    console.log('Deleted.');
  }

  console.log('Cleanup complete.');
  process.exit(0);
}

main().catch(console.error);
