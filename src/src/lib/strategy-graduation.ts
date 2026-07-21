import { calculateVerifiedMaxDrawdownPct } from '@/lib/strategy-snapshot-quality';

export interface GraduationMetrics {
  totalDecisions: number;
  acceptedTrades: number;
  resolvedPredictions: number;
  netReturnPct: number;
  maxDrawdownPct: number;
  brierScore: number | null;
  policyViolations: number;
}

export interface GraduationCriteria {
  minDecisions: number;
  minAcceptedTrades: number;
  minResolvedPredictions: number;
  minNetReturnPct: number;
  maxDrawdownPct: number;
  maxBrierScore: number;
  maxPolicyViolations: number;
}

export const DEFAULT_GRADUATION_CRITERIA: GraduationCriteria = {
  minDecisions: 100,
  minAcceptedTrades: 50,
  minResolvedPredictions: 30,
  minNetReturnPct: 0,
  maxDrawdownPct: 0.08,
  maxBrierScore: 0.20,
  maxPolicyViolations: 0,
};

const POLICY_VIOLATION_REASONS = new Set([
  'POLICY_VIOLATION',
  'SERVER_RISK_REJECTED',
  'RISK_LIMIT_EXCEEDED',
]);

export function isPolicyViolationDecision(decision: {
  status: string;
  rejectionReasons?: unknown;
}): boolean {
  if (decision.status !== 'REJECTED' || !Array.isArray(decision.rejectionReasons)) return false;
  return decision.rejectionReasons.some((reason) => POLICY_VIOLATION_REASONS.has(String(reason)));
}

export function evaluateStrategyGraduation(
  metrics: GraduationMetrics,
  criteria: GraduationCriteria = DEFAULT_GRADUATION_CRITERIA,
) {
  const unmetRequirements: string[] = [];
  if (metrics.totalDecisions < criteria.minDecisions) unmetRequirements.push('MIN_DECISIONS');
  if (metrics.acceptedTrades < criteria.minAcceptedTrades) unmetRequirements.push('MIN_ACCEPTED_TRADES');
  if (metrics.resolvedPredictions < criteria.minResolvedPredictions) unmetRequirements.push('MIN_RESOLVED_PREDICTIONS');
  if (metrics.netReturnPct <= criteria.minNetReturnPct) unmetRequirements.push('POSITIVE_NET_RETURN');
  if (metrics.maxDrawdownPct > criteria.maxDrawdownPct) unmetRequirements.push('MAX_DRAWDOWN');
  if (metrics.brierScore === null || metrics.brierScore > criteria.maxBrierScore) unmetRequirements.push('BRIER_SCORE');
  if (metrics.policyViolations > criteria.maxPolicyViolations) unmetRequirements.push('POLICY_VIOLATIONS');
  const graduated = unmetRequirements.length === 0;
  return {
    graduated,
    shouldNotify: graduated,
    blocksPaperTrading: false,
    paperTradingAllowed: true,
    tradingPolicy: {
      paperDecisionImpact: 'none',
      paperDecisionSequence: 'decide_execute_verify_then_query_graduation',
      manufactureDecisionVolumeAllowed: false,
      realRiskAddingOrdersRequireGraduation: true,
      humanApprovalStillRequired: true,
    },
    metrics,
    criteria,
    unmetRequirements,
  };
}

export async function getStrategyGraduation(
  strategy: { id: string; userId: string; startingBalance: string | number; metadata?: unknown },
) {
  const [{ getDb }, schema, drizzle] = await Promise.all([
    import('@/lib/db'),
    import('@/lib/db/schema'),
    import('drizzle-orm'),
  ]);
  const db = getDb();
  const [{ getPortfolio }, decisions, snapshots, resolvedPositions] = await Promise.all([
    import('@/lib/trading-engine'),
    db.select().from(schema.strategyDecisions)
      .where(drizzle.eq(schema.strategyDecisions.strategyId, strategy.id)),
    db.select().from(schema.portfolioSnapshots)
      .where(drizzle.eq(schema.portfolioSnapshots.strategyId, strategy.id))
      .orderBy(drizzle.asc(schema.portfolioSnapshots.capturedAt)),
    db.select().from(schema.positions)
      .where(drizzle.and(
        drizzle.eq(schema.positions.userId, strategy.userId),
        drizzle.isNotNull(schema.positions.resolvedAt),
      )),
  ]);

  const accepted = decisions.filter(
    (decision) => decision.status === 'ACCEPTED' && decision.paperTradeOrderId,
  );
  const resolutions = new Map(
    resolvedPositions.map((position) => [
      `${position.marketId}:${position.outcome}`,
      Number(position.currentPrice) >= 0.5 ? 1 : 0,
    ]),
  );
  const predictionByContract = new Map<string, number>();
  for (const decision of accepted) {
    const actual = resolutions.get(`${decision.marketId}:${decision.outcome}`);
    const proposal = decision.proposal as Record<string, unknown>;
    const probability = Number(proposal?.fair_probability);
    if (actual === undefined || !Number.isFinite(probability)) continue;
    predictionByContract.set(`${decision.marketId}:${decision.outcome}`, (probability - actual) ** 2);
  }
  const brierTerms = [...predictionByContract.values()];

  const startingBalance = Number(strategy.startingBalance);
  const currentNav = (await getPortfolio(strategy.userId)).totalValue;
  const metadata = strategy.metadata && typeof strategy.metadata === 'object'
    ? strategy.metadata as Record<string, unknown>
    : {};
  const baselineCandidates = [metadata.performance_baseline_at, metadata.last_destructive_reset_at]
    .map((value) => value ? new Date(String(value)).getTime() : Number.NaN)
    .filter(Number.isFinite);
  const baselineAt = baselineCandidates.length > 0 ? new Date(Math.max(...baselineCandidates)) : null;
  const maxDrawdownPct = calculateVerifiedMaxDrawdownPct(snapshots, startingBalance, baselineAt);

  return evaluateStrategyGraduation({
    totalDecisions: decisions.length,
    acceptedTrades: accepted.length,
    resolvedPredictions: brierTerms.length,
    netReturnPct: startingBalance > 0 ? (currentNav - startingBalance) / startingBalance : 0,
    maxDrawdownPct,
    brierScore: brierTerms.length > 0
      ? brierTerms.reduce((sum, value) => sum + value, 0) / brierTerms.length
      : null,
    policyViolations: decisions.filter(isPolicyViolationDecision).length,
  });
}
