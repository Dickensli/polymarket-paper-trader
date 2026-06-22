'use client';

import { useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import { useMarket } from '@/hooks/useMarket';
import { usePortfolio } from '@/hooks/usePortfolio';
import PriceBar from '@/components/PriceBar';
import TradeModal from '@/components/TradeModal';
import LoadingSpinner from '@/components/LoadingSpinner';
import PriceChart from '@/components/PriceChart';

export default function MarketDetailPage() {
  const params = useParams();
  const id = params.id as string;
  const { market, isLoading, error } = useMarket(id);
  const { portfolio, refetch: refetchPortfolio } = usePortfolio();
  const [showTrade, setShowTrade] = useState(false);

  // Trades for this market from portfolio history
  const marketTrades = (portfolio?.tradeHistory ?? []).filter(
    (t) => t.marketId === id
  );
  const marketPositions = (portfolio?.positions ?? []).filter(
    (p) => p.marketId === id
  );

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <LoadingSpinner size="lg" />
      </div>
    );
  }

  if (error || !market) {
    return (
      <div className="px-4 sm:px-6 lg:px-8 py-12 max-w-3xl mx-auto text-center animate-fade-in">
        <div className="glass-card p-8">
          <svg className="h-12 w-12 mx-auto mb-4 text-loss-light" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
          </svg>
          <h2 className="text-lg font-semibold text-foreground mb-2">Market not found</h2>
          <p className="text-sm text-foreground-muted mb-6">{error ?? 'This market may have been removed.'}</p>
          <Link
            href="/"
            className="inline-flex items-center gap-2 rounded-xl bg-primary/15 px-5 py-2.5 text-sm font-semibold text-primary-light border border-primary/25 transition-all hover:bg-primary/25"
          >
            ← Back to Markets
          </Link>
        </div>
      </div>
    );
  }

  const yesPrice = market.midpoints?.YES ?? market.outcomePrices[0] ?? 0.5;
  const noPrice = market.midpoints?.NO ?? market.outcomePrices[1] ?? 0.5;
  const yesPct = Math.round(yesPrice * 100);
  const noPct = Math.round(noPrice * 100);

  return (
    <div className="px-4 sm:px-6 lg:px-8 py-6 max-w-6xl mx-auto">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm text-foreground-muted mb-6 animate-fade-in">
        <Link href="/" className="hover:text-foreground transition-colors">
          Markets
        </Link>
        <span className="text-foreground-muted/40">/</span>
        <span className="text-foreground truncate max-w-xs">{market.question}</span>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Main content — 2/3 */}
        <div className="lg:col-span-2 space-y-6">
          {/* Hero card */}
          <div className="glass-card overflow-hidden animate-fade-in-up">
            {market.image && (
              <div className="relative h-48 sm:h-56 w-full overflow-hidden">
                <Image
                  src={market.image}
                  alt=""
                  fill
                  priority
                  className="object-cover"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-[#12131a] via-[#12131a]/50 to-transparent" />
                <div className="absolute bottom-4 left-5 right-5">
                  <span className="inline-block rounded-lg bg-white/10 backdrop-blur-md px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-white/80 border border-white/10 mb-2">
                    {market.category}
                  </span>
                  <h1 className="text-xl sm:text-2xl font-bold text-white leading-tight">
                    {market.question}
                  </h1>
                </div>
              </div>
            )}
            {!market.image && (
              <div className="p-6">
                <span className="inline-block rounded-lg bg-white/10 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-foreground-muted border border-white/[0.06] mb-3">
                  {market.category}
                </span>
                <h1 className="text-xl sm:text-2xl font-bold text-foreground leading-tight">
                  {market.question}
                </h1>
              </div>
            )}
          </div>

          {/* Probability display */}
          <div className="glass-card p-6 animate-fade-in-up" style={{ animationDelay: '80ms' }}>
            <h2 className="text-xs font-medium uppercase tracking-wider text-foreground-muted mb-5">
              Current Probability
            </h2>

            <div className="grid grid-cols-2 gap-4 mb-5">
              <div className="rounded-xl bg-profit/[0.06] border border-profit/20 p-4 text-center">
                <p className="text-xs font-semibold text-profit-light uppercase tracking-wide mb-1">
                  Yes
                </p>
                <p className="text-4xl font-bold text-profit-light">
                  {yesPct}
                  <span className="text-lg">¢</span>
                </p>
              </div>
              <div className="rounded-xl bg-loss/[0.06] border border-loss/20 p-4 text-center">
                <p className="text-xs font-semibold text-loss-light uppercase tracking-wide mb-1">
                  No
                </p>
                <p className="text-4xl font-bold text-loss-light">
                  {noPct}
                  <span className="text-lg">¢</span>
                </p>
              </div>
            </div>

            <PriceBar yesPrice={yesPrice} noPrice={noPrice} height="lg" />
          </div>

          {/* Price History Chart */}
          {market.conditionId && (
            <div className="glass-card p-4 sm:p-6 animate-fade-in-up" style={{ animationDelay: '110ms' }}>
              <h3 className="text-sm font-semibold text-foreground-muted uppercase tracking-wider mb-4">Price History</h3>
              <PriceChart conditionId={market.conditionId} height={280} />
            </div>
          )}

          {/* Order book (simplified) */}
          <div className="glass-card p-6 animate-fade-in-up" style={{ animationDelay: '140ms' }}>
            <h2 className="text-xs font-medium uppercase tracking-wider text-foreground-muted mb-4">
              Order Book
            </h2>
            <div className="space-y-3">
              <div className="flex items-center justify-between text-sm">
                <span className="text-foreground-muted">Best Bid</span>
                <span className="text-profit-light font-semibold">
                  {(market.bestBid * 100).toFixed(1)}¢
                </span>
              </div>
              <div className="relative h-3 rounded-full overflow-hidden bg-white/[0.04]">
                <div
                  className="absolute inset-y-0 left-0 rounded-full bg-profit/30"
                  style={{ width: `${market.bestBid * 100}%` }}
                />
                <div
                  className="absolute inset-y-0 right-0 rounded-full bg-loss/30"
                  style={{ width: `${(1 - market.bestAsk) * 100}%` }}
                />
                <div
                  className="absolute inset-y-0 bg-foreground-muted/20 rounded-full"
                  style={{
                    left: `${market.bestBid * 100}%`,
                    width: `${market.spread * 100}%`,
                  }}
                />
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-foreground-muted">Best Ask</span>
                <span className="text-loss-light font-semibold">
                  {(market.bestAsk * 100).toFixed(1)}¢
                </span>
              </div>
              <div className="flex items-center justify-between text-sm pt-2 border-t border-white/[0.04]">
                <span className="text-foreground-muted">Spread</span>
                <span className="text-foreground font-medium">
                  {(market.spread * 100).toFixed(1)}¢
                </span>
              </div>
            </div>
          </div>

          {/* Market info */}
          <div className="glass-card p-6 animate-fade-in-up" style={{ animationDelay: '200ms' }}>
            <h2 className="text-xs font-medium uppercase tracking-wider text-foreground-muted mb-4">
              Market Info
            </h2>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
              {[
                {
                  label: '24h Volume',
                  value: `$${market.volume24hr.toLocaleString('en-US', { minimumFractionDigits: 2 })}`,
                },
                {
                  label: 'Liquidity',
                  value: `$${market.liquidity.toLocaleString('en-US', { minimumFractionDigits: 2 })}`,
                },
                {
                  label: 'Last Trade',
                  value: `${(market.lastTradePrice * 100).toFixed(1)}¢`,
                },
                {
                  label: 'End Date',
                  value: new Date(market.endDate).toLocaleDateString('en-US', {
                    year: 'numeric',
                    month: 'short',
                    day: 'numeric',
                  }),
                },
                {
                  label: 'Status',
                  value: market.closed ? 'Closed' : 'Active',
                },
              ].map((item) => (
                <div key={item.label}>
                  <p className="text-xs text-foreground-muted mb-0.5">
                    {item.label}
                  </p>
                  <p className="text-sm font-semibold text-foreground">
                    {item.value}
                  </p>
                </div>
              ))}
            </div>
          </div>

          {/* Trade history for this market */}
          {marketTrades.length > 0 && (
            <div className="glass-card p-6 animate-fade-in-up" style={{ animationDelay: '260ms' }}>
              <h2 className="text-xs font-medium uppercase tracking-wider text-foreground-muted mb-4">
                Your Trades
              </h2>
              <div className="space-y-2">
                {marketTrades.map((trade) => (
                  <div
                    key={trade.id}
                    className="flex items-center justify-between rounded-xl bg-white/[0.02] border border-white/[0.04] p-3.5"
                  >
                    <div className="flex items-center gap-3">
                      <span
                        className={`rounded-md px-2 py-0.5 text-[10px] font-bold uppercase ${
                          trade.side === 'BUY'
                            ? 'bg-profit/15 text-profit-light border border-profit/25'
                            : 'bg-loss/15 text-loss-light border border-loss/25'
                        }`}
                      >
                        {trade.side}
                      </span>
                      <span
                        className={`text-xs font-semibold ${
                          trade.outcome === 'YES'
                            ? 'text-profit-light'
                            : 'text-loss-light'
                        }`}
                      >
                        {trade.outcome}
                      </span>
                    </div>
                    <div className="flex items-center gap-4 text-xs">
                      <span className="text-foreground-muted">
                        {trade.shares} shares @ {(trade.price * 100).toFixed(1)}¢
                      </span>
                      <span className="text-foreground font-semibold">
                        ${trade.total.toFixed(2)}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Trade panel — 1/3 */}
        <div className="space-y-6">
          {/* Quick trade card */}
          <div className="glass-card p-6 sticky top-20 animate-fade-in-up" style={{ animationDelay: '100ms' }}>
            <h2 className="text-xs font-medium uppercase tracking-wider text-foreground-muted mb-4">
              Trade
            </h2>

            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <button
                  onClick={() => setShowTrade(true)}
                  className="rounded-xl bg-profit/10 border border-profit/25 py-4 text-center transition-all hover:bg-profit/20 hover:shadow-[0_0_20px_rgba(16,185,129,0.15)] active:scale-95"
                >
                  <p className="text-2xl font-bold text-profit-light mb-0.5">
                    {yesPct}¢
                  </p>
                  <p className="text-xs font-semibold text-profit-light/80 uppercase">
                    Buy Yes
                  </p>
                </button>
                <button
                  onClick={() => setShowTrade(true)}
                  className="rounded-xl bg-loss/10 border border-loss/25 py-4 text-center transition-all hover:bg-loss/20 hover:shadow-[0_0_20px_rgba(244,63,94,0.15)] active:scale-95"
                >
                  <p className="text-2xl font-bold text-loss-light mb-0.5">
                    {noPct}¢
                  </p>
                  <p className="text-xs font-semibold text-loss-light/80 uppercase">
                    Buy No
                  </p>
                </button>
              </div>

              <button
                onClick={() => setShowTrade(true)}
                className="w-full rounded-xl bg-gradient-to-r from-primary to-primary-light py-3 text-sm font-bold text-white shadow-[0_4px_20px_rgba(59,130,246,0.25)] transition-all hover:shadow-[0_4px_30px_rgba(59,130,246,0.35)] active:scale-[0.98]"
              >
                Place Paper Trade
              </button>
            </div>
          </div>

          {/* Your positions in this market */}
          {marketPositions.length > 0 && (
            <div className="glass-card p-6 animate-fade-in-up" style={{ animationDelay: '180ms' }}>
              <h2 className="text-xs font-medium uppercase tracking-wider text-foreground-muted mb-4">
                Your Positions
              </h2>
              <div className="space-y-3">
                {marketPositions.map((pos) => (
                  <div
                    key={pos.id}
                    className="rounded-xl bg-white/[0.02] border border-white/[0.04] p-3.5"
                  >
                    <div className="flex items-center justify-between mb-2">
                      <span
                        className={`rounded-md px-2 py-0.5 text-[10px] font-bold uppercase ${
                          pos.outcome === 'YES'
                            ? 'bg-profit/15 text-profit-light border border-profit/25'
                            : 'bg-loss/15 text-loss-light border border-loss/25'
                        }`}
                      >
                        {pos.outcome}
                      </span>
                      <span
                        className={`text-sm font-bold ${
                          pos.unrealizedPnL >= 0
                            ? 'text-profit-light'
                            : 'text-loss-light'
                        }`}
                      >
                        {pos.unrealizedPnL >= 0 ? '+' : ''}$
                        {pos.unrealizedPnL.toFixed(2)}
                      </span>
                    </div>
                    <div className="text-xs text-foreground-muted">
                      {pos.shares} shares @ {(pos.avgEntryPrice * 100).toFixed(1)}¢
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Trade modal */}
      {showTrade && (
        <TradeModal
          market={market}
          onClose={() => setShowTrade(false)}
          onSuccess={refetchPortfolio}
        />
      )}
    </div>
  );
}
