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

export const CURRENT_REPORT_MEMORY_GENERATION = 'report-memory-v3';

function metadataRecord(metadata: unknown): Record<string, unknown> {
  return metadata && typeof metadata === 'object'
    ? metadata as Record<string, unknown>
    : {};
}

export function resolveStrategyReportMemory(metadata: unknown): {
  ready: boolean;
  generation: string;
  resetAt: Date | null;
} {
  const record = metadataRecord(metadata);
  const rawResetAt = record.report_memory_reset_at;
  const resetAt = rawResetAt ? new Date(String(rawResetAt)) : null;
  const ready = record.report_memory_generation === CURRENT_REPORT_MEMORY_GENERATION
    && resetAt !== null
    && Number.isFinite(resetAt.getTime());
  return {
    ready,
    generation: CURRENT_REPORT_MEMORY_GENERATION,
    resetAt: ready ? resetAt : null,
  };
}

export function buildInitialStrategyMetadata(
  agentMode: AgentMode,
  requested: Record<string, unknown> | undefined,
  now = new Date(),
): Record<string, unknown> {
  const safeRequested = Object.fromEntries(
    Object.entries(requested ?? {}).filter(([key]) => ![
      'real_trading_enabled',
      'require_shadow_graduation',
      'graduation_source_strategy_id',
      'report_memory_generation',
      'report_memory_reset_at',
    ].includes(key)),
  );
  const initializeReportMemory = requested?.report_memory_generation === CURRENT_REPORT_MEMORY_GENERATION;
  return {
    ...safeRequested,
    registeredAt: now.toISOString(),
    // Registration is an agent-authenticated endpoint, not an administrative
    // approval channel. Real execution can only be enabled out of band.
    real_trading_enabled: false,
    ...(agentMode === 'real' ? { require_shadow_graduation: true } : {}),
    ...(initializeReportMemory ? {
      report_memory_generation: CURRENT_REPORT_MEMORY_GENERATION,
      report_memory_reset_at: now.toISOString(),
    } : {}),
  };
}

export function existingStrategyUpdate(
  existing: ExistingStrategy,
  requested: RequestedUpdate,
  now = new Date(),
): { schedule?: string; metadata?: Record<string, unknown> } {
  // Risk limits and security metadata become immutable after registration.
  // A strategy may still synchronize its scheduler expression idempotently
  // and opt into the current, server-timestamped report-memory generation once.
  const update: { schedule?: string; metadata?: Record<string, unknown> } = requested.schedule === undefined
    ? {}
    : { schedule: requested.schedule };
  const currentMemory = resolveStrategyReportMemory(existing.metadata);
  if (
    requested.metadata?.report_memory_generation === CURRENT_REPORT_MEMORY_GENERATION
    && !currentMemory.ready
  ) {
    update.metadata = {
      ...metadataRecord(existing.metadata),
      report_memory_generation: CURRENT_REPORT_MEMORY_GENERATION,
      report_memory_reset_at: now.toISOString(),
    };
  }
  return update;
}
