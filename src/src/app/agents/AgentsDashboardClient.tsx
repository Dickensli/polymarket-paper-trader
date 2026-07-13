'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  buildAgentPositionSummaries,
  normalizePositionRows,
  type AgentPositionSummary,
} from '@/lib/agent-positions';
import {
  matchesStrategyLifecycle,
  type StrategyLifecycleFilter,
} from '@/lib/agent-dashboard-filters';

type Platform = 'all' | 'polymarket' | 'kalshi' | 'polymarket_us';
type AgentMode = 'all' | 'paper' | 'real';

type StrategyOption = {
  id: string;
  agent_id: string;
  agent_email?: string | null;
  agent_name?: string | null;
  strategy_name: string;
  agent_mode: 'paper' | 'real';
  platform: 'polymarket' | 'kalshi' | 'polymarket_us';
  status: 'active' | 'paused' | 'disabled';
  starting_balance: number;
};

type Strategy = StrategyOption & {
  schedule: string | null;
  latest_snapshot: null | {
    id: string;
    source: string;
    cash: number;
    positions_value: number;
    total_value: number;
    pnl: number;
    captured_at: string;
  };
};

type Report = {
  id: string;
  agent_id?: string;
  agent_email?: string | null;
  agent_name?: string | null;
  strategy_name: string;
  filename: string;
  title: string | null;
  lessons_learned: string | null;
  next_steps: string | null;
  created_at: string;
};

type ReportDetail = {
  filename: string;
  account: string;
  title: string | null;
  content: string;
  lessons_learned: string | null;
  next_steps: string | null;
  portfolio_summary: Record<string, unknown> | null;
  trade_summary: Record<string, unknown> | null;
  created_at: string;
};

type Snapshot = {
  id: string;
  agent_id?: string;
  agent_email?: string | null;
  agent_name?: string | null;
  strategy_id?: string | null;
  strategy_name: string | null;
  platform: string | null;
  agent_mode: string | null;
  source: string;
  cash: number;
  positions_value: number;
  total_value: number;
  pnl: number;
  positions: unknown;
  orders: unknown;
  captured_at: string;
  is_stale?: boolean;
};

type RealOrder = {
  id: string;
  agent_id?: string;
  agent_email?: string | null;
  agent_name?: string | null;
  strategy_name: string | null;
  platform: string;
  official_order_id: string | null;
  client_order_id: string | null;
  market_slug_or_ticker: string | null;
  market_id?: string | null;
  side: 'BUY' | 'SELL';
  quantity: number;
  price: number;
  status: string;
  error: unknown;
  request?: unknown;
  official_response?: unknown;
  run_id?: string | null;
  created_at: string;
  updated_at?: string | null;
  requested_quantity?: number;
  filled_quantity?: number;
  remaining_quantity?: number;
  average_fill_price?: number;
  fees?: number;
  fill_count?: number;
  first_fill_at?: string | null;
  last_fill_at?: string | null;
  venue_updated_at?: string | null;
  fills?: Array<{ quantity: number; price: number; fee: number; filled_at: string }>;
  events?: Array<{ status: string; requested_quantity: number; filled_quantity: number; remaining_quantity: number; occurred_at: string }>;
};

type SettledPosition = {
  id: string;
  strategy_id: string;
  strategy_name: string;
  agent_id: string;
  agent_email?: string | null;
  agent_name?: string | null;
  platform: string;
  market_id: string;
  market: string;
  outcome: string;
  shares: number;
  avg_price: number;
  settlement_price: number;
  cost_basis: number;
  proceeds: number;
  realized_pnl: number;
  settled_at: string;
};


type DashboardData = {
  access?: {
    scope: 'user' | 'global';
  };
  summary: {
    strategies: number;
    reports: number;
    snapshots: number;
    real_orders: number;
    open_real_orders: number;
  };
  strategies: Strategy[];
  current_portfolios: Snapshot[];
  settled_positions: SettledPosition[];
  reports: Report[];
  snapshots: Snapshot[];
  real_orders: RealOrder[];
  sync_health: Array<{ platform: string; resource: string; last_success_at: string | null; last_venue_time: string | null; last_error: string | null; is_stale: boolean }>;
  filter_options: {
    strategies: StrategyOption[];
    platforms: Platform[];
    agent_modes: AgentMode[];
  };
};

const platformLabels: Record<string, string> = {
  all: 'All platforms',
  polymarket: 'Polymarket',
  kalshi: 'Kalshi',
  polymarket_us: 'Polymarket US',
};

const modeLabels: Record<string, string> = {
  all: 'All modes',
  paper: 'Paper',
  real: 'Real',
};

const lifecycleLabels: Record<StrategyLifecycleFilter, string> = {
  active: 'Active',
  archived: 'Archived',
  all: 'All',
};

function formatMoney(value: number) {
  return value.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 2,
  });
}

