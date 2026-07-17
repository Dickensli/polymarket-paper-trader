import { z } from 'zod';

export const tradeProposalSchema = z.object({
  thesis: z.string().min(20).max(4000),
  rules_verified: z.literal(true),
  source_urls: z.array(z.url()).min(1).max(20),
  fair_probability: z.number().min(0.001).max(0.999),
  confidence_low: z.number().min(0).max(1),
  confidence_high: z.number().min(0).max(1),
  quote_observed_at: z.iso.datetime(),
  observed_price: z.number().min(0.001).max(0.999),
  available_depth: z.number().positive(),
  net_edge: z.number().positive().max(1),
  proposed_nav_pct: z.number().positive().max(1),
  exit_condition: z.string().min(10).max(2000),
  invalidation_condition: z.string().min(10).max(2000),
}).strict();

export type TradeProposal = z.infer<typeof tradeProposalSchema>;

export interface ProposalServerFacts {
  now?: Date;
  executablePrice: number;
  executableDepth: number;
  requestedShares: number;
  requestedNotional: number;
  portfolioNav: number;
}

export function validateTradeProposal(
  proposal: TradeProposal,
  facts: ProposalServerFacts,
): { valid: boolean; reasons: string[] } {
  const reasons: string[] = [];
  const now = facts.now ?? new Date();
  const observedAt = new Date(proposal.quote_observed_at);
  if (now.getTime() - observedAt.getTime() > 5 * 60 * 1000 || observedAt.getTime() > now.getTime() + 30_000) {
    reasons.push('QUOTE_STALE');
  }
  if (proposal.confidence_low > proposal.fair_probability || proposal.confidence_high < proposal.fair_probability || proposal.confidence_low > proposal.confidence_high) {
    reasons.push('INVALID_CONFIDENCE_INTERVAL');
  }
  if (Math.abs(proposal.observed_price - facts.executablePrice) > 0.02) {
    reasons.push('PRICE_MISMATCH');
  }
  if (proposal.available_depth > facts.executableDepth + 0.001) {
    reasons.push('DEPTH_EXAGGERATED');
  }
  if (facts.requestedShares > facts.executableDepth + 0.001) {
    reasons.push('INSUFFICIENT_EXECUTABLE_DEPTH');
  }
  const serverEdge = proposal.fair_probability - facts.executablePrice;
  if (proposal.net_edge > serverEdge + 0.005) {
    reasons.push('EDGE_EXAGGERATED');
  }
  const serverNavPct = facts.portfolioNav > 0 ? facts.requestedNotional / facts.portfolioNav : 1;
  if (Math.abs(proposal.proposed_nav_pct - serverNavPct) > 0.01) {
    reasons.push('NAV_PERCENT_MISMATCH');
  }
  return { valid: reasons.length === 0, reasons };
}
