export type PositionPlatform = 'polymarket' | 'kalshi' | 'polymarket_us';

type PositionPlatformFields = {
  platform?: PositionPlatform | null;
  tokenId?: string | null;
  marketId?: string | null;
};

/**
 * Canonical token/ticker identifiers take precedence over legacy stored values.
 * Older Kalshi positions were created while the platform column still defaulted
 * to polymarket, so trusting that column alone can drop valid holdings from NAV.
 */
export function inferPositionPlatform(position: PositionPlatformFields): PositionPlatform {
  const tokenId = position.tokenId ?? '';
  const marketId = position.marketId ?? '';

  if (
    tokenId.startsWith('kalshi:KX')
    || /^KX[^:]+:(YES|NO)$/.test(tokenId)
    || marketId.startsWith('KX')
  ) {
    return 'kalshi';
  }

  if (tokenId.startsWith('polymarket-us:') || tokenId.startsWith('polymarket_us:')) {
    return 'polymarket_us';
  }

  return position.platform ?? 'polymarket';
}

export function positionBelongsToPlatform(
  position: PositionPlatformFields,
  platform: PositionPlatform,
): boolean {
  return inferPositionPlatform(position) === platform;
}
