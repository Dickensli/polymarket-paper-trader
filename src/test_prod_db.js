const postgres = require('postgres');
const connectionString = "postgres://u_jetski_001_owner:nup6rD8vWfId@ep-solitary-voice-a551mrc7.us-east-2.aws.neon.tech/polytrader_prod?sslmode=require";
const sql = postgres(connectionString);

async function testConnection() {
  try {
    const result = await sql`SELECT 1 as connected`;
    console.log('Successfully connected to production database:', result);
    process.exit(0);
  } catch (err) {
    console.error('Failed to connect to production database:', err.message);
    process.exit(1);
  }
}

testConnection();
