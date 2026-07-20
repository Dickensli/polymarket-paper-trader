type SnapshotLike = {
  capturedAt?: Date | string | null;
  totalValue: string | number;
  positions?: unknown;
};

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? value as Record<string, unknown> : {};
}

function finiteNumber(value: unknown): number | null {
  if (value && typeof value === 'object' && 'value' in value) {
    return finiteNumber((value as Record<string, unknown>).value);
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function positionQuantity(position: Record<string, unknown>): number {
  for (const key of ['shares', 'position_fp', 'quantity', 'position', 'netPosition', 'qtyAvailable']) {
    const parsed = finiteNumber(position[key]);
    if (parsed !== null) return Math.abs(parsed);
  }
  return 0;
}

export function portfolioSnapshotHasUnpricedPositions(value: unknown): boolean {
  if (!Array.isArray(value)) return false;
  return value.some((candidate) => {
    const position = record(candidate);
    if (positionQuantity(position) <= 0) return false;
    const status = String(position.pricingStatus ?? position.pricing_status ?? '').toLowerCase();
    if (status === 'unpriced') return true;
    if (status === 'priced') return false;
    if ('currentPrice' in position) {
      const price = finiteNumber(position.currentPrice);
      return price === null || price <= 0;
    }
    return false;
  });
}

export function isPortfolioSnapshotUsableForPerformance(snapshot: Pick<SnapshotLike, 'totalValue' | 'positions'>): boolean {
  const nav = finiteNumber(snapshot.totalValue);
  return nav !== null && nav > 0 && !portfolioSnapshotHasUnpricedPositions(snapshot.positions);
}

export function calculateVerifiedMaxDrawdownPct(
  snapshots: SnapshotLike[],
  startingBalance: number,
  baselineAt?: Date | string | null,
): number {
  const baselineMs = baselineAt ? new Date(baselineAt).getTime() : Number.NEGATIVE_INFINITY;
  const ordered = [...snapshots]
    .filter((snapshot) => {
      if (!isPortfolioSnapshotUsableForPerformance(snapshot)) return false;
      if (!Number.isFinite(baselineMs)) return true;
      const capturedMs = snapshot.capturedAt ? new Date(snapshot.capturedAt).getTime() : Number.POSITIVE_INFINITY;
      return capturedMs >= baselineMs;
    })
    .sort((left, right) => {
      const leftMs = left.capturedAt ? new Date(left.capturedAt).getTime() : 0;
      const rightMs = right.capturedAt ? new Date(right.capturedAt).getTime() : 0;
      return leftMs - rightMs;
    });

  let peak = Number.isFinite(startingBalance) && startingBalance > 0 ? startingBalance : 0;
  let maxDrawdownPct = 0;
  for (const snapshot of ordered) {
    const nav = Number(snapshot.totalValue);
    peak = Math.max(peak, nav);
    if (peak > 0) maxDrawdownPct = Math.max(maxDrawdownPct, (peak - nav) / peak);
  }
  return maxDrawdownPct;
}
