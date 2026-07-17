export function calculatePnLPercent(totalPnl: number, startingBalance: number): number {
  if (!Number.isFinite(totalPnl) || !Number.isFinite(startingBalance) || startingBalance <= 0) {
    return 0;
  }

  return (totalPnl / startingBalance) * 100;
}
