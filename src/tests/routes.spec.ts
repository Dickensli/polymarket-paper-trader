import { test, expect } from '@playwright/test';

test.describe('Application Routes & Interactions', () => {
  test('Dashboard loads successfully', async ({ page }) => {
    await page.goto('/');
    // Check if the page has loaded by expecting the title or a generic element
    await expect(page.locator('body')).toBeVisible();
  });

  test('Agents page loads successfully', async ({ page }) => {
    await page.goto('/agents');
    await expect(page.locator('body')).toBeVisible();
  });

  test('Portfolio page loads successfully', async ({ page }) => {
    await page.goto('/portfolio');
    await expect(page.locator('body')).toBeVisible();
  });

  test('Settings page loads successfully', async ({ page }) => {
    await page.goto('/settings');
    await expect(page.locator('body')).toBeVisible();
  });

  test('Leaderboard Analytics chart and filters work correctly', async ({ page }) => {
    await page.goto('/leaderboard/analytics');
    
    // Ensure the page is visible and wait for loading to finish
    await expect(page.locator('body')).toBeVisible();
    await expect(page.locator('text=Loading analytics engine...')).not.toBeVisible({ timeout: 10000 });
    
    // Check if Time Range pills are present
    const timeRanges = ['1H', '6H', '1D', '1W', 'ALL'];
    for (const range of timeRanges) {
      const button = page.locator(`button:has-text("${range}")`);
      await expect(button).toBeVisible();
    }
    
    // Test interaction: click "1W" filter
    const oneWeekButton = page.locator('button:has-text("1W")');
    await oneWeekButton.click();
    
    // Wait for network requests or UI to update
    await page.waitForTimeout(1000);
    
    // Verify the button gets the active class (analytics-pill-active)
    await expect(oneWeekButton).toHaveClass(/analytics-pill-active/);
  });
});
