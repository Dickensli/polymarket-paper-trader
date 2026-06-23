import { readFileSync } from 'fs';
import { resolve } from 'path';

// Load .env.local
const envPath = resolve(__dirname, '../.env.local');
try {
  const content = readFileSync(envPath, 'utf-8');
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    let value = trimmed.slice(eqIdx + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
} catch (e) {}

import { getDb } from '../src/lib/db';
import { positions } from '../src/lib/db/schema';
import { eq, like, and } from 'drizzle-orm';

async function main() {
  const db = getDb();
  
  // Find open positions containing "Iraq"
  const iraqPositions = await db.query.positions.findMany({
    where: and(
      eq(positions.isOpen, true),
      like(positions.marketQuestion, '%Iraq%')
    )
  });

  console.log("Open Iraq Positions:");
  console.log(JSON.stringify(iraqPositions, null, 2));
}

main().catch(console.error);
