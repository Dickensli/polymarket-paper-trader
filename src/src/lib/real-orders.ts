const OPEN_REAL_ORDER_STATUSES = new Set([
  'PENDING',
  'SUBMITTING',
  'SUBMITTED',
  'OPEN',
  'LIVE',
  'RESTING',
  'PARTIALLY_FILLED',
]);

export function isOpenRealOrderStatus(status: string): boolean {
  return OPEN_REAL_ORDER_STATUSES.has(status.toUpperCase());
}
