import { describe, expect, it } from 'vitest';
import { tradeProposalSchema, validateTradeProposal } from '@/lib/trade-proposal';

const proposal = {
  thesis: 'Official sources imply the selected outcome is materially underpriced.',
  rules_verified: true,
  source_urls: ['https://example.com/source'],
  fair_probability: 0.65,
  confidence_low: 0.58,
  confidence_high: 0.72,
  quote_observed_at: '2026-07-16T12:00:00.000Z',
  observed_price: 0.5,
  available_depth: 100,
  net_edge: 0.14,
  proposed_nav_pct: 0.02,
  exit_condition: 'Exit after the catalyst or if the edge closes.',
  invalidation_condition: 'Do not enter if the official source changes.',
};

describe('structured trade proposal gate', () => {
  it('accepts a fresh proposal whose claims agree with server facts', () => {
    const parsed = tradeProposalSchema.parse(proposal);
    const result = validateTradeProposal(parsed, {
      now: new Date('2026-07-16T12:02:00.000Z'),
      executablePrice: 0.51,
      executableDepth: 100,
      requestedShares: 20,
      requestedNotional: 10.2,
      portfolioNav: 500,
    });
    expect(result).toEqual({ valid: true, reasons: [] });
  });

  it('rejects stale, exaggerated, or under-supported claims', () => {
    const parsed = tradeProposalSchema.parse({
      ...proposal,
      quote_observed_at: '2026-07-16T11:00:00.000Z',
      observed_price: 0.4,
      available_depth: 1000,
      net_edge: 0.3,
      proposed_nav_pct: 0.2,
    });
    const result = validateTradeProposal(parsed, {
      now: new Date('2026-07-16T12:02:00.000Z'),
      executablePrice: 0.55,
      executableDepth: 10,
      requestedShares: 20,
      requestedNotional: 11,
      portfolioNav: 500,
    });
    expect(result.valid).toBe(false);
    expect(result.reasons).toEqual(expect.arrayContaining([
      'QUOTE_STALE',
      'PRICE_MISMATCH',
      'DEPTH_EXAGGERATED',
      'EDGE_EXAGGERATED',
      'NAV_PERCENT_MISMATCH',
    ]));
  });
});
