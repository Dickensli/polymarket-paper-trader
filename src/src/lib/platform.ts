export type TradingPlatform = 'polymarket' | 'kalshi';

export function normalizePlatform(value: unknown): TradingPlatform {
  return value === 'kalshi' ? 'kalshi' : 'polymarket';
}

export function getUserPlatform(settings: unknown): TradingPlatform {
  if (settings && typeof settings === 'object' && 'platform' in settings) {
    return normalizePlatform((settings as Record<string, unknown>).platform);
  }
  return 'polymarket';
}