function formatDate(value: string) {
  return new Date(value).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function countArray(value: unknown) {
  return normalizePositionRows(value).length;
}

function agentLabel(item: { agent_name?: string | null; agent_email?: string | null; agent_id?: string | null }) {
  return item.agent_name || item.agent_email || item.agent_id || 'Unknown agent';
}

function statusClass(status: string) {
  const normalized = status.toLowerCase();
  if (normalized === 'active' || normalized === 'submitted' || normalized === 'open' || normalized === 'filled' || normalized === 'executed') {
    return 'bg-profit/10 text-profit-light border-profit/25';
  }
  if (normalized === 'paused' || normalized === 'warning' || normalized === 'pending' || normalized === 'cancelled' || normalized === 'canceled' || normalized.includes('partially_filled')) {
    return 'bg-primary/10 text-primary-light border-primary/25';
  }
  if (normalized === 'disabled' || normalized === 'critical' || normalized.includes('error') || normalized === 'rejected') {
    return 'bg-loss/10 text-loss-light border-loss/25';
  }
  return 'bg-white/[0.04] text-foreground-muted border-white/[0.08]';
}

function Badge({ children, tone }: { children: React.ReactNode; tone?: string }) {
  return (
    <span className={`inline-flex items-center rounded-md border px-2 py-0.5 text-[10px] font-bold uppercase ${tone ?? 'bg-white/[0.04] text-foreground-muted border-white/[0.08]'}`}>
      {children}
    </span>
  );
}

function Metric({ label, value, detail }: { label: string; value: string | number; detail?: string }) {
  return (
    <div className="glass-card p-4">
      <div className="text-[10px] font-semibold uppercase tracking-wider text-foreground-muted">{label}</div>
      <div className="mt-2 text-2xl font-bold tracking-tight text-foreground">{value}</div>
      {detail && <div className="mt-1 text-xs text-foreground-muted">{detail}</div>}
    </div>
  );
}

function SyncHealthPanel({ rows }: { rows: DashboardData['sync_health'] }) {
  return <section className="glass-card p-4 sm:p-5">
    <div className="flex items-center justify-between"><div><h2 className="text-lg font-semibold text-foreground">Official Sync Health</h2><p className="mt-1 text-xs text-foreground-muted">Orders, executions, settlements and historical checkpoints.</p></div><a href="/agents/history" className="rounded-md border border-primary/30 bg-primary/10 px-3 py-2 text-xs font-semibold text-primary-light">Open Trade History</a></div>
    <div className="mt-4 grid gap-2 md:grid-cols-2 xl:grid-cols-4">{rows.map((row) => <div key={`${row.platform}:${row.resource}`} className="rounded-md border border-white/[0.06] bg-white/[0.02] p-3"><div className="flex items-center justify-between"><span className="text-xs font-semibold uppercase text-foreground">{row.platform} · {row.resource}</span><Badge tone={row.last_error || row.is_stale ? 'bg-loss/10 text-loss-light border-loss/25' : 'bg-profit/10 text-profit-light border-profit/25'}>{row.last_error ? 'ERROR' : row.is_stale ? 'STALE' : 'HEALTHY'}</Badge></div><div className="mt-2 text-xs text-foreground-muted">Success: {row.last_success_at ? formatDate(row.last_success_at) : 'Never'}</div>{row.last_venue_time && <div className="mt-1 text-xs text-foreground-muted">Venue: {formatDate(row.last_venue_time)}</div>}{row.last_error && <div className="mt-2 text-xs text-loss-light">{row.last_error}</div>}</div>)}</div>
  </section>;
}

function EmptyRow({ label }: { label: string }) {
  return (
    <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] px-4 py-8 text-center text-sm text-foreground-muted">
      {label}
    </div>
  );
}

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg
      className={`h-4 w-4 shrink-0 text-foreground-muted transition-transform duration-200 ${open ? 'rotate-90' : ''}`}
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={2}
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
    </svg>
  );
}

function JsonBlock({ data }: { data: unknown }) {
  if (data == null || (typeof data === 'object' && Object.keys(data as object).length === 0)) {
    return <span className="text-foreground-muted italic">—</span>;
  }
  return (
    <pre className="max-h-[320px] overflow-auto rounded-md border border-white/[0.06] bg-white/[0.02] p-3 text-xs text-foreground-muted whitespace-pre-wrap break-words">
      {typeof data === 'string' ? data : JSON.stringify(data, null, 2)}
    </pre>
  );
}

function formatPrice(value: number | null) {
  if (value == null) return '--';
  return `${(value * 100).toFixed(1)}c`;
}

function formatCompactNumber(value: number | null) {
  if (value == null) return '--';
  return value.toLocaleString('en-US', {
    maximumFractionDigits: 2,
  });
}

function PositionValue({ value }: { value: number | null }) {
  if (value == null) return <span className="text-foreground-muted">--</span>;
  const tone = value > 0 ? 'text-profit-light' : value < 0 ? 'text-loss-light' : 'text-foreground-muted';
  return <span className={tone}>{formatMoney(value)}</span>;
}

