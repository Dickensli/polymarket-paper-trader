import { test, expect } from 'vitest';
import { getDb } from '@/lib/db';
import { limitOrders, portfolios } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';

test('check portfolios and orders for high_freq user', async () => {
  const db = getDb();
  const userId = '279338a0-5444-440b-8ce4-3d045c94e0a6';
  
  const ports = await db.select().from(portfolios).where(eq(portfolios.userId, userId));
  console.log("=== PORTFOLIOS ===");
  console.log(ports);

  const ords = await db.select().from(limitOrders).where(eq(limitOrders.userId, userId));
  console.log("=== ORDERS ===");
  console.log(ords);

  expect(true).toBe(true);
});
