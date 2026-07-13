import { expect, test } from '@playwright/test';

test('defaults to active strategies and progressively reveals reports and audit entries', async ({ page }) => {
  let dashboardUrl = '';
  const dashboardRequestCounts = new Map<string, number>();

  await page.route('**/api/auth/session**', (route) => route.fulfill({
    json: {
      user: { id: 'test-user', name: 'Test User', email: 'test@example.com' },
      expires: new Date(Date.now() + 86_400_000).toISOString(),
    },
  }));

  await page.route('**/api/agent/dashboard**', async (route) => {
    dashboardUrl = route.request().url();
    const lifecycle = new URL(dashboardUrl).searchParams.get('strategy_status') ?? 'all';
    dashboardRequestCounts.set(lifecycle, (dashboardRequestCounts.get(lifecycle) ?? 0) + 1);
    if (lifecycle === 'all') await new Promise((resolve) => setTimeout(resolve, 250));
    return route.fulfill({
      json: {
        access: { scope: 'user' },
        summary: { strategies: 1, reports: 7, snapshots: 0, real_orders: 8, open_real_orders: 0 },
        strategies: [],
        current_portfolios: [],
        settled_positions: [],
        reports: Array.from({ length: 7 }, (_, index) => ({
          id: `report-${index + 1}`,
          agent_id: 'test-user',
          agent_name: 'Test Agent',
          strategy_name: 'active-strategy',
          filename: `report-${index + 1}.md`,
          title: `Report ${index + 1}`,
          lessons_learned: null,
          next_steps: null,
          created_at: `2026-07-${String(13 - index).padStart(2, '0')}T12:00:00.000Z`,
        })),
        snapshots: [],
        real_orders: Array.from({ length: 8 }, (_, index) => ({
          id: `order-${index + 1}`,
          agent_id: 'test-user',
          agent_name: 'Test Agent',
          strategy_name: 'active-strategy',
          platform: 'kalshi',
          official_order_id: `official-${index + 1}`,
          client_order_id: null,
          market_slug_or_ticker: `AUDIT-MARKET-${index + 1}`,
          side: 'BUY',
          quantity: 1,
          price: 0.5,
          status: 'FILLED',
          error: {},
          request: {},
          official_response: {},
          created_at: `2026-07-${String(13 - index).padStart(2, '0')}T12:00:00.000Z`,
        })),
        sync_health: [],
        filter_options: {
          strategies: [
            {
              id: 'strategy-active', agent_id: 'test-user', strategy_name: 'active-strategy', agent_mode: 'paper',
              platform: 'kalshi', status: 'active', starting_balance: 1000,
            },
            {
              id: 'strategy-disabled', agent_id: 'test-user', strategy_name: 'disabled-strategy', agent_mode: 'paper',
              platform: 'kalshi', status: 'disabled', starting_balance: 1000,
            },
          ],
          platforms: ['all', 'polymarket', 'kalshi', 'polymarket_us'],
          agent_modes: ['all', 'paper', 'real'],
        },
      },
    });
  });

  await page.goto('/agents');

  await expect(page.getByLabel('Status')).toHaveValue('active');
  await expect(page.getByText('Report 4', { exact: true })).toBeVisible();
  expect(new URL(dashboardUrl).searchParams.get('strategy_status')).toBe('active');
  await expect(page.getByText('Report 5', { exact: true })).not.toBeVisible();
  await expect(page.getByText('AUDIT-MARKET-6', { exact: true })).toBeVisible();
  await expect(page.getByText('AUDIT-MARKET-7', { exact: true })).not.toBeVisible();

  await page.getByRole('button', { name: 'Show 3 more reports' }).click();
  await expect(page.getByText('Report 7', { exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Show 2 more audit entries' }).click();
  await expect(page.getByText('AUDIT-MARKET-8', { exact: true })).toBeVisible();

  const statusFilter = page.getByLabel('Status');
  await statusFilter.selectOption('all');
  await expect(page.getByRole('status')).toHaveText('Refreshing filtered view…');
  await expect(page.getByText('Report 1', { exact: true })).toBeVisible();
  await expect(page.locator('.skeleton')).toHaveCount(0);
  await expect.poll(() => dashboardRequestCounts.get('all')).toBe(1);
  await expect(page.getByRole('status')).not.toBeVisible();

  await statusFilter.selectOption('active');
  await expect(page.getByText('Report 4', { exact: true })).toBeVisible();
  await page.waitForTimeout(100);
  expect(dashboardRequestCounts.get('active')).toBe(1);
});