function AgentPositionsPanel({
  summaries,
}: {
  summaries: AgentPositionSummary[];
}) {
  const visiblePositionCount = summaries.reduce((total, summary) => total + summary.positions.length, 0);
  const visiblePositionsValue = summaries.reduce((total, summary) => total + summary.positionsValue, 0);
  const visiblePortfolioValue = summaries.reduce((total, summary) => total + summary.totalValue, 0);
  const visiblePnl = summaries.reduce((total, summary) => total + summary.pnl, 0);

  return (
    <section>
      <div className="mb-3">
        <div>
          <h2 className="text-lg font-semibold text-foreground">Current Agent Positions</h2>
          <p className="mt-1 text-xs text-foreground-muted">
            Latest snapshot per strategy, grouped by agent.
          </p>
        </div>
      </div>

      <div className="glass-card overflow-hidden">
        <div className="grid gap-px bg-white/[0.04] sm:grid-cols-2 xl:grid-cols-4">
          <div className="bg-background-secondary/80 p-4">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-foreground-muted">Open Positions</div>
            <div className="mt-2 text-2xl font-bold tabular-nums text-foreground">{visiblePositionCount}</div>
          </div>
          <div className="bg-background-secondary/80 p-4">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-foreground-muted">Positions Value</div>
            <div className="mt-2 text-2xl font-bold tabular-nums text-foreground">{formatMoney(visiblePositionsValue)}</div>
          </div>
          <div className="bg-background-secondary/80 p-4">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-foreground-muted">Current Portfolio</div>
            <div className="mt-2 text-2xl font-bold tabular-nums text-foreground">{formatMoney(visiblePortfolioValue)}</div>
          </div>
          <div className="bg-background-secondary/80 p-4">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-foreground-muted">Snapshot PnL</div>
            <div className={`mt-2 text-2xl font-bold tabular-nums ${visiblePnl >= 0 ? 'text-profit-light' : 'text-loss-light'}`}>
              {formatMoney(visiblePnl)}
            </div>
          </div>
        </div>

        {summaries.length === 0 ? (
          <div className="border-t border-white/[0.06] px-4 py-8 text-center text-sm text-foreground-muted">
            No current positions found in the active strategies.
          </div>
        ) : (
          <div className="divide-y divide-white/[0.06]">
              {summaries.map((summary) => (
                <div key={summary.key} className="p-4">
                  <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-semibold text-foreground">{summary.agentLabel}</span>
                        <Badge>{summary.strategyName}</Badge>
                        {summary.platform && <Badge>{platformLabels[summary.platform] ?? summary.platform}</Badge>}
                        {summary.agentMode && <Badge>{modeLabels[summary.agentMode] ?? summary.agentMode}</Badge>}
                        {summary.isStale && <Badge tone="bg-loss/10 text-loss-light border-loss/25">STALE</Badge>}
                      </div>
                      <div className="mt-1 text-xs text-foreground-muted">
                        {summary.positions.length} positions · captured {formatDate(summary.capturedAt)}
                      </div>
                    </div>
                    <div className="grid grid-cols-3 gap-3 text-right lg:min-w-[360px]">
                      <div>
                        <div className="text-[10px] font-semibold uppercase tracking-wider text-foreground-muted">Cash</div>
                        <div className="mt-1 text-sm font-semibold tabular-nums text-foreground">{formatMoney(summary.cash)}</div>
                      </div>
                      <div>
                        <div className="text-[10px] font-semibold uppercase tracking-wider text-foreground-muted">Total</div>
                        <div className="mt-1 text-sm font-semibold tabular-nums text-foreground">{formatMoney(summary.totalValue)}</div>
                      </div>
                      <div>
                        <div className="text-[10px] font-semibold uppercase tracking-wider text-foreground-muted">PnL</div>
                        <div className={`mt-1 text-sm font-semibold tabular-nums ${summary.pnl >= 0 ? 'text-profit-light' : 'text-loss-light'}`}>
                          {formatMoney(summary.pnl)}
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[780px] text-sm">
                      <thead>
                        <tr className="border-y border-white/[0.04] bg-white/[0.02]">
                          <th className="px-3 py-2.5 text-left text-xs font-medium uppercase tracking-wider text-foreground-muted">Market</th>
                          <th className="px-3 py-2.5 text-left text-xs font-medium uppercase tracking-wider text-foreground-muted">Outcome</th>
                          <th className="px-3 py-2.5 text-right text-xs font-medium uppercase tracking-wider text-foreground-muted">Shares</th>
                          <th className="px-3 py-2.5 text-right text-xs font-medium uppercase tracking-wider text-foreground-muted">Avg</th>
                          <th className="px-3 py-2.5 text-right text-xs font-medium uppercase tracking-wider text-foreground-muted">Mark</th>
                          <th className="px-3 py-2.5 text-right text-xs font-medium uppercase tracking-wider text-foreground-muted">Value</th>
                          <th className="px-3 py-2.5 text-right text-xs font-medium uppercase tracking-wider text-foreground-muted">PnL</th>
                        </tr>
                      </thead>
                      <tbody>
                        {summary.positions.slice(0, 8).map((position) => (
                          <tr key={position.id} className="border-b border-white/[0.03] last:border-0">
                            <td className="max-w-[320px] px-3 py-3 text-foreground">
                              <div className="truncate">{position.market}</div>
                            </td>
                            <td className="px-3 py-3">
                              <Badge>{position.outcome}</Badge>
                            </td>
                            <td className="px-3 py-3 text-right tabular-nums text-foreground-muted">{formatCompactNumber(position.shares)}</td>
                            <td className="px-3 py-3 text-right tabular-nums text-foreground-muted">{formatPrice(position.avgPrice)}</td>
                            <td className="px-3 py-3 text-right tabular-nums text-foreground-muted">{formatPrice(position.currentPrice)}</td>
                            <td className="px-3 py-3 text-right tabular-nums text-foreground">{position.value == null ? '--' : formatMoney(position.value)}</td>
                            <td className="px-3 py-3 text-right tabular-nums font-semibold"><PositionValue value={position.pnl} /></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {summary.positions.length > 8 && (
                    <div className="mt-3 text-xs text-foreground-muted">
                      Showing 8 of {summary.positions.length} positions for this strategy.
                    </div>
                  )}
                </div>
              ))}
          </div>
        )}
      </div>
    </section>
  );
}

function SettledPositionsPanel({ positions }: { positions: SettledPosition[] }) {
  const [open, setOpen] = useState(false);
  const totalProceeds = positions.reduce((total, position) => total + position.proceeds, 0);
  const totalRealizedPnl = positions.reduce((total, position) => total + position.realized_pnl, 0);

  return (
    <section className="glass-card overflow-hidden">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
        className="flex w-full items-center justify-between gap-4 px-4 py-4 text-left transition-colors hover:bg-white/[0.02] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/50 sm:px-5"
      >
        <div className="flex min-w-0 items-center gap-3">
          <ChevronIcon open={open} />
          <div className="min-w-0">
            <h2 className="text-lg font-semibold text-foreground">Settled Position History</h2>
            <p className="mt-1 text-xs text-foreground-muted">Realized results for positions closed at market settlement.</p>
          </div>
        </div>
        <div className="shrink-0 text-right">
          <div className="text-sm font-semibold tabular-nums text-foreground">{positions.length}</div>
          <div className="text-[10px] font-semibold uppercase tracking-wider text-foreground-muted">Settled</div>
        </div>
      </button>

      {open && (
        <div className="border-t border-white/[0.06]">
          <div className="grid gap-px bg-white/[0.04] sm:grid-cols-3">
            <div className="bg-background-secondary/80 p-4">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-foreground-muted">Closed Positions</div>
              <div className="mt-2 text-xl font-bold tabular-nums text-foreground">{positions.length}</div>
            </div>
            <div className="bg-background-secondary/80 p-4">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-foreground-muted">Settlement Proceeds</div>
              <div className="mt-2 text-xl font-bold tabular-nums text-foreground">{formatMoney(totalProceeds)}</div>
            </div>
            <div className="bg-background-secondary/80 p-4">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-foreground-muted">Realized PnL</div>
              <div className={`mt-2 text-xl font-bold tabular-nums ${totalRealizedPnl >= 0 ? 'text-profit-light' : 'text-loss-light'}`}>
                {formatMoney(totalRealizedPnl)}
              </div>
            </div>
          </div>

          {positions.length === 0 ? (
            <div className="px-4 py-8 text-center text-sm text-foreground-muted">No settled positions match these filters.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1040px] text-sm">
                <thead>
                  <tr className="border-b border-white/[0.06]">
                    <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-foreground-muted">Strategy / Market</th>
                    <th className="px-3 py-3 text-left text-xs font-medium uppercase tracking-wider text-foreground-muted">Outcome</th>
                    <th className="px-3 py-3 text-right text-xs font-medium uppercase tracking-wider text-foreground-muted">Shares</th>
                    <th className="px-3 py-3 text-right text-xs font-medium uppercase tracking-wider text-foreground-muted">Avg</th>
                    <th className="px-3 py-3 text-right text-xs font-medium uppercase tracking-wider text-foreground-muted">Settled</th>
                    <th className="px-3 py-3 text-right text-xs font-medium uppercase tracking-wider text-foreground-muted">Cost</th>
                    <th className="px-3 py-3 text-right text-xs font-medium uppercase tracking-wider text-foreground-muted">Proceeds</th>
                    <th className="px-3 py-3 text-right text-xs font-medium uppercase tracking-wider text-foreground-muted">Realized PnL</th>
                    <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-foreground-muted">Closed</th>
                  </tr>
                </thead>
                <tbody>
                  {positions.slice(0, 50).map((position) => (
                    <tr key={position.id} className="border-b border-white/[0.03] transition-colors hover:bg-white/[0.02]">
                      <td className="max-w-[320px] px-4 py-3">
                        <div className="truncate font-medium text-foreground">{position.market}</div>
                        <div className="mt-1 truncate text-xs text-foreground-muted">
                          {agentLabel(position)} · {position.strategy_name} · {platformLabels[position.platform] ?? position.platform}
                        </div>
                      </td>
                      <td className="px-3 py-3"><Badge>{position.outcome}</Badge></td>
                      <td className="px-3 py-3 text-right tabular-nums text-foreground-muted">{formatCompactNumber(position.shares)}</td>
                      <td className="px-3 py-3 text-right tabular-nums text-foreground-muted">{formatPrice(position.avg_price)}</td>
                      <td className="px-3 py-3 text-right tabular-nums text-foreground-muted">{formatPrice(position.settlement_price)}</td>
                      <td className="px-3 py-3 text-right tabular-nums text-foreground-muted">{formatMoney(position.cost_basis)}</td>
                      <td className="px-3 py-3 text-right tabular-nums text-foreground">{formatMoney(position.proceeds)}</td>
                      <td className="px-3 py-3 text-right tabular-nums font-semibold"><PositionValue value={position.realized_pnl} /></td>
                      <td className="px-4 py-3 text-xs text-foreground-muted">{formatDate(position.settled_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {positions.length > 50 && (
            <div className="border-t border-white/[0.06] px-4 py-3 text-xs text-foreground-muted">Showing 50 of {positions.length} settled positions.</div>
          )}
        </div>
      )}
    </section>
  );
}

/* ---------- Report expandable entry ---------- */
function ReportEntry({ report }: { report: Report }) {
  const [open, setOpen] = useState(false);
  const [detail, setDetail] = useState<ReportDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);

  const toggle = useCallback(async () => {
    if (open) {
      setOpen(false);
      return;
    }
    setOpen(true);
    if (detail) return; // already fetched
    setLoading(true);
    setFetchError(null);
    try {
      const res = await fetch(`/api/agent/reports/${report.id}`, { cache: 'no-store' });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Failed to load report');
      setDetail(json.data);
    } catch (err) {
      setFetchError(err instanceof Error ? err.message : 'Failed to load report');
    } finally {
      setLoading(false);
    }
  }, [open, detail, report.id]);

  return (
    <div className="glass-card overflow-hidden">
      <button
        type="button"
        onClick={toggle}
        className="flex w-full items-start gap-3 p-4 text-left transition-colors hover:bg-white/[0.02]"
      >
        <ChevronIcon open={open} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold text-foreground">{report.title ?? report.filename}</div>
              <div className="mt-1 text-xs text-foreground-muted">{agentLabel(report)} · {report.strategy_name} · {formatDate(report.created_at)}</div>
            </div>
            <Badge>{report.filename}</Badge>
          </div>
          {!open && (report.lessons_learned || report.next_steps) && (
            <div className="mt-3 grid gap-2 text-xs text-foreground-muted sm:grid-cols-2">
              <div className="line-clamp-2">{report.lessons_learned ?? 'No lessons captured'}</div>
              <div className="line-clamp-2">{report.next_steps ?? 'No next steps captured'}</div>
            </div>
          )}
        </div>
      </button>

      {open && (
        <div className="border-t border-white/[0.06] px-4 py-4">
          {loading && (
            <div className="flex items-center gap-2 text-sm text-foreground-muted">
              <div className="h-4 w-4 animate-spin rounded-full border-2 border-foreground-muted border-t-transparent" />
              Loading report…
            </div>
          )}
          {fetchError && (
            <div className="rounded-md border border-loss/25 bg-loss/10 px-3 py-2 text-sm text-loss-light">
              {fetchError}
            </div>
          )}
          {detail && (
            <div className="space-y-4">
              <div>
                <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-foreground-muted">Report Content</div>
                <div className="max-h-[480px] overflow-auto rounded-md border border-white/[0.06] bg-white/[0.02] p-4 text-sm text-foreground whitespace-pre-wrap break-words leading-relaxed">
                  {detail.content}
                </div>
              </div>
              {detail.lessons_learned && (
                <div>
                  <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-foreground-muted">Lessons Learned</div>
                  <div className="text-sm text-foreground-muted whitespace-pre-wrap">{detail.lessons_learned}</div>
                </div>
              )}
              {detail.next_steps && (
                <div>
                  <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-foreground-muted">Next Steps</div>
                  <div className="text-sm text-foreground-muted whitespace-pre-wrap">{detail.next_steps}</div>
                </div>
              )}
              {detail.portfolio_summary && Object.keys(detail.portfolio_summary).length > 0 && (
                <div>
                  <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-foreground-muted">Portfolio Summary</div>
                  <JsonBlock data={detail.portfolio_summary} />
                </div>
              )}
              {detail.trade_summary && Object.keys(detail.trade_summary).length > 0 && (
                <div>
                  <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-foreground-muted">Trade Summary</div>
                  <JsonBlock data={detail.trade_summary} />
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function formatOrderPrice(order: RealOrder) {
  if (!order.price) return '--';
  return `${(order.price * 100).toFixed(1)}c`;
}

/* ---------- Real order expandable entry ---------- */
function OrderEntry({ order }: { order: RealOrder }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="glass-card overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-3 p-4 text-left transition-colors hover:bg-white/[0.02]"
      >
        <ChevronIcon open={open} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="truncate text-sm font-semibold text-foreground">{agentLabel(order)} · {order.strategy_name ?? 'Unknown'}</span>
            <Badge tone={order.side === 'BUY' ? 'bg-profit/10 text-profit-light border-profit/25' : 'bg-loss/10 text-loss-light border-loss/25'}>{order.side}</Badge>
            <Badge tone={statusClass(order.status)}>{order.status}</Badge>
          </div>
          <div className="mt-1 flex flex-wrap gap-x-3 text-xs text-foreground-muted">
            <span className="truncate max-w-[260px]">{order.market_slug_or_ticker ?? order.official_order_id ?? order.client_order_id ?? order.id}</span>
            <span>Qty: {order.quantity || '--'}</span>
            <span>Price: {formatOrderPrice(order)}</span>
            {order.filled_quantity != null && <span>Filled: {order.filled_quantity}/{order.requested_quantity ?? order.quantity}</span>}
            {order.remaining_quantity != null && <span>Remaining: {order.remaining_quantity}</span>}
            <span>{formatDate(order.created_at)}</span>
          </div>
        </div>
      </button>

      {open && (
        <div className="border-t border-white/[0.06] px-4 py-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-3">
              <div>
                <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-foreground-muted">Platform</div>
                <div className="text-sm text-foreground">{platformLabels[order.platform] ?? order.platform}</div>
              </div>
              <div>
                <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-foreground-muted">Market</div>
                <div className="text-sm text-foreground break-all">{order.market_slug_or_ticker ?? '—'}</div>
              </div>
              {order.market_id && (
                <div>
                  <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-foreground-muted">Market ID</div>
                  <div className="text-sm text-foreground-muted break-all font-mono text-xs">{order.market_id}</div>
                </div>
              )}
              <div>
                <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-foreground-muted">Official Order ID</div>
                <div className="text-sm text-foreground-muted break-all font-mono text-xs">{order.official_order_id ?? '—'}</div>
              </div>
              {order.client_order_id && (
                <div>
                  <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-foreground-muted">Client Order ID</div>
                  <div className="text-sm text-foreground-muted break-all font-mono text-xs">{order.client_order_id}</div>
                </div>
              )}
              {order.run_id && (
                <div>
                  <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-foreground-muted">Run ID</div>
                  <div className="text-sm text-foreground-muted break-all font-mono text-xs">{order.run_id}</div>
                </div>
              )}
              {order.updated_at && (
                <div>
                  <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-foreground-muted">Updated At</div>
                  <div className="text-sm text-foreground-muted">{formatDate(order.updated_at)}</div>
                </div>
              )}
              {order.average_fill_price != null && order.filled_quantity != null && order.filled_quantity > 0 && (
                <div>
                  <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-foreground-muted">Execution Summary</div>
                  <div className="text-sm text-foreground">
                    {order.fill_count ?? 0} fill{order.fill_count === 1 ? '' : 's'} · VWAP {(order.average_fill_price * 100).toFixed(2)}c · Fees {formatMoney(order.fees ?? 0)}
                  </div>
                  <div className="mt-1 text-xs text-foreground-muted">
                    {order.first_fill_at ? `First ${formatDate(order.first_fill_at)}` : ''}
                    {order.last_fill_at ? ` · Last ${formatDate(order.last_fill_at)}` : ''}
                  </div>
                </div>
              )}
            </div>
            <div className="space-y-3">
              {order.events && order.events.length > 0 && (
                <div>
                  <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-foreground-muted">Lifecycle</div>
                  <div className="space-y-1 rounded-md border border-white/[0.06] bg-white/[0.02] p-2 text-xs">
                    {order.events.map((event, index) => (
                      <div key={`${event.occurred_at}-${index}`} className="flex justify-between gap-3">
                        <span><Badge tone={statusClass(event.status)}>{event.status}</Badge> · {event.filled_quantity}/{event.requested_quantity} filled</span>
                        <span className="text-foreground-muted">{formatDate(event.occurred_at)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {order.fills && order.fills.length > 0 && (
                <div>
                  <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-foreground-muted">Executions</div>
                  <div className="space-y-1 rounded-md border border-white/[0.06] bg-white/[0.02] p-2 text-xs">
                    {order.fills.map((fill, index) => (
                      <div key={`${fill.filled_at}-${index}`} className="flex justify-between gap-3">
                        <span>{fill.quantity} @ {(fill.price * 100).toFixed(2)}c · fee {formatMoney(fill.fee)}</span>
                        <span className="text-foreground-muted">{formatDate(fill.filled_at)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {order.request != null && (
                <div>
                  <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-foreground-muted">Request</div>
                  <JsonBlock data={order.request} />
                </div>
              )}
              {order.official_response != null && (
                <div>
                  <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-foreground-muted">Response</div>
                  <JsonBlock data={order.official_response} />
                </div>
              )}
              {order.error != null && (
                <div>
                  <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-foreground-muted">Error</div>
                  <JsonBlock data={order.error} />
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}


export default function AgentsDashboardClient() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [platform, setPlatform] = useState<Platform>('all');
  const [agentMode, setAgentMode] = useState<AgentMode>('all');
  const [strategyStatus, setStrategyStatus] = useState<StrategyLifecycleFilter>('all');
  const [strategyId, setStrategyId] = useState('all');

  const query = useMemo(() => {
    const params = new URLSearchParams();
    params.set('platform', platform);
    params.set('agent_mode', agentMode);
    params.set('strategy_status', strategyStatus);
    params.set('strategy_id', strategyId);
    return params.toString();
  }, [platform, agentMode, strategyStatus, strategyId]);

  useEffect(() => {
    let cancelled = false;
    async function loadDashboard() {
      setIsLoading(true);
      setError(null);
      try {
        const response = await fetch(`/api/agent/dashboard?${query}`, { cache: 'no-store' });
        const json = await response.json();
        if (!response.ok) throw new Error(json.error ?? 'Failed to load agents dashboard');
        if (!cancelled) setData(json);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load agents dashboard');
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }
    loadDashboard();
    return () => {
      cancelled = true;
    };
  }, [query]);

  const strategyOptions = useMemo(() => {
    const allStrategies = data?.filter_options.strategies ?? [];
    return allStrategies.filter(strategy => {
      const matchPlatform = platform === 'all' || strategy.platform === platform;
      const matchMode = agentMode === 'all' || strategy.agent_mode === agentMode;
      const matchLifecycle = matchesStrategyLifecycle(strategy.status, strategyStatus);
      return matchPlatform && matchMode && matchLifecycle;
    });
  }, [data?.filter_options.strategies, platform, agentMode, strategyStatus]);

  const activeStrategyIds = useMemo(() => new Set(
    (data?.filter_options.strategies ?? [])
      .filter((strategy) => strategy.status === 'active')
      .map((strategy) => strategy.id),
  ), [data?.filter_options.strategies]);
  const positionSummaries = useMemo(() => buildAgentPositionSummaries(
    strategyStatus === 'archived'
      ? []
      : (data?.current_portfolios ?? []).filter((snapshot) => snapshot.strategy_id && activeStrategyIds.has(snapshot.strategy_id)),
  ), [activeStrategyIds, data?.current_portfolios, strategyStatus]);

  return (
    <div className="flex-1 p-4 sm:p-6 lg:p-8 max-w-[1400px] mx-auto w-full">
      <div className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground sm:text-3xl tracking-tight">Agent Operations</h1>
          <p className="mt-2 text-sm text-foreground-muted">
            Reports, snapshots, and audits.
            {data?.access?.scope === 'global' ? ' Global agent view enabled.' : ''}
          </p>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:min-w-[760px] lg:grid-cols-4">
          <label className="block">
            <span className="mb-1.5 block text-[10px] font-semibold uppercase tracking-wider text-foreground-muted">Platform</span>
            <select
              value={platform}
              onChange={(event) => {
                setPlatform(event.target.value as Platform);
                setStrategyId('all');
              }}
              className="w-full rounded-lg border border-white/[0.08] bg-white/[0.04] px-3 py-2 text-sm text-foreground outline-none transition-colors hover:bg-white/[0.06] focus:border-primary/50"
            >
              {(['all', 'polymarket', 'kalshi', 'polymarket_us'] as Platform[]).map((option) => (
                <option key={option} value={option}>{platformLabels[option]}</option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="mb-1.5 block text-[10px] font-semibold uppercase tracking-wider text-foreground-muted">Mode</span>
            <select
              value={agentMode}
              onChange={(event) => {
                setAgentMode(event.target.value as AgentMode);
                setStrategyId('all');
              }}
              className="w-full rounded-lg border border-white/[0.08] bg-white/[0.04] px-3 py-2 text-sm text-foreground outline-none transition-colors hover:bg-white/[0.06] focus:border-primary/50"
            >
              {(['all', 'paper', 'real'] as AgentMode[]).map((option) => (
                <option key={option} value={option}>{modeLabels[option]}</option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="mb-1.5 block text-[10px] font-semibold uppercase tracking-wider text-foreground-muted">Status</span>
            <select
              value={strategyStatus}
              onChange={(event) => {
                setStrategyStatus(event.target.value as StrategyLifecycleFilter);
                setStrategyId('all');
              }}
              className="w-full rounded-lg border border-white/[0.08] bg-white/[0.04] px-3 py-2 text-sm text-foreground outline-none transition-colors hover:bg-white/[0.06] focus:border-primary/50"
            >
              {(['active', 'archived', 'all'] as StrategyLifecycleFilter[]).map((option) => (
                <option key={option} value={option}>{lifecycleLabels[option]}</option>
              ))}
            </select>
          </label>
          <label className="block">
              <span className="mb-1.5 block text-[10px] font-semibold uppercase tracking-wider text-foreground-muted">Strategy</span>
              <select
                value={strategyOptions.some((strategy) => strategy.id === strategyId) ? strategyId : 'all'}
                onChange={(event) => setStrategyId(event.target.value)}
                className="w-full rounded-lg border border-white/[0.08] bg-white/[0.04] px-3 py-2 text-sm text-foreground outline-none transition-colors hover:bg-white/[0.06] focus:border-primary/50"
              >
                <option value="all">All strategies</option>
                {strategyOptions.map((strategy) => (
                  <option key={strategy.id} value={strategy.id}>{strategy.strategy_name}</option>
                ))}
              </select>
          </label>
        </div>
      </div>

      {error && (
        <div className="mb-6 rounded-lg border border-loss/25 bg-loss/10 px-4 py-3 text-sm text-loss-light">
          {error}
        </div>
      )}

      {isLoading && (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
          {Array.from({ length: 5 }).map((_, index) => (
            <div key={index} className="skeleton h-24" />
          ))}
        </div>
      )}

      {!isLoading && data && (
        <div className="space-y-7">
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
            <Metric label="Reports" value={data.summary.reports} />
            <Metric label="Snapshots" value={data.summary.snapshots} />
            <Metric label="Real Orders" value={data.summary.real_orders} detail={`${data.summary.open_real_orders} open`} />
            <Metric label="Mode" value={modeLabels[agentMode]} detail={platformLabels[platform]} />
          </div>

          <AgentPositionsPanel
            summaries={positionSummaries}
          />

          <SyncHealthPanel rows={data.sync_health ?? []} />

          <SettledPositionsPanel positions={data.settled_positions ?? []} />

          <div className="grid gap-7 xl:grid-cols-1">
            <section>
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-lg font-semibold text-foreground">Reports</h2>
                <span className="text-xs text-foreground-muted">{data.reports.length} recent</span>
              </div>
              {data.reports.length === 0 ? (
                <EmptyRow label="No reports match these filters." />
              ) : (
                <div className="space-y-3">
                  {data.reports.slice(0, 8).map((report) => (
                    <ReportEntry key={report.id} report={report} />
                  ))}
                </div>
              )}
            </section>

          </div>

          <div className="grid gap-7 xl:grid-cols-2">
            <section>
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-lg font-semibold text-foreground">Portfolio Snapshots</h2>
                <span className="text-xs text-foreground-muted">{data.snapshots.length} captured</span>
              </div>
              {data.snapshots.length === 0 ? (
                <EmptyRow label="No snapshots match these filters." />
              ) : (
                <div className="glass-card overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[760px] text-sm">
                      <thead>
                        <tr className="border-b border-white/[0.06]">
                          <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-foreground-muted">Strategy</th>
                          <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-foreground-muted">Source</th>
                          <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-foreground-muted">Cash</th>
                          <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-foreground-muted">Total</th>
                          <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-foreground-muted">Positions</th>
                          <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-foreground-muted">Captured</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.snapshots.slice(0, 12).map((snapshot) => (
                          <tr key={snapshot.id} className="border-b border-white/[0.03] transition-colors hover:bg-white/[0.02]">
                            <td className="px-4 py-3 max-w-[180px] truncate text-foreground">{agentLabel(snapshot)} · {snapshot.strategy_name ?? 'Unknown'}</td>
                            <td className="px-4 py-3"><Badge>{snapshot.source}</Badge></td>
                            <td className="px-4 py-3 text-right tabular-nums text-foreground">{formatMoney(snapshot.cash)}</td>
                            <td className="px-4 py-3 text-right tabular-nums font-semibold text-foreground">{formatMoney(snapshot.total_value)}</td>
                            <td className="px-4 py-3 text-right tabular-nums text-foreground-muted">{countArray(snapshot.positions)}</td>
                            <td className="px-4 py-3 text-xs text-foreground-muted">{formatDate(snapshot.captured_at)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </section>

            <section>
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-lg font-semibold text-foreground">Real Trade Audit Log</h2>
                <span className="text-xs text-foreground-muted">{data.real_orders.length} orders</span>
              </div>
              {data.real_orders.length === 0 ? (
                <EmptyRow label="No real orders match these filters." />
              ) : (
                <div className="space-y-3">
                  {data.real_orders.slice(0, 12).map((order) => (
                    <OrderEntry key={order.id} order={order} />
                  ))}
                </div>
              )}
            </section>
          </div>
        </div>
      )}
    </div>
  );
}
