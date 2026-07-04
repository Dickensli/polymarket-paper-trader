
const postgres = require('postgres');

const variants = [
  'nup6rD8vWf1d',
  'nup6rD8vWfId',
  'nup6rD8vWfld'
];

async function test() {
  for (const pass of variants) {
    console.log(`Testing: ${pass}`);
    const sql = postgres(`postgres://u_jetski_001_owner:${pass}@ep-solitary-voice-a551mrc7.us-east-2.aws.neon.tech/polytrader_prod?sslmode=require`);
    try {
      const result = await sql`SELECT 1 as connected`;
      console.log(`SUCCESS with ${pass}:`, result);
      process.exit(0);
    } catch (err) {
      console.error(`FAILED with ${pass}:`, err.message);
    } finally {
      await sql.end();
    }
  }
}

test();
