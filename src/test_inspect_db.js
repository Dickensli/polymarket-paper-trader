const postgres = require('postgres');
const connectionString = "postgres://u_jetski_001_owner:nup6rD8vWfId@ep-solitary-voice-a551mrc7.us-east-2.aws.neon.tech/polytrader_prod?sslmode=require";
const sql = postgres(connectionString);

async function inspectDb() {
  try {
    console.log('Listing tables:');
    const tables = await sql`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'`;
    console.log(tables.map(t => t.table_name));

    console.log('\nChecking paper_trades columns:');
    const columns = await sql`SELECT column_name FROM information_schema.columns WHERE table_name = 'paper_trades'`;
    console.log(columns.map(c => c.column_name));

    process.exit(0);
  } catch (err) {
    console.error('Error:', err.message);
    process.exit(1);
  }
}

inspectDb();
