import { expect, test } from '@playwright/test';

test('shows resting orders separately from current positions', async ({ page }) => {
  await page.route('**/api/auth/session**', (route) => route.fulfill({
    json: {
      user: { id: 'test-user', name: 'Test User', email: 'test@example.com' },
      expires: new Date(Date.now() + 86_400_000).toISOString(),
    },
  }));
  await page.route('**/api/agent/dashboard**', (route) => route.fulfill({
    json: {
      access: { scope: 'user' },
      summary: { strategies: 1, reports: 0, snapshots: 1, real_orders: 1, open_real_orders: 1 },
      strategies: [],
      current_portfolios: [],
      settled_positions: [],
      reports: [],
      snapshots: [],
      real_orders: [{
        id: 'order-1', agent_id: 'test-user', agent_name: 'Test Agent', strategy_name: 'commander_real',
        platform: 'kalshi', official_order_id: 'official-resting-1', client_order_id: 'client-1',
        market_slug_or_ticker: 'KXGDP-26JUL30-T2.0', side: 'BUY', quantity: 840.68, price: 0.6,
        status: 'RESTING', error: {}, request: {}, official_response: {},
        requested_quantity: 840.68, filled_quantity: 0, remaining_quantity: 840.68,
        created_at: '2026-07-13T12:10:42.688Z', updated_at: '2026-07-13T16:04:58.647Z',
      }],
      sync_health: [],
      filter_options: {
        strategies: [{
          id: 'strategy-1', agent_id: 'test-user', strategy_name: 'commander_real', agent_mode: 'real',
          platform: 'kalshi', status: 'active', starting_balance: 1000,
        }],
        platforms: ['all', 'polymarket', 'kalshi', 'polymarket_us'],
        agent_modes: ['all', 'paper', 'real'],
      },
    },
  }));

  await page.goto('/agents');

  const openOrders = page.getByRole('region', { name: 'Open Orders' });
  await expect(openOrders).toContainText('1 open');
  await expect(openOrders).toContainText('RESTING');
  await expect(openOrders).toContainText('KXGDP-26JUL30-T2.0');
  await expect(openOrders).toContainText('Filled: 0/840.68');
  await expect(page.getByText('Open Positions').locator('..')).toContainText('0');

  const orderDisclosure = openOrders.getByRole('button');
  await expect(orderDisclosure).toHaveAttribute('aria-expanded', 'false');
  await orderDisclosure.click();
  await expect(orderDisclosure).toHaveAttribute('aria-expanded', 'true');
  await expect(openOrders).toContainText('official-resting-1');
});
