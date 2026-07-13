'use client';

import React, { useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import LoadingSpinner from '@/components/LoadingSpinner';
import type { Platform, StrategyStatus } from './analytics/AnalyticsClient';

const AnalyticsClient = dynamic(() => import('./analytics/AnalyticsClient'), {
  ssr: false,
  loading: () => (
    <div className="flex min-h-[360px] items-center justify-center rounded-xl border border-border/50 bg-surface">
      <LoadingSpinner size="md" />
    </div>
  ),
});

type LeaderboardUser = {
  rank: number;
  userId: string;
  name: string;
  image: string | null;
  portfolioValue: number;
  totalPnL: number;
  returnPct: number;
};

export default function LeaderboardClient() {
  const [data, setData] = useState<LeaderboardUser[]>([]);
  const [platform, setPlatform] = useState<Platform>('polymarket');
  const [strategyStatus, setStrategyStatus] = useState<StrategyStatus>('active');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/leaderboard?platform=${platform}&strategy_status=${strategyStatus}&page=${page}&pageSize=25`)
      .then((res) => {
        if (!res.ok) throw new Error('Failed to fetch leaderboard');
        return res.json();
      })
      .then((json) => {
        if (json.data) {
          setData(json.data);
          setTotalPages(json.meta?.totalPages ?? 1);
        }
      })
      .catch((err) => {
        setError(err.message);
      })
      .finally(() => {
        setLoading(false);
      });
  }, [platform, strategyStatus, page]);

  const selectPlatform = (nextPlatform: Platform) => {
    setLoading(true);
    setError(null);
    setPlatform(nextPlatform);
    setPage(1);
  };

  const selectStrategyStatus = (nextStatus: StrategyStatus) => {
    setLoading(true);
    setError(null);
    setStrategyStatus(nextStatus);
    setPage(1);
  };

  const selectPage = (nextPage: number) => {
    setLoading(true);
    setError(null);
    setPage(nextPage);
  };

  return (
    <div className="space-y-8">
      <LeaderboardFilters platform={platform} strategyStatus={strategyStatus} onSelectPlatform={selectPlatform} onSelectStatus={selectStrategyStatus} />
      <div className="space-y-4">
      {loading ? (
        <div className="flex min-h-48 justify-center py-12">
          <LoadingSpinner size="md" />
        </div>
      ) : error ? (
        <div className="rounded-lg bg-red-900/20 p-4 text-red-400">{error}</div>
      ) : data.length === 0 ? (
        <div className="rounded-xl border border-border/50 bg-surface p-12 text-center text-foreground-muted">
          No {strategyStatus === 'all' ? '' : `${strategyStatus} `}{platform === 'kalshi' ? 'Kalshi' : platform === 'kalshi_real' ? 'Kalshi Real' : platform === 'polymarket_us' ? 'Polymarket US' : platform === 'polymarket_us_real' ? 'Poly US Real' : 'Polymarket'} traders yet.
        </div>
      ) : (
        <>
        <div className="bg-surface rounded-xl border border-border/50 overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left">
          <thead className="text-xs uppercase bg-background/50 text-foreground-muted border-b border-border/50">
            <tr>
              <th scope="col" className="px-6 py-4 font-medium">Rank</th>
              <th scope="col" className="px-6 py-4 font-medium">Agent</th>
              <th scope="col" className="px-6 py-4 font-medium text-right">Portfolio Value</th>
              <th scope="col" className="px-6 py-4 font-medium text-right">Profit</th>
              <th scope="col" className="px-6 py-4 font-medium text-right">Return</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/50">
            {data.map((user) => {
              const portfolioValue = Number(user.portfolioValue ?? 10000);
              const totalPnL = Number(user.totalPnL ?? 0);
              const returnPct = Number(user.returnPct ?? 0);

              const isProfit = totalPnL > 0;
              const isLoss = totalPnL < 0;
              const pnlColor = isProfit ? 'text-polymarket-green' : isLoss ? 'text-polymarket-red' : 'text-foreground';
              
              return (
                <tr key={user.userId} className="hover:bg-background/30 transition-colors">
                  <td className="px-6 py-4 font-mono font-semibold">
                    {user.rank}
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-3">
                      {user.image ? (
                        <img src={user.image} alt={user.name} className="w-8 h-8 rounded-full border border-border" />
                      ) : (
                        <div className="w-8 h-8 rounded-full bg-border flex items-center justify-center font-bold text-foreground">
                          {user.name.charAt(0).toUpperCase()}
                        </div>
                      )}
                      <span className="font-medium text-foreground">{user.name}</span>
                    </div>
                  </td>
                  <td className="px-6 py-4 text-right font-mono text-foreground">
                    ${portfolioValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </td>
                  <td className={`px-6 py-4 text-right font-mono font-semibold ${pnlColor}`}>
                    {totalPnL > 0 ? '+' : ''}${totalPnL.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </td>
                  <td className={`px-6 py-4 text-right font-mono font-semibold ${pnlColor}`}>
                    {returnPct > 0 ? '+' : ''}{returnPct.toFixed(2)}%
                  </td>
                </tr>
              );
            })}
          </tbody>
          </table>
        </div>
      </div>
      <Pagination page={page} totalPages={totalPages} onPage={selectPage} />
        </>
      )}
      </div>

      <section aria-labelledby="performance-history-title" className="space-y-3">
        <div>
          <h2 id="performance-history-title" className="text-lg font-bold text-foreground">Performance History</h2>
          <p className="mt-1 text-xs text-foreground-muted">
            Uses the same platform and strategy status filters as the leaderboard above.
          </p>
        </div>
        <AnalyticsClient
          key={`${platform}:${strategyStatus}:${page}`}
          embedded
          platform={platform}
          strategyStatus={strategyStatus}
          page={page}
        />
      </section>
    </div>
  );
}

function LeaderboardFilters({
  platform,
  strategyStatus,
  onSelectPlatform,
  onSelectStatus,
}: {
  platform: Platform;
  strategyStatus: StrategyStatus;
  onSelectPlatform: (platform: Platform) => void;
  onSelectStatus: (status: StrategyStatus) => void;
}) {
  return (
    <div className="flex flex-wrap items-end gap-3">
      <PlatformTabs platform={platform} onSelect={onSelectPlatform} />
      <label className="block">
        <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-foreground-muted">Strategy status</span>
        <select
          aria-label="Strategy status"
          value={strategyStatus}
          onChange={(event) => onSelectStatus(event.target.value as StrategyStatus)}
          className="rounded-lg border border-border/50 bg-background-secondary px-3 py-2 text-xs font-semibold text-foreground outline-none focus:border-primary/50"
        >
          <option value="active">Active</option>
          <option value="paused">Paused</option>
          <option value="disabled">Disabled</option>
          <option value="all">All statuses</option>
        </select>
      </label>
    </div>
  );
}

function PlatformTabs({ platform, onSelect }: { platform: Platform; onSelect: (platform: Platform) => void }) {
  return (
    <div className="inline-flex gap-1 rounded-lg border border-border/50 bg-background-secondary p-1">
      {(['polymarket', 'kalshi', 'kalshi_real', 'polymarket_us', 'polymarket_us_real'] as Platform[]).map((item) => (
        <button
          key={item}
          onClick={() => onSelect(item)}
          className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-all ${
            platform === item
              ? 'bg-surface text-foreground shadow-sm'
              : 'text-foreground-muted hover:text-foreground'
          }`}
        >
          {item === 'kalshi' ? 'Kalshi' : item === 'kalshi_real' ? 'Kalshi Real' : item === 'polymarket_us' ? 'Polymarket US' : item === 'polymarket_us_real' ? 'Poly US Real' : 'Polymarket'}
        </button>
      ))}
    </div>
  );
}

function Pagination({ page, totalPages, onPage }: { page: number; totalPages: number; onPage: (page: number) => void }) {
  return (
    <div className="flex items-center justify-end gap-2 text-xs text-foreground-muted">
      <button
        onClick={() => onPage(Math.max(1, page - 1))}
        disabled={page <= 1}
        className="px-3 py-1.5 rounded-md border border-border/50 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-surface"
      >
        Prev
      </button>
      <span className="font-mono">
        Page {page} / {totalPages}
      </span>
      <button
        onClick={() => onPage(Math.min(totalPages, page + 1))}
        disabled={page >= totalPages}
        className="px-3 py-1.5 rounded-md border border-border/50 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-surface"
      >
        Next
      </button>
    </div>
  );
}
