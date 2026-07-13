import { describe, expect, it } from 'vitest';
import { isOpenRealOrderStatus } from '@/lib/real-orders';

describe('isOpenRealOrderStatus', () => {
  it.each([
    'PENDING',
    'SUBMITTING',
    'SUBMITTED',
    'OPEN',
    'LIVE',
    'RESTING',
    'PARTIALLY_FILLED',
  ])('treats %s as an open order', (status) => {
    expect(isOpenRealOrderStatus(status)).toBe(true);
  });

  it.each(['EXECUTED', 'FILLED', 'CANCELED', 'REJECTED', 'ERROR'])('treats %s as closed', (status) => {
    expect(isOpenRealOrderStatus(status)).toBe(false);
  });
});
