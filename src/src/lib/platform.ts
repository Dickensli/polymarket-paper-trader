export type TradingPlatform = 'polymarket' | 'kalshi' | 'polymarket_us';

export function normalizePlatform(value: unknown): TradingPlatform {
  if (value === 'kalshi') return 'kalshi';
  if (value === 'polymarket_us') return 'polymarket_us';
  return 'polymarket';
}

export function getUserPlatform(settings: unknown): TradingPlatform {
  if (settings && typeof settings === 'object' && 'platform' in settings) {
    return normalizePlatform((settings as Record<string, unknown>).platform);
  }
  return 'polymarket';
}

