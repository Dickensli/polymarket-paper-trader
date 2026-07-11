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

  const strategyUuid = 'f950e57d-a047-4871-b042-33b3964f9dbf';
  console.log(`Enabling strategy: ${strategyUuid}`);

  const result = await db.update(schema.strategies)
    .set({ status: 'active' })
    .where(eq(schema.strategies.id, strategyUuid))
    .returning();

  if (result.length > 0) {
    console.log(`Successfully enabled. New status: ${result[0].status}`);
  } else {
    console.log('Strategy not found.');
  }

  process.exit(0);
}

main().catch(console.error);
