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
  const strats = await sql`SELECT user_id, strategy_id FROM strategies WHERE strategy_id = 'high_freq_real' OR trigger_id = 'high_freq_real'`;
  console.log("Strategies found:", strats);
  
  if (strats.length > 0) {
    const port = await sql`SELECT * FROM portfolios WHERE user_id = ${strats[0].user_id}`;
    console.log("Portfolio:", port);
  }
  process.exit(0);
}
main().catch(console.error);
