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

  console.log(`Disabling all remaining strategies for 'polymarket'...`);

  const strats = await db.query.strategies.findMany({
    where: eq(schema.strategies.platform, 'polymarket')
  });

  if (strats.length === 0) {
    console.log('No polymarket strategies found.');
    process.exit(0);
  }

  console.log(`Found ${strats.length} polymarket strategies. Disabling them...`);
  
  await db.update(schema.strategies)
    .set({ status: 'disabled' })
    .where(eq(schema.strategies.platform, 'polymarket'));

  console.log('Successfully disabled polymarket strategies.');
  process.exit(0);
}

main().catch(console.error);
