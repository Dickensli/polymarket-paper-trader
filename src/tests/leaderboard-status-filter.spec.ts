import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.route('**/api/auth/session**', (route) => route.fulfill({
    json: {
      user: { id: 'test-user', name: 'Test User', email: 'test@example.com' },
      expires: new Date(Date.now() + 86_400_000).toISOString(),
    },
  }));
});

test('leaderboard defaults to active and can show disabled strategies', async ({ page }) => {
  await page.route('**/api/leaderboard?**', (route) => {
    const status = new URL(route.request().url()).searchParams.get('strategy_status');
    const disabled = status === 'disabled';
    return route.fulfill({
      json: {
        data: [{
          rank: 1,
          userId: disabled ? 'disabled-user' : 'active-user',
          name: disabled ? 'Disabled Agent' : 'Active Agent',
          image: null,
          portfolioValue: 10_100,
          totalPnL: 100,
          returnPct: 1,
        }],
        meta: { page: 1, totalPages: 1 },
      },
    });
  });

  await page.goto('/leaderboard');

  const statusFilter = page.getByLabel('Strategy status');
  await expect(statusFilter).toHaveValue('active');
  await expect(page.getByText('Active Agent')).toBeVisible();
  await expect(page.getByText('Disabled Agent')).not.toBeVisible();

  await statusFilter.selectOption('disabled');
  await expect(page.getByText('Disabled Agent')).toBeVisible();
  await expect(page.getByText('Active Agent')).not.toBeVisible();
});

test('analytics defaults to active and reloads chart series for disabled strategies', async ({ page }) => {
  await page.route('**/api/leaderboard/history**', (route) => {
    const url = new URL(route.request().url());
    const disabled = url.searchParams.get('strategy_status') === 'disabled';
    const hourly = url.searchParams.get('granularity') === 'hourly';
    const strategy = disabled ? 'Disabled Strategy' : 'Active Strategy';
    const dates = hourly ? ['2026-07-13T12', '2026-07-13T13'] : ['2026-07-12', '2026-07-13'];
    return route.fulfill({
      json: {
        success: true,
        strategies: [strategy],
        history: dates.map((date, index) => ({
          date,
          [strategy]: 10_000 + index * 100,
          [`${strategy}_pnl`]: index * 100,
        })),
        meta: { totalPages: 1 },
      },
    });
  });

  await page.goto('/leaderboard/analytics');

  const statusFilter = page.getByLabel('Strategy status');
  await expect(statusFilter).toHaveValue('active');
  await expect(page.locator('.analytics-legend-item').filter({ hasText: 'Active Strategy' })).toBeVisible();

  await statusFilter.selectOption('disabled');
  await expect(page.locator('.analytics-legend-item').filter({ hasText: 'Disabled Strategy' })).toBeVisible();
  await expect(page.locator('.analytics-legend-item').filter({ hasText: 'Active Strategy' })).toHaveCount(0);
});
