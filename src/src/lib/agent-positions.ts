export type AgentPositionRow = {
  id: string;
  market: string;
  outcome: string;
  shares: number | null;
  avgPrice: number | null;
  currentPrice: number | null;
  value: number | null;
  pnl: number | null;
};

export type AgentPositionSummary = {
  key: string;
  agentId: string;
  agentLabel: string;
  strategyName: string;
  platform: string | null;
  agentMode: string | null;
  capturedAt: string;
  isStale: boolean;
  cash: number;
  totalValue: number;
  positionsValue: number;
  pnl: number;
  positions: AgentPositionRow[];
};

export type AgentPositionSnapshot = {
  id: string;
  agent_id?: string | null;
  agent_email?: string | null;
  agent_name?: string | null;
  strategy_id?: string | null;
  strategy_name: string | null;
  platform: string | null;
  agent_mode: string | null;
  cash: number;
  total_value: number;
  positions_value: number;
  pnl: number;
  positions: unknown;
  captured_at: string;
  is_stale?: boolean;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === 'object' && !Array.isArray(value);
}

function firstString(record: Record<string, unknown>, keys: string[], fallback = '') {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  }
  return fallback;
}

function firstNumber(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = record[key];
    const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN;
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function rowsFromPositions(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (!isRecord(value)) return [];
  if (Array.isArray(value.positions)) return value.positions;
  if (Array.isArray(value.data)) return value.data;
  return Object.entries(value).map(([key, row]) => (isRecord(row) ? { market: key, ...row } : row));
}

export function normalizePositionRows(value: unknown): AgentPositionRow[] {
  return rowsFromPositions(value)
    .map((row, index) => {
      if (!isRecord(row)) return null;

      const market = firstString(row, [
        'marketQuestion',
        'market_question',
        'question',
        'title',
        'market',
        'marketId',
        'market_id',
        'ticker',
        'slug',
        'market_slug_or_ticker',
        'tokenId',
        'token_id',
      ], 'Unknown market');
      const outcome = firstString(row, ['outcome', 'side', 'contract', 'position', 'answer'], 'Position');
      const shares = firstNumber(row, ['shares', 'position_fp', 'quantity', 'qty', 'count', 'contracts', 'size']);
      const avgPrice = firstNumber(row, ['avgPrice', 'avgEntryPrice', 'avg_entry_price', 'averagePrice', 'average_price', 'entryPrice', 'entry_price', 'price']);
      const currentPrice = firstNumber(row, ['currentPrice', 'current_price', 'markPrice', 'mark_price', 'lastPrice', 'last_price']);
      const explicitValue = firstNumber(row, ['market_exposure_dollars', 'market_value_dollars', 'value', 'marketValue', 'market_value', 'currentValue', 'current_value', 'notional']);
      const value = explicitValue ?? (shares != null && currentPrice != null ? shares * currentPrice : null);
      const explicitPnl = firstNumber(row, ['realized_pnl_dollars', 'pnl', 'unrealizedPnL', 'unrealizedPnl', 'unrealized_pnl', 'profitLoss', 'profit_loss']);
      const cost = shares != null && avgPrice != null ? shares * avgPrice : null;
      const pnl = explicitPnl ?? (value != null && cost != null ? value - cost : null);

      if ((shares == null || shares === 0) && value == null && explicitPnl == null) return null;

      return {
        id: firstString(row, ['id', 'positionId', 'position_id', 'tokenId', 'token_id'], `${market}-${outcome}-${index}`),
        market,
        outcome,
        shares,
        avgPrice,
        currentPrice,
        value,
        pnl,
      };
    })
    .filter((row): row is AgentPositionRow => row != null);
}

export function buildAgentPositionSummaries(snapshots: AgentPositionSnapshot[]): AgentPositionSummary[] {
  const seenStrategies = new Set<string>();

  return snapshots.reduce<AgentPositionSummary[]>((summaries, snapshot) => {
    const strategyKey = snapshot.strategy_id ?? `${snapshot.agent_id ?? 'unknown'}:${snapshot.strategy_name ?? snapshot.id}`;
    if (seenStrategies.has(strategyKey)) return summaries;
    seenStrategies.add(strategyKey);

    const positions = normalizePositionRows(snapshot.positions);
    if (positions.length === 0) return summaries;

    const agentId = snapshot.agent_id ?? 'unknown-agent';
    const agentLabel = snapshot.agent_name || snapshot.agent_email || snapshot.agent_id || 'Unknown agent';
    summaries.push({
      key: strategyKey,
      agentId,
      agentLabel,
      strategyName: snapshot.strategy_name ?? 'Unknown strategy',
      platform: snapshot.platform,
      agentMode: snapshot.agent_mode,
      capturedAt: snapshot.captured_at,
      isStale: snapshot.is_stale ?? false,
      cash: snapshot.cash,
      totalValue: snapshot.total_value,
      positionsValue: snapshot.positions_value,
      pnl: snapshot.pnl,
      positions,
    });
    return summaries;
  }, []);
}
