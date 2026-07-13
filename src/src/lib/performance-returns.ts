const YEAR_MS = 365.25 * 24 * 60 * 60 * 1000;

export function calculatePeriodReturnPct(previousNav: number | null, nav: number, netExternalFlow = 0) {
  if (previousNav === null || previousNav <= 0) return 0;
  return (((nav - netExternalFlow) / previousNav) - 1) * 100;
}

export function chainTwrPct(previousTwrPct: number | null, periodReturnPct: number) {
  const previousGrowth = 1 + (previousTwrPct ?? 0) / 100;
  return (previousGrowth * (1 + periodReturnPct / 100) - 1) * 100;
}

export type CapitalFlow = { amount: number; navBeforeFlow: number; occurredAt: Date };

export function calculateFlowAdjustedPeriodReturnPct(previousNav: number | null, nav: number, flows: CapitalFlow[]) {
  if (previousNav === null || previousNav <= 0) return 0;
  let growth = 1;
  let base = previousNav;
  for (const flow of [...flows].sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime())) {
    if (flow.navBeforeFlow > 0 && base > 0) growth *= flow.navBeforeFlow / base;
    base = flow.navBeforeFlow + flow.amount;
  }
  if (base > 0) growth *= nav / base;
  return (growth - 1) * 100;
}

/** Newton/bisection XIRR for initial capital, rare external flows, and terminal NAV. */
export function calculateMoneyWeightedReturnPct(
  startingBalance: number,
  startedAt: Date,
  nav: number,
  asOf: Date,
  flows: CapitalFlow[],
) {
  if (startingBalance <= 0 || nav < 0 || asOf.getTime() - startedAt.getTime() < 30 * 86400000) return null;
  const cashFlows = [
    { amount: -startingBalance, date: startedAt },
    ...flows.map((flow) => ({ amount: -flow.amount, date: flow.occurredAt })),
    { amount: nav, date: asOf },
  ];
  const npv = (rate: number) => cashFlows.reduce((sum, flow) => {
    const years = (flow.date.getTime() - startedAt.getTime()) / YEAR_MS;
    return sum + flow.amount / Math.pow(1 + rate, years);
  }, 0);
  let low = -0.9999;
  let high = 10;
  while (npv(low) * npv(high) > 0 && high < 1_000_000) high *= 10;
  if (npv(low) * npv(high) > 0) return null;
  for (let index = 0; index < 100; index += 1) {
    const mid = (low + high) / 2;
    if (npv(low) * npv(mid) <= 0) high = mid;
    else low = mid;
  }
  const result = ((low + high) / 2) * 100;
  return Number.isFinite(result) && Math.abs(result) < 100_000_000 ? result : null;
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
