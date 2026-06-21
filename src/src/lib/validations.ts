import { z } from 'zod';

export const buyTradeSchema = z.object({
  marketConditionId: z.string().min(1, 'marketConditionId is required').max(255),
  side: z.enum(['YES', 'NO']),
  amount: z
    .number()
    .min(1, 'Minimum trade is $1')
    .max(10000, 'Maximum trade is $10,000')
    .refine((n) => Number.isFinite(n), 'Amount must be a finite number'),
});

export const sellTradeSchema = z.object({
  positionId: z.string().uuid('Invalid position ID'),
  quantity: z.union([
    z.number().positive('Quantity must be positive'),
    z.literal('ALL'),
  ]),
});

export const closeTradeSchema = z.object({
  positionId: z.string().uuid('Invalid position ID'),
});

export const idempotencyKeySchema = z
  .string()
  .uuid('Idempotency key must be a UUID')
  .min(1);

export const marketQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional().default(20),
  offset: z.coerce.number().int().min(0).optional().default(0),
  category: z.string().optional(),
  search: z.string().optional(),
});

export type BuyTradeInput = z.infer<typeof buyTradeSchema>;
export type SellTradeInput = z.infer<typeof sellTradeSchema>;
export type CloseTradeInput = z.infer<typeof closeTradeSchema>;
export type MarketQueryInput = z.infer<typeof marketQuerySchema>;
