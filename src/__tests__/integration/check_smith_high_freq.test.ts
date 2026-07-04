import { test, expect } from 'vitest';
import { getDb } from '@/lib/db';
import { users } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';

test('print dickens_smith("high_freq") details', async () => {
  const db = getDb();
  const u = await db.query.users.findFirst({
    where: eq(users.name, 'dickens_smith("high_freq")')
  });
  console.log("=== USER DETAILS ===");
  console.log(JSON.stringify(u, null, 2));
  expect(true).toBe(true);
});
