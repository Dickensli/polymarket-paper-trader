type AgentMode = 'paper' | 'real';

type ExistingStrategy = {
  riskConfig: unknown;
  metadata: unknown;
  schedule: string | null;
};

type RequestedUpdate = {
  riskConfig?: unknown;
  metadata?: Record<string, unknown>;
  schedule?: string;
};

export function buildInitialStrategyMetadata(
  agentMode: AgentMode,
  requested: Record<string, unknown> | undefined,
): Record<string, unknown> {
  const safeRequested = Object.fromEntries(
    Object.entries(requested ?? {}).filter(([key]) => ![
      'real_trading_enabled',
      'require_shadow_graduation',
      'graduation_source_strategy_id',
    ].includes(key)),
  );
  return {
    ...safeRequested,
    registeredAt: new Date().toISOString(),
    // Registration is an agent-authenticated endpoint, not an administrative
    // approval channel. Real execution can only be enabled out of band.
    real_trading_enabled: false,
    ...(agentMode === 'real' ? { require_shadow_graduation: true } : {}),
  };
}

export function existingStrategyUpdate(
  _existing: ExistingStrategy,
  requested: RequestedUpdate,
): { schedule?: string } {
  // Risk limits and security metadata become immutable after registration.
  // A strategy may still synchronize its scheduler expression idempotently.
  return requested.schedule === undefined ? {} : { schedule: requested.schedule };
}
