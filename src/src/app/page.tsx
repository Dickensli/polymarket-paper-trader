'use client';

import { useState } from 'react';
import { useMarkets } from '@/hooks/useMarkets';
import type { Market } from '@/hooks/useMarkets';
import MarketCard from '@/components/MarketCard';
import CategoryFilter from '@/components/CategoryFilter';
import SearchBar from '@/components/SearchBar';
import TradeModal from '@/components/TradeModal';
import EmptyState from '@/components/EmptyState';

export default function MarketsPage() {
  const {
    filteredMarkets,
    isLoading,
    error,
    category,
    setCategory,
    searchQuery,
    setSearchQuery,
    sortBy,
    setSortBy,
    refetch,
  } = useMarkets();

  const [tradeMarket, setTradeMarket] = useState<Market | null>(null);

  return (
    <div className="px-4 sm:px-6 lg:px-8 py-6 max-w-[1440px] mx-auto">
      {/* Header */}
      <div className="mb-6 animate-fade-in-up">
        <h1 className="text-2xl sm:text-3xl font-bold text-foreground tracking-tight">
          Markets
        </h1>
        <p className="text-sm text-foreground-muted mt-1">
          Browse prediction markets and place paper trades
        </p>
      </div>

      {/* Filters row */}
      <div className="mb-6 space-y-4 animate-fade-in-up" style={{ animationDelay: '80ms' }}>
        <CategoryFilter selected={category} onSelect={setCategory} />

        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
          <div className="flex-1">
            <SearchBar value={searchQuery} onChange={setSearchQuery} />
          </div>

          {/* Sort */}
          <div className="flex items-center gap-2">
            {(['volume', 'newest', 'trending'] as const).map((s) => (
              <button
                key={s}
                onClick={() => setSortBy(s)}
                className={`
                  rounded-lg px-3 py-2 text-xs font-medium capitalize transition-all duration-200 border
                  ${
                    sortBy === s
                      ? 'bg-white/[0.06] text-foreground border-white/[0.1]'
                      : 'bg-transparent text-foreground-muted border-transparent hover:text-foreground'
                  }
                `}
              >
                {s}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="rounded-xl bg-loss/10 border border-loss/25 p-4 mb-6 text-sm text-loss-light animate-fade-in">
          <p className="font-semibold mb-1">Failed to load markets</p>
          <p className="text-loss-light/70">{error}</p>
          <button
            onClick={refetch}
            className="mt-3 text-xs font-semibold text-loss-light underline underline-offset-2 hover:text-loss"
          >
            Try again
          </button>
        </div>
      )}

      {/* Loading skeleton */}
      {isLoading && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="glass-card overflow-hidden">
              <div className="skeleton h-36 rounded-none" />
              <div className="p-5 space-y-3">
                <div className="skeleton h-4 w-3/4" />
                <div className="skeleton h-3 w-1/2" />
                <div className="skeleton h-2.5 w-full mt-3" />
                <div className="flex justify-between mt-3">
                  <div className="skeleton h-3 w-20" />
                  <div className="skeleton h-8 w-16 rounded-xl" />
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Market grid */}
      {!isLoading && !error && filteredMarkets.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5 stagger-children">
          {filteredMarkets.map((market) => (
            <MarketCard
              key={market.id}
              market={market}
              onTrade={setTradeMarket}
            />
          ))}
        </div>
      )}

      {/* Empty state */}
      {!isLoading && !error && filteredMarkets.length === 0 && (
        <EmptyState
          icon={
            <svg className="h-7 w-7 text-foreground-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
            </svg>
          }
          title="No markets found"
          description={
            searchQuery
              ? `No markets match "${searchQuery}". Try a different search term.`
              : 'No markets available in this category.'
          }
          action={
            searchQuery ? (
              <button
                onClick={() => setSearchQuery('')}
                className="rounded-xl bg-primary/15 px-5 py-2.5 text-sm font-semibold text-primary-light border border-primary/25 transition-all hover:bg-primary/25"
              >
                Clear search
              </button>
            ) : undefined
          }
        />
      )}

      {/* Trade modal */}
      {tradeMarket && (
        <TradeModal
          market={tradeMarket}
          onClose={() => setTradeMarket(null)}
          onSuccess={refetch}
        />
      )}
    </div>
  );
}
