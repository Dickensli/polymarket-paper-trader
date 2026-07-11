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

  console.log('Listing all users:');
  const users = await db.query.users.findMany();

  for (const user of users) {
    console.log(`- ${user.email} (id: ${user.id})`);
  }

  process.exit(0);
}

main().catch(console.error);
