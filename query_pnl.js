const fs = require('fs');
const postgres = require('postgres');

const envStr = fs.readFileSync('./.env.local', 'utf-8');
for (const line of envStr.split('\n')) {
  if (line.trim() && !line.startsWith('#')) {
    const [key, ...vals] = line.split('=');
    process.env[key.trim()] = vals.join('=').trim().replace(/(^"|"$)/g, '');
  }
}

async function main() {
  const sql = postgres(process.env.DATABASE_URL);
  
  const user_id = 'dickens_smith_kalshi';
  const portfolios = await sql`SELECT * FROM portfolios WHERE user_id = ${user_id}`;
  console.log("Portfolios:", portfolios);
  
  const trades = await sql`SELECT * FROM paper_trades WHERE user_id = ${user_id} ORDER BY executed_at DESC LIMIT 10`;
  console.log("Recent Trades:", trades);
  
  process.exit(0);
}

main().catch(console.error);
