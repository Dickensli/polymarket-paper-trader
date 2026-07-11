import { expect, test } from '@playwright/test';

test('settled position history is collapsed by default and expands with broker-style details', async ({ page }) => {
  await page.route('**/api/auth/session**', (route) => route.fulfill({
    json: {
      user: { id: 'test-user', name: 'Test User', email: 'test@example.com' },
      expires: new Date(Date.now() + 86_400_000).toISOString(),
    },
  }));
  await page.route('**/api/agent/dashboard**', (route) => route.fulfill({
    json: {
      access: { scope: 'user' },
      summary: { strategies: 1, reports: 0, snapshots: 0, real_orders: 0, open_real_orders: 0 },
      strategies: [],
      current_portfolios: [],
      settled_positions: [{
        id: 'position-1:strategy-1', strategy_id: 'strategy-1', strategy_name: 'Income Strategy',
        agent_id: 'test-user', agent_name: 'Test Agent', platform: 'kalshi', market_id: 'KXTEST',
        market: 'Will the test resolve yes?', outcome: 'YES', shares: 10, avg_price: 0.4,
        settlement_price: 1, cost_basis: 4, proceeds: 10, realized_pnl: 6,
        settled_at: '2026-07-11T12:00:00.000Z',
      }],
      reports: [], snapshots: [], real_orders: [],
      filter_options: {
        strategies: [{
          id: 'strategy-1', agent_id: 'test-user', strategy_name: 'Income Strategy', agent_mode: 'paper',
          platform: 'kalshi', status: 'active', starting_balance: 1000,
        }],
        platforms: ['all', 'polymarket', 'kalshi', 'polymarket_us'],
        agent_modes: ['all', 'paper', 'real'],
      },
    },
  }));

  await page.goto('/agents');
  const disclosure = page.getByRole('button', { name: /Settled Position History/ });
  await expect(disclosure).toHaveAttribute('aria-expanded', 'false');
  await expect(page.getByText('Settlement Proceeds')).not.toBeVisible();

  await disclosure.click();
  await expect(disclosure).toHaveAttribute('aria-expanded', 'true');
  await expect(page.getByText('Settlement Proceeds')).toBeVisible();
  await expect(page.getByText('Will the test resolve yes?')).toBeVisible();
  await expect(page.getByRole('table').getByText('$6.00')).toBeVisible();
});
