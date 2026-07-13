const YEAR_MS = 365.25 * 24 * 60 * 60 * 1000;

export function calculatePeriodReturnPct(previousNav: number | null, nav: number, netExternalFlow = 0) {
  if (previousNav === null || previousNav <= 0) return 0;
  return (((nav - netExternalFlow) / previousNav) - 1) * 100;
}

export function chainTwrPct(previousTwrPct: number | null, periodReturnPct: number) {
  const previousGrowth = 1 + (previousTwrPct ?? 0) / 100;
  return (previousGrowth * (1 + periodReturnPct / 100) - 1) * 100;
}

/**
 * Annualized money-weighted return when there are no recorded external flows.
 * This is the two-cash-flow XIRR case: initial strategy capital and current NAV.
 */
export function calculateNoFlowMwrPct(startingBalance: number, nav: number, startedAt: Date, asOf: Date) {
  const years = (asOf.getTime() - startedAt.getTime()) / YEAR_MS;
  // Annualizing very short histories produces explosive, non-actionable values.
  if (startingBalance <= 0 || nav < 0 || years < 30 / 365.25) return null;
  const result = (Math.pow(nav / startingBalance, 1 / years) - 1) * 100;
  return Number.isFinite(result) && Math.abs(result) < 100_000_000 ? result : null;
}
