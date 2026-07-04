const postgres = require('postgres');
const sql = postgres(process.env.DATABASE_URL);

async function test() {
  try {
    const result = await sql`SELECT now()`;
    console.log('Connected successfully');
    console.log('Current time from DB:', result[0]);
    process.exit(0);
  } catch (err) {
    console.error('Connection error', err);
    process.exit(1);
  }
}

test();
