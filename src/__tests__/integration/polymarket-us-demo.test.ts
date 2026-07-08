import { describe, it, expect, beforeAll } from 'vitest';
import { getPolymarketUsMarkets, getPolymarketUsMarketBook } from '@/lib/polymarket-us';
import { getOfficialPortfolioSnapshot, submitOfficialRealTrade } from '@/lib/official-trading';

describe('Polymarket US Demo (Preprod) Integration', () => {
  beforeAll(() => {
    process.env.POLYMARKET_US_USE_DEMO = 'true';
  });

  it('initializes client to preprod and fetches public markets list', async () => {
    const response = await getPolymarketUsMarkets({ limit: 5 });
    
    // We expect this to either succeed (if preprod is online) or fail with 502/network error,
    // but not crash local initialization.
    console.log('Preprod markets fetch result:', JSON.stringify(response, null, 2));
    
    if (response) {
      expect(response.markets).toBeDefined();
      expect(Array.isArray(response.markets)).toBe(true);
    }
  });

  it('fails auth gracefully when trying to fetch portfolio snapshot without keys', async () => {
    // Override key env variables to make sure they are empty/invalid
    const prevKey = process.env.POLYMARKET_US_DEMO_KEY_ID;
    const prevSecret = process.env.POLYMARKET_US_DEMO_SECRET_KEY;
    process.env.POLYMARKET_US_DEMO_KEY_ID = '';
    process.env.POLYMARKET_US_DEMO_SECRET_KEY = '';

    const snapshot = await getOfficialPortfolioSnapshot('polymarket_us');
    expect(snapshot).toBeDefined();
    expect(snapshot.cash).toBe(0);
    expect((snapshot.raw.positions as any).error).toContain('AuthenticationError');

    // Restore
    process.env.POLYMARKET_US_DEMO_KEY_ID = prevKey;
    process.env.POLYMARKET_US_DEMO_SECRET_KEY = prevSecret;
  });
});
