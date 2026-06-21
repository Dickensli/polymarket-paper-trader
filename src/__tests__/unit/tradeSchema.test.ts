import { describe, it, expect } from 'vitest';
import { buyTradeSchema } from '../../src/lib/validations';

describe('buyTradeSchema (useTrade request validation)', () => {
  it('should validate a correct trade payload as sent by useTrade.ts', () => {
    const payload = {
      marketConditionId: '2323004', // e.g., req.marketId
      side: 'YES',                  // req.outcome
      amount: 10,                   // req.shares * req.price
    };

    const result = buyTradeSchema.safeParse(payload);
    expect(result.success).toBe(true);
  });

  it('should reject missing marketConditionId', () => {
    const payload = {
      side: 'YES',
      amount: 10,
    };
    const result = buyTradeSchema.safeParse(payload);
    expect(result.success).toBe(false);
  });

  it('should reject invalid amount', () => {
    const payload = {
      marketConditionId: '2323004',
      side: 'YES',
      amount: 0, // minimum is 1
    };
    const result = buyTradeSchema.safeParse(payload);
    expect(result.success).toBe(false);
  });

  it('should reject invalid side', () => {
    const payload = {
      marketConditionId: '2323004',
      side: 'MAYBE', // only YES or NO
      amount: 10,
    };
    const result = buyTradeSchema.safeParse(payload);
    expect(result.success).toBe(false);
  });
});
