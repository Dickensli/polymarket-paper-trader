'use client';

import { useState } from 'react';
import { usePortfolio } from '@/hooks/usePortfolio';
import StatsCard from '@/components/StatsCard';
import PositionRow from '@/components/PositionRow';
import EmptyState from '@/components/EmptyState';
import LoadingSpinner from '@/components/LoadingSpinner';
import Link from 'next/link';

export default function PortfolioPage() {
  const { portfolio, isLoading, error, refetch, resetPortfolio, closePosition } =
    usePortfolio();
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [isResetting, setIsResetting] = useState(false);

  const handleReset = async () => {
    setIsResetting(true);
    await resetPortfolio();
    setIsResetting(false);
    setShowResetConfirm(false);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <LoadingSpinner size="lg" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="px-4 sm:px-6 lg:px-8 py-12 max-w-3xl mx-auto text-center animate-fade-in">
        <div className="glass-card p-8">
          <svg className="h-12 w-12 mx-auto mb-4 text-loss-light" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
          </svg>
          <h2 className="text-lg font-semibold text-foreground mb-2">Failed to load portfolio</h2>
          <p className="text-sm text-foreground-muted mb-6">{error}</p>
          <button
            onClick={refetch}
            className="rounded-xl bg-primary/15 px-5 py-2.5 text-sm font-semibold text-primary-light border border-primary/25 transition-all hover:bg-primary/25"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  if (!portfolio) return null;

  const pnlPositive = portfolio.totalPnL >= 0;

  return (
    <div className="px-4 sm:px-6 lg:px-8 py-6 max-w-[1200px] mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between mb-6 gap-4 animate-fade-in-up">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-foreground tracking-tight">
            Portfolio
          </h1>
          <p className="text-sm text-foreground-muted mt-1">
            Track your paper trading performance
          </p>
        </div>
        <button
          onClick={() => setShowResetConfirm(true)}
          className="rounded-xl border border-loss/25 bg-loss/10 px-4 py-2.5 text-sm font-semibold text-loss-light transition-all hover:bg-loss/20 hover:border-loss/40 active:scale-95 self-start sm:self-auto"
        >
          Reset Portfolio
        </button>
      </div>

      {/* Stats grid */}
      <div
        className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8 animate-fade-in-up"
        style={{ animationDelay: '80ms' }}
      >
        <StatsCard
          label="Portfolio Value"
          value={`$${portfolio.totalValue.toLocaleString('en-US', { minimumFractionDigits: 2 })}`}
          icon={
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 18.75a60.07 60.07 0 0115.797 2.101c.727.198 1.453-.342 1.453-1.096V18.75M3.75 4.5v.75A.75.75 0 013 6h-.75m0 0v-.375c0-.621.504-1.125 1.125-1.125H20.25M2.25 6v9m18-10.5v.75c0 .414.336.75.75.75h.75m-1.5-1.5h.375c.621 0 1.125.504 1.125 1.125v9.75c0 .621-.504 1.125-1.125 1.125h-.375m1.5-1.5H21a.75.75 0 00-.75.75v.75m0 0H3.75m0 0h-.375a1.125 1.125 0 01-1.125-1.125V15m1.5 1.5v-.75A.75.75 0 003 15h-.75M15 10.5a3 3 0 11-6 0 3 3 0 016 0zm3 0h.008v.008H18V10.5zm-12 0h.008v.008H6V10.5z" />
            </svg>
          }
        />
        <StatsCard
          label="Cash Balance"
          value={`$${portfolio.balance.toLocaleString('en-US', { minimumFractionDigits: 2 })}`}
          icon={
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 12a2.25 2.25 0 00-2.25-2.25H15a3 3 0 11-6 0H5.25A2.25 2.25 0 003 12m18 0v6a2.25 2.25 0 01-2.25 2.25H5.25A2.25 2.25 0 013 18v-6m18 0V9M3 12V9m18 0a2.25 2.25 0 00-2.25-2.25H5.25A2.25 2.25 0 003 9m18 0V6a2.25 2.25 0 00-2.25-2.25H5.25A2.25 2.25 0 003 6v3" />
            </svg>
          }
        />
        <StatsCard
          label="Total P&L"
          value={`${pnlPositive ? '+' : ''}$${portfolio.totalPnL.toFixed(2)}`}
          subValue={`${pnlPositive ? '+' : ''}${portfolio.totalPnLPercent.toFixed(2)}%`}
          trend={pnlPositive ? 'up' : 'down'}
          icon={
            pnlPositive ? (
              <svg className="h-4 w-4 text-profit-light" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 18L9 11.25l4.306 4.307a11.95 11.95 0 015.814-5.519l2.74-1.22m0 0l-5.94-2.28m5.94 2.28l-2.28 5.941" />
              </svg>
            ) : (
              <svg className="h-4 w-4 text-loss-light" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 6L9 12.75l4.286-4.286a11.948 11.948 0 014.306 6.43l.776 2.898m0 0l3.182-5.511m-3.182 5.511l-5.511-3.182" />
              </svg>
            )
          }
        />
        <StatsCard
          label="Active Positions"
          value={portfolio.positions.length}
          subValue={`${portfolio.tradeHistory.length} total trades`}
          trend="neutral"
          icon={
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 3v11.25A2.25 2.25 0 006 16.5h2.25M3.75 3h-1.5m1.5 0h16.5m0 0h1.5m-1.5 0v11.25A2.25 2.25 0 0118 16.5h-2.25m-7.5 0h7.5m-7.5 0l-1 3m8.5-3l1 3m0 0l.5 1.5m-.5-1.5h-9.5m0 0l-.5 1.5" />
            </svg>
          }
        />
      </div>

      {/* Positions */}
      <div className="mb-8 animate-fade-in-up" style={{ animationDelay: '160ms' }}>
        <h2 className="text-lg font-semibold text-foreground mb-4">
          Active Positions
        </h2>

        {portfolio.positions.length > 0 ? (
          <div className="space-y-3">
            {portfolio.positions.map((pos) => (
              <PositionRow
                key={pos.id}
                position={pos}
                onClose={closePosition}
              />
            ))}
          </div>
        ) : (
          <EmptyState
            icon={
              <svg className="h-7 w-7 text-foreground-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M20.25 7.5l-.625 10.632a2.25 2.25 0 01-2.247 2.118H6.622a2.25 2.25 0 01-2.247-2.118L3.75 7.5m6 4.125l2.25 2.25m0 0l2.25 2.25M12 13.875l2.25-2.25M12 13.875l-2.25 2.25M3.375 7.5h17.25c.621 0 1.125-.504 1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125z" />
              </svg>
            }
            title="No active positions"
            description="You haven't placed any trades yet. Browse markets to start paper trading."
            action={
              <Link
                href="/"
                className="inline-flex items-center gap-2 rounded-xl bg-primary/15 px-5 py-2.5 text-sm font-semibold text-primary-light border border-primary/25 transition-all hover:bg-primary/25"
              >
                Browse Markets →
              </Link>
            }
          />
        )}
      </div>

      {/* Trade history */}
      <div className="animate-fade-in-up" style={{ animationDelay: '240ms' }}>
        <h2 className="text-lg font-semibold text-foreground mb-4">
          Trade History
        </h2>

        {portfolio.tradeHistory.length > 0 ? (
          <div className="glass-card overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-white/[0.06]">
                    <th className="px-5 py-3.5 text-left text-xs font-medium uppercase tracking-wider text-foreground-muted">
                      Market
                    </th>
                    <th className="px-5 py-3.5 text-left text-xs font-medium uppercase tracking-wider text-foreground-muted">
                      Side
                    </th>
                    <th className="px-5 py-3.5 text-left text-xs font-medium uppercase tracking-wider text-foreground-muted">
                      Outcome
                    </th>
                    <th className="px-5 py-3.5 text-right text-xs font-medium uppercase tracking-wider text-foreground-muted">
                      Shares
                    </th>
                    <th className="px-5 py-3.5 text-right text-xs font-medium uppercase tracking-wider text-foreground-muted">
                      Price
                    </th>
                    <th className="px-5 py-3.5 text-right text-xs font-medium uppercase tracking-wider text-foreground-muted">
                      Total
                    </th>
                    <th className="px-5 py-3.5 text-right text-xs font-medium uppercase tracking-wider text-foreground-muted">
                      Date
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {portfolio.tradeHistory.map((trade) => (
                    <tr
                      key={trade.id}
                      className="border-b border-white/[0.03] hover:bg-white/[0.02] transition-colors"
                    >
                      <td className="px-5 py-3.5 text-foreground max-w-[200px] truncate">
                        <Link
                          href={`/market/${trade.marketId}`}
                          className="hover:text-primary-light transition-colors"
                        >
                          {trade.marketQuestion}
                        </Link>
                      </td>
                      <td className="px-5 py-3.5">
                        <span
                          className={`rounded-md px-2 py-0.5 text-[10px] font-bold uppercase ${
                            trade.side === 'BUY'
                              ? 'bg-profit/15 text-profit-light border border-profit/25'
                              : 'bg-loss/15 text-loss-light border border-loss/25'
                          }`}
                        >
                          {trade.side}
                        </span>
                      </td>
                      <td className="px-5 py-3.5">
                        <span
                          className={`text-xs font-semibold ${
                            trade.outcome === 'YES'
                              ? 'text-profit-light'
                              : 'text-loss-light'
                          }`}
                        >
                          {trade.outcome}
                        </span>
                      </td>
                      <td className="px-5 py-3.5 text-right text-foreground tabular-nums">
                        {trade.shares}
                      </td>
                      <td className="px-5 py-3.5 text-right text-foreground tabular-nums">
                        {(trade.price * 100).toFixed(1)}¢
                      </td>
                      <td className="px-5 py-3.5 text-right text-foreground font-semibold tabular-nums">
                        ${trade.total.toFixed(2)}
                      </td>
                      <td className="px-5 py-3.5 text-right text-foreground-muted tabular-nums">
                        {new Date(trade.timestamp).toLocaleDateString('en-US', {
                          month: 'short',
                          day: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : (
          <EmptyState
            icon={
              <svg className="h-7 w-7 text-foreground-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            }
            title="No trade history"
            description="Your completed trades will appear here."
          />
        )}
      </div>

      {/* Reset confirmation modal */}
      {showResetConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center animate-fade-in">
          <div
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={() => setShowResetConfirm(false)}
          />
          <div className="relative glass-card border border-white/[0.08] bg-[#12131a]/95 backdrop-blur-xl rounded-2xl p-6 w-full max-w-sm mx-4 animate-slide-up">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-loss/15 border border-loss/25 mx-auto mb-4">
              <svg className="h-6 w-6 text-loss-light" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
              </svg>
            </div>
            <h3 className="text-lg font-semibold text-foreground text-center mb-2">
              Reset Portfolio?
            </h3>
            <p className="text-sm text-foreground-muted text-center mb-6">
              This will close all positions and reset your balance to $10,000.
              This action cannot be undone.
            </p>
            <div className="grid grid-cols-2 gap-3">
              <button
                onClick={() => setShowResetConfirm(false)}
                className="rounded-xl border border-white/[0.08] bg-white/[0.03] py-2.5 text-sm font-semibold text-foreground transition-all hover:bg-white/[0.06]"
              >
                Cancel
              </button>
              <button
                onClick={handleReset}
                disabled={isResetting}
                className="rounded-xl bg-gradient-to-r from-loss to-loss-light py-2.5 text-sm font-bold text-white transition-all hover:shadow-[0_4px_20px_rgba(244,63,94,0.3)] active:scale-[0.98] disabled:opacity-50"
              >
                {isResetting ? <LoadingSpinner size="sm" /> : 'Reset'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
