type PaperFeePlatform = 'polymarket' | 'kalshi' | 'polymarket_us';

const DEFAULT_FEE_RATE_BPS: Record<PaperFeePlatform, number> = {
  polymarket: 0,
  // Conservative shadow estimates; deployments can override these with the
  // current venue/account schedule through server-owned environment values.
  kalshi: 700,
  polymarket_us: 100,
};

function nonNegative(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

export function resolvePaperFeeRateBps(
  platform: PaperFeePlatform,
  riskConfig: unknown,
  env: Record<string, string | undefined> = process.env,
): number {
  const envKey = platform === 'kalshi'
    ? 'KALSHI_PAPER_FEE_RATE_BPS'
    : platform === 'polymarket_us'
      ? 'POLYMARKET_US_PAPER_FEE_RATE_BPS'
      : 'POLYMARKET_PAPER_FEE_RATE_BPS';
  const serverRate = nonNegative(env[envKey]) ?? DEFAULT_FEE_RATE_BPS[platform];
  const config = riskConfig && typeof riskConfig === 'object'
    ? riskConfig as Record<string, unknown>
    : {};
  const requested = nonNegative(config.paper_fee_rate_bps ?? config.paperFeeRateBps);
  return requested === null ? serverRate : Math.max(serverRate, requested);
}
