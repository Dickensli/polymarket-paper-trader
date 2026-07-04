const postgres = require('postgres');
const sql = postgres("postgres://u_jetski_001_owner:nup6rD8vWfId@ep-solitary-voice-a551mrc7.us-east-2.aws.neon.tech/polytrader_prod?sslmode=require");

async function main() {
  try {
    const result = await sql`SELECT 1 as connected`;
    console.log('Connected:', result);
    const tables = await sql`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'`;
    console.log('Tables:', tables.map(t => t.table_name));
    process.exit(0);
  } catch (err) {
    console.error('Error:', err);
    process.exit(1);
  }
}

main();
