export type TradingPlatform = 'polymarket' | 'kalshi' | 'polymarket_us';

export function normalizePlatform(value: unknown): TradingPlatform {
  if (value === 'kalshi') return 'kalshi';
  if (value === 'polymarket_us') return 'polymarket_us';
  return 'polymarket';
}

export function getPlatformFromEmail(email: string | null | undefined): TradingPlatform | null {
  if (!email) return null;
  if (email.includes('+kalshi+')) return 'kalshi';
  if (email.includes('+polymarket_us+')) return 'polymarket_us';
  if (email.includes('+polymarket+')) return 'polymarket';
  return null;
}

export function getUserPlatform(settings: unknown, email?: string | null): TradingPlatform {
  if (settings && typeof settings === 'object' && 'platform' in settings) {
    return normalizePlatform((settings as Record<string, unknown>).platform);
  }
  if (email) {
    const fromEmail = getPlatformFromEmail(email);
    if (fromEmail) return fromEmail;
  }
  return 'polymarket';
}

