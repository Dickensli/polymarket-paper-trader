/**
 * Formats a decimal price (0-1) into a probability/price percentage string.
 * e.g., 0.55 -> "55", 0.0015 -> "0.2", 0.9985 -> "99.9"
 */
export function formatProbability(price: number): string {
  const pct = price * 100;
  if (pct % 1 === 0) {
    return pct.toFixed(0);
  }
  return pct.toFixed(1);
}
