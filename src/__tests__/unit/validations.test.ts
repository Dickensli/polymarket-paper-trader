import { describe, it, expect } from 'vitest';
import {
  buyTradeSchema,
  sellTradeSchema,
  closeTradeSchema,
  marketQuerySchema,
  idempotencyKeySchema
} from '@/lib/validations';

describe('buyTradeSchema', () => {
  it('accepts valid buy request', () => {
    const result = buyTradeSchema.safeParse({
      marketConditionId: 'market-123',
      side: 'YES',
      amount: 100,
    });
    expect(result.success).toBe(true);
  });

  it('rejects missing marketConditionId', () => {
    const result = buyTradeSchema.safeParse({
      side: 'YES',
      amount: 100,
    });
    expect(result.success).toBe(false);
  });

  it('rejects invalid side', () => {
    const result = buyTradeSchema.safeParse({
      marketConditionId: 'market-123',
      side: 'MAYBE',
      amount: 100,
    });
    expect(result.success).toBe(false);
  });

  it('rejects amount < 1', () => {
    const result = buyTradeSchema.safeParse({
      marketConditionId: 'market-123',
      side: 'YES',
      amount: 0.5,
    });
    expect(result.success).toBe(false);
  });

  it('rejects amount > 10000', () => {
    const result = buyTradeSchema.safeParse({
      marketConditionId: 'market-123',
      side: 'YES',
      amount: 10001,
    });
    expect(result.success).toBe(false);
  });
});

describe('sellTradeSchema', () => {
  it('accepts valid sell request with ALL', () => {
    const result = sellTradeSchema.safeParse({
      positionId: '123e4567-e89b-12d3-a456-426614174000',
      quantity: 'ALL',
    });
    expect(result.success).toBe(true);
  });

  it('accepts valid sell request with positive number', () => {
    const result = sellTradeSchema.safeParse({
      positionId: '123e4567-e89b-12d3-a456-426614174000',
      quantity: 50,
    });
    expect(result.success).toBe(true);
  });

  it('rejects invalid positionId', () => {
    const result = sellTradeSchema.safeParse({
      positionId: 'not-a-uuid',
      quantity: 'ALL',
    });
    expect(result.success).toBe(false);
  });

  it('rejects negative quantity', () => {
    const result = sellTradeSchema.safeParse({
      positionId: '123e4567-e89b-12d3-a456-426614174000',
      quantity: -5,
    });
    expect(result.success).toBe(false);
  });
});

describe('closeTradeSchema', () => {
  it('accepts valid close request', () => {
    const result = closeTradeSchema.safeParse({
      positionId: '123e4567-e89b-12d3-a456-426614174000',
    });
    expect(result.success).toBe(true);
  });

  it('rejects invalid positionId', () => {
    const result = closeTradeSchema.safeParse({
      positionId: 'not-a-uuid',
    });
    expect(result.success).toBe(false);
  });
});

describe('idempotencyKeySchema', () => {
  it('accepts valid UUID', () => {
    expect(idempotencyKeySchema.safeParse('123e4567-e89b-12d3-a456-426614174000').success).toBe(true);
  });
  
  it('rejects invalid UUID', () => {
    expect(idempotencyKeySchema.safeParse('not-a-uuid').success).toBe(false);
  });
});

describe('marketQuerySchema', () => {
  it('accepts valid query', () => {
    expect(marketQuerySchema.safeParse({ limit: 10, offset: 5 }).success).toBe(true);
  });
});
