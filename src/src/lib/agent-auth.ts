/**
 * Agent requests authenticate with the single server-managed AGENT_SECRET.
 * Keep this helper deliberately small so the production boundary can be
 * regression-tested without bootstrapping NextAuth.
 */
export function isValidAgentSecret(
  suppliedSecret: string | null,
  expectedSecret: string | undefined,
): boolean {
  return Boolean(suppliedSecret && expectedSecret && suppliedSecret === expectedSecret);
}
