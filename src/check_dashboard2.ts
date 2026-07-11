import fs from 'fs';
import postgres from 'postgres';

const envStr = fs.readFileSync('./.env.local', 'utf-8');
for (const line of envStr.split('\n')) {
  if (line.trim() && !line.startsWith('#')) {
    const [key, ...vals] = line.split('=');
    process.env[key.trim()] = vals.join('=').trim().replace(/(^"|"$)/g, '');
  }
}

async function main() {
  const sql = postgres(process.env.DATABASE_URL!);
  const snaps = await sql`SELECT * FROM leaderboard_snapshots WHERE user_id = '1f82891b-06d4-446a-b6f8-1d2a579c8e05' ORDER BY recorded_at DESC LIMIT 5`;
  console.log("Recent Snapshots:", snaps);
  process.exit(0);
}
main().catch(console.error);
