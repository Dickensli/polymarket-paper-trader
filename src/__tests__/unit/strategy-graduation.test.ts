import { describe, expect, it } from 'vitest';
import { evaluateStrategyGraduation, isPolicyViolationDecision } from '@/lib/strategy-graduation';

describe('shadow graduation scorecard', () => {
  it('graduates only after every server-side criterion passes', () => {
    const result = evaluateStrategyGraduation({
      totalDecisions: 120,
      acceptedTrades: 80,
      resolvedPredictions: 35,
      netReturnPct: 0.04,
      maxDrawdownPct: 0.06,
      brierScore: 0.18,
      policyViolations: 0,
    });
    expect(result.graduated).toBe(true);
    expect(result.shouldNotify).toBe(true);
    expect(result.blocksPaperTrading).toBe(false);
    expect(result.paperTradingAllowed).toBe(true);
    expect(result.tradingPolicy).toEqual({
      paperDecisionImpact: 'none',
      paperDecisionSequence: 'decide_execute_verify_then_query_graduation',
      manufactureDecisionVolumeAllowed: false,
      realRiskAddingOrdersRequireGraduation: true,
      humanApprovalStillRequired: true,
    });
    expect(result.unmetRequirements).toEqual([]);
  });

  it('explains every unmet requirement instead of trusting the agent', () => {
    const result = evaluateStrategyGraduation({
      totalDecisions: 20,
      acceptedTrades: 10,
      resolvedPredictions: 5,
      netReturnPct: -0.01,
      maxDrawdownPct: 0.12,
      brierScore: 0.27,
      policyViolations: 2,
    });
    expect(result.graduated).toBe(false);
    expect(result.shouldNotify).toBe(false);
    expect(result.blocksPaperTrading).toBe(false);
    expect(result.paperTradingAllowed).toBe(true);
    expect(result.tradingPolicy.paperDecisionImpact).toBe('none');
    expect(result.tradingPolicy.manufactureDecisionVolumeAllowed).toBe(false);
    expect(result.unmetRequirements).toHaveLength(7);
  });

  it('does not treat ordinary proposal validation failures as policy violations', () => {
    expect(isPolicyViolationDecision({ status: 'REJECTED', rejectionReasons: ['PRICE_MISMATCH'] })).toBe(false);
    expect(isPolicyViolationDecision({ status: 'REJECTED', rejectionReasons: ['SERVER_RISK_REJECTED'] })).toBe(true);
    expect(isPolicyViolationDecision({ status: 'ACCEPTED', rejectionReasons: ['SERVER_RISK_REJECTED'] })).toBe(false);
  });
});
