'use client';

import { useEffect, useMemo, useState } from 'react';

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

type Snapshot = {
  id: string;
  agent_id?: string;
  agent_email?: string | null;
  agent_name?: string | null;
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
  side: 'BUY' | 'SELL';
  quantity: number;
  price: number;
  status: string;
  error: unknown;
  created_at: string;
};

type ReconciliationLog = {
  id: string;
  agent_id?: string;
  agent_email?: string | null;
  agent_name?: string | null;
  strategy_name: string | null;
  platform: string;
  severity: string;
  difference_type: string;
  message: string;
  diff: unknown;
  created_at: string;
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
    reconciliation_warnings: number;
  };
  strategies: Strategy[];
  reports: Report[];
  snapshots: Snapshot[];
  real_orders: RealOrder[];
  reconciliation_logs: ReconciliationLog[];
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
  return Array.isArray(value) ? value.length : 0;
}

function agentLabel(item: { agent_name?: string | null; agent_email?: string | null; agent_id?: string | null }) {
  return item.agent_name || item.agent_email || item.agent_id || 'Unknown agent';
}

function agentInitial(item: { agent_name?: string | null; agent_email?: string | null; agent_id?: string | null }) {
  return agentLabel(item).charAt(0).toUpperCase();
}

function statusClass(status: string) {
  const normalized = status.toLowerCase();
  if (normalized === 'active' || normalized === 'submitted' || normalized === 'open') {
    return 'bg-profit/10 text-profit-light border-profit/25';
  }
  if (normalized === 'paused' || normalized === 'warning') {
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

function EmptyRow({ label }: { label: string }) {
  return (
    <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] px-4 py-8 text-center text-sm text-foreground-muted">
      {label}
    </div>
  );
}

export default function AgentsDashboardClient() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [platform, setPlatform] = useState<Platform>('all');
  const [agentMode, setAgentMode] = useState<AgentMode>('all');
  const [strategyId, setStrategyId] = useState('all');

  const query = useMemo(() => {
    const params = new URLSearchParams();
    params.set('platform', platform);
    params.set('agent_mode', agentMode);
    params.set('strategy_id', strategyId);
    return params.toString();
  }, [platform, agentMode, strategyId]);

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

  const strategyOptions = data?.filter_options.strategies ?? [];

  return (
    <div className="flex-1 p-4 sm:p-6 lg:p-8 max-w-[1400px] mx-auto w-full">
      <div className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground sm:text-3xl tracking-tight">Agent Operations</h1>
          <p className="mt-2 text-sm text-foreground-muted">
            Strategy registry, memory, snapshots, audits, and reconciliation state.
            {data?.access?.scope === 'global' ? ' Global agent view enabled.' : ''}
          </p>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 lg:min-w-[680px]">
          <label className="block">
            <span className="mb-1.5 block text-[10px] font-semibold uppercase tracking-wider text-foreground-muted">Platform</span>
            <select
              value={platform}
              onChange={(event) => setPlatform(event.target.value as Platform)}
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
              onChange={(event) => setAgentMode(event.target.value as AgentMode)}
              className="w-full rounded-lg border border-white/[0.08] bg-white/[0.04] px-3 py-2 text-sm text-foreground outline-none transition-colors hover:bg-white/[0.06] focus:border-primary/50"
            >
              {(['all', 'paper', 'real'] as AgentMode[]).map((option) => (
                <option key={option} value={option}>{modeLabels[option]}</option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="mb-1.5 block text-[10px] font-semibold uppercase tracking-wider text-foreground-muted">Strategy</span>
            <select
              value={strategyId}
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
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-6">
          {Array.from({ length: 6 }).map((_, index) => (
            <div key={index} className="skeleton h-24" />
          ))}
        </div>
      )}

      {!isLoading && data && (
        <div className="space-y-7">
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-6">
            <Metric label="Strategies" value={data.summary.strategies} />
            <Metric label="Reports" value={data.summary.reports} />
            <Metric label="Snapshots" value={data.summary.snapshots} />
            <Metric label="Real Orders" value={data.summary.real_orders} detail={`${data.summary.open_real_orders} open`} />
            <Metric label="Warnings" value={data.summary.reconciliation_warnings} />
            <Metric label="Mode" value={modeLabels[agentMode]} detail={platformLabels[platform]} />
          </div>

          <section>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-foreground">Strategy Registry</h2>
              <span className="text-xs text-foreground-muted">{data.strategies.length} shown</span>
            </div>
            {data.strategies.length === 0 ? (
              <EmptyRow label="No registered strategies match these filters." />
            ) : (
              <div className="glass-card overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[900px] text-sm">
                    <thead>
                      <tr className="border-b border-white/[0.06]">
                        <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-foreground-muted">Agent / Strategy</th>
                        <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-foreground-muted">Binding</th>
                        <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-foreground-muted">Status</th>
                        <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-foreground-muted">Total Value</th>
                        <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-foreground-muted">P&L</th>
                        <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-foreground-muted">Latest Snapshot</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.strategies.map((strategy) => (
                        <tr key={strategy.id} className="border-b border-white/[0.03] transition-colors hover:bg-white/[0.02]">
                          <td className="px-4 py-3">
                            <div className="flex min-w-0 items-center gap-3">
                              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-white/[0.08] bg-white/[0.04] text-xs font-bold text-foreground">
                                {agentInitial(strategy)}
                              </div>
                              <div className="min-w-0">
                                <div className="max-w-[280px] truncate font-semibold text-foreground">{agentLabel(strategy)}</div>
                                <div className="mt-1 max-w-[280px] truncate text-xs text-foreground-muted">{strategy.strategy_name} · {strategy.schedule ?? 'No schedule'}</div>
                              </div>
                            </div>
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex flex-wrap gap-1.5">
                              <Badge>{platformLabels[strategy.platform]}</Badge>
                              <Badge>{modeLabels[strategy.agent_mode]}</Badge>
                            </div>
                          </td>
                          <td className="px-4 py-3">
                            <Badge tone={statusClass(strategy.status)}>{strategy.status}</Badge>
                          </td>
                          <td className="px-4 py-3 text-right font-semibold text-foreground tabular-nums">
                            {strategy.latest_snapshot ? formatMoney(strategy.latest_snapshot.total_value) : formatMoney(strategy.starting_balance)}
                          </td>
                          <td className={`px-4 py-3 text-right font-semibold tabular-nums ${(strategy.latest_snapshot?.pnl ?? 0) >= 0 ? 'text-profit-light' : 'text-loss-light'}`}>
                            {strategy.latest_snapshot ? formatMoney(strategy.latest_snapshot.pnl) : '$0.00'}
                          </td>
                          <td className="px-4 py-3 text-xs text-foreground-muted">
                            {strategy.latest_snapshot ? `${strategy.latest_snapshot.source} · ${formatDate(strategy.latest_snapshot.captured_at)}` : 'No snapshots'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </section>

          <div className="grid gap-7 xl:grid-cols-[1.05fr_0.95fr]">
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
                    <div key={report.id} className="glass-card p-4">
                      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                        <div className="min-w-0">
                          <div className="truncate text-sm font-semibold text-foreground">{report.title ?? report.filename}</div>
                          <div className="mt-1 text-xs text-foreground-muted">{agentLabel(report)} · {report.strategy_name} · {formatDate(report.created_at)}</div>
                        </div>
                        <Badge>{report.filename}</Badge>
                      </div>
                      {(report.lessons_learned || report.next_steps) && (
                        <div className="mt-3 grid gap-2 text-xs text-foreground-muted sm:grid-cols-2">
                          <div className="line-clamp-2">{report.lessons_learned ?? 'No lessons captured'}</div>
                          <div className="line-clamp-2">{report.next_steps ?? 'No next steps captured'}</div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </section>

            <section>
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-lg font-semibold text-foreground">Reconciliation Warnings</h2>
                <span className="text-xs text-foreground-muted">{data.reconciliation_logs.length} logs</span>
              </div>
              {data.reconciliation_logs.length === 0 ? (
                <EmptyRow label="No reconciliation warnings match these filters." />
              ) : (
                <div className="space-y-3">
                  {data.reconciliation_logs.slice(0, 8).map((log) => (
                    <div key={log.id} className="glass-card p-4">
                      <div className="mb-2 flex items-center justify-between gap-3">
                        <div className="min-w-0 truncate text-sm font-semibold text-foreground">{agentLabel(log)} · {log.strategy_name ?? 'Unknown strategy'}</div>
                        <Badge tone={statusClass(log.severity)}>{log.severity}</Badge>
                      </div>
                      <div className="text-sm text-foreground">{log.message}</div>
                      <div className="mt-2 flex flex-wrap gap-2 text-xs text-foreground-muted">
                        <span>{platformLabels[log.platform] ?? log.platform}</span>
                        <span>·</span>
                        <span>{log.difference_type}</span>
                        <span>·</span>
                        <span>{formatDate(log.created_at)}</span>
                      </div>
                    </div>
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
                <div className="glass-card overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[820px] text-sm">
                      <thead>
                        <tr className="border-b border-white/[0.06]">
                          <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-foreground-muted">Strategy</th>
                          <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-foreground-muted">Market</th>
                          <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-foreground-muted">Side</th>
                          <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-foreground-muted">Qty</th>
                          <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-foreground-muted">Price</th>
                          <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-foreground-muted">Status</th>
                          <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-foreground-muted">Created</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.real_orders.slice(0, 12).map((order) => (
                          <tr key={order.id} className="border-b border-white/[0.03] transition-colors hover:bg-white/[0.02]">
                            <td className="px-4 py-3 max-w-[180px] truncate text-foreground">{agentLabel(order)} · {order.strategy_name ?? 'Unknown'}</td>
                            <td className="px-4 py-3 max-w-[220px] truncate text-foreground-muted">{order.market_slug_or_ticker ?? order.official_order_id ?? order.client_order_id ?? order.id}</td>
                            <td className="px-4 py-3"><Badge tone={order.side === 'BUY' ? 'bg-profit/10 text-profit-light border-profit/25' : 'bg-loss/10 text-loss-light border-loss/25'}>{order.side}</Badge></td>
                            <td className="px-4 py-3 text-right tabular-nums text-foreground">{order.quantity || '--'}</td>
                            <td className="px-4 py-3 text-right tabular-nums text-foreground">{order.price ? `${(order.price * 100).toFixed(1)}c` : '--'}</td>
                            <td className="px-4 py-3"><Badge tone={statusClass(order.status)}>{order.status}</Badge></td>
                            <td className="px-4 py-3 text-xs text-foreground-muted">{formatDate(order.created_at)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </section>
          </div>
        </div>
      )}
    </div>
  );
}
