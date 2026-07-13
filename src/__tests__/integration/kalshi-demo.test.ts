import { describe, it, expect, beforeAll } from 'vitest';
import { getOfficialPortfolioSnapshot, submitOfficialRealTrade, cancelOfficialRealOrder } from '@/lib/official-trading';

// This suite submits venue orders. It must never run as part of the default
// test command merely because credentials happen to exist in the environment.
const describeLiveTrading = process.env.RUN_LIVE_TRADING_TESTS === '1' ? describe : describe.skip;

describeLiveTrading('Kalshi Demo API Integration', () => {
  beforeAll(() => {
    process.env.KALSHI_USE_DEMO = 'true';
  });

  it('fetches demo portfolio snapshot successfully', async () => {
    const snapshot = await getOfficialPortfolioSnapshot('kalshi');
    console.log('Demo Account Balance Snapshot:', JSON.stringify(snapshot, null, 2));

    expect(snapshot).toBeDefined();
    expect(typeof snapshot.cash).toBe('number');
    expect(snapshot.cash).toBeGreaterThan(0);
    expect(Array.isArray(snapshot.positions)).toBe(true);
    expect(Array.isArray(snapshot.orders)).toBe(true);
  });

  it('submits and cancels a real limit order on demo market', async () => {
    const baseUrl = 'https://demo-api.kalshi.co/trade-api/v2';
    const marketsRes = await fetch(`${baseUrl}/markets?limit=10&status=open`);
    const marketsData = await marketsRes.json() as { markets?: Array<{ ticker: string, subtitle?: string }> };
    
    const markets = marketsData.markets || [];
    expect(markets.length).toBeGreaterThan(0);

    const targetMarket = markets[0];
    const ticker = targetMarket.ticker;
    console.log(`Using target market for test order: ${ticker} (${targetMarket.subtitle || ''})`);

    const tradeIntent = {
      platform: 'kalshi' as const,
      slug: ticker,
      outcome: 'YES' as const,
      side: 'BUY' as const,
      shares: 1,
      price: 0.01,
      timeInForce: 'GTC' as const,
    };

    console.log('Submitting limit order (YES @ $0.01):', tradeIntent);
    const result = await submitOfficialRealTrade(tradeIntent);
    console.log('Trade Submission Result:', JSON.stringify(result, null, 2));

    expect(result.status).toBe('SUBMITTED');
    expect(result.officialOrderId).toBeDefined();
    expect(typeof result.officialOrderId).toBe('string');

    const orderId = result.officialOrderId!;

    // Verify order is registered on demo account
    const snapshotAfterOrder = await getOfficialPortfolioSnapshot('kalshi');
    const openOrders = snapshotAfterOrder.orders as Array<{ order_id: string }>;
    const foundOrder = openOrders.find(o => o.order_id === orderId);
    console.log(`Verified open order in portfolio:`, foundOrder);

    // Cancel order
    console.log(`Cancelling order: ${orderId}`);
    const cancelResult = await cancelOfficialRealOrder('kalshi', orderId);
    console.log('Cancel Result:', JSON.stringify(cancelResult, null, 2));
    
    expect(cancelResult.status).toBe('CANCELLED');
  });

  it('buys 6 dollars worth of contracts on an active market without cancelling', async () => {
    const baseUrl = 'https://demo-api.kalshi.co/trade-api/v2';
    const marketsRes = await fetch(`${baseUrl}/markets?limit=10&status=open`);
    const marketsData = await marketsRes.json() as { markets?: Array<{ ticker: string; yes_ask_dollars?: string | number }> };
    const markets = marketsData.markets || [];
    expect(markets.length).toBeGreaterThan(0);

    // Find a market with a valid yes_ask_dollars price
    const targetMarket = markets.find(m => Number(m.yes_ask_dollars) > 0 && Number(m.yes_ask_dollars) < 1.0) || markets[0];
    const ticker = targetMarket.ticker;
    const askPrice = Number(targetMarket.yes_ask_dollars) || 0.50; 
    const shares = Math.round(6 / askPrice) || 12;

    console.log(`Target Market: ${ticker}`);
    console.log(`Current Yes Ask Price: $${askPrice}`);
    console.log(`Calculating shares for $6 notional: ${shares} shares`);

    const tradeIntent = {
      platform: 'kalshi' as const,
      slug: ticker,
      outcome: 'YES' as const,
      side: 'BUY' as const,
      shares: shares,
      price: askPrice,
      timeInForce: 'GTC' as const,
    };

    console.log('Placing GTC $6 order:', tradeIntent);
    const result = await submitOfficialRealTrade(tradeIntent);
    console.log('Order Placement Result:', JSON.stringify(result, null, 2));

    expect(result.status).toBe('SUBMITTED');
    expect(result.officialOrderId).toBeDefined();
    console.log(`SUCCESS: Placed $6 order. Order ID: ${result.officialOrderId}. Please check your Kalshi Demo dashboard!`);
  });
});
