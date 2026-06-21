'use client';

import { useState } from 'react';
import { useEvents } from '@/hooks/useEvents';
import type { Market } from '@/hooks/useEvents';
import EventCard from '@/components/EventCard';
import CategoryFilter from '@/components/CategoryFilter';
import SearchBar from '@/components/SearchBar';
import TradeModal from '@/components/TradeModal';
import EmptyState from '@/components/EmptyState';

export default function MarketsPage() {
  const {
    events,
    isLoading,
    error,
    category,
    setCategory,
    searchQuery,
    setSearchQuery,
    refetch,
  } = useEvents();

  const [tradeMarket, setTradeMarket] = useState<Market | null>(null);

  return (
    <div className="px-4 sm:px-6 lg:px-8 py-6 max-w-[1000px] mx-auto">
      {/* Header */}
      <div className="mb-6 animate-fade-in-up">
        <h1 className="text-2xl sm:text-3xl font-bold text-foreground tracking-tight">
          Events
        </h1>
        <p className="text-sm text-foreground-muted mt-1">
          Browse prediction events and place paper trades
        </p>
      </div>

      {/* Filters row */}
      <div className="mb-6 space-y-4 animate-fade-in-up" style={{ animationDelay: '80ms' }}>
        <CategoryFilter selected={category} onSelect={setCategory} />

        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
          <div className="flex-1">
            <SearchBar value={searchQuery} onChange={setSearchQuery} />
          </div>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="rounded-xl bg-loss/10 border border-loss/25 p-4 mb-6 text-sm text-loss-light animate-fade-in">
          <p className="font-semibold mb-1">Failed to load events</p>
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
        <div className="flex flex-col gap-5">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="glass-card overflow-hidden">
              <div className="p-5 space-y-3">
                <div className="skeleton h-6 w-3/4" />
                <div className="skeleton h-3 w-1/4" />
                <div className="skeleton h-12 w-full mt-3" />
                <div className="skeleton h-12 w-full mt-3" />
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Event list */}
      {!isLoading && !error && events.length > 0 && (
        <div className="flex flex-col stagger-children">
          {events.map((event) => (
            <EventCard
              key={event.id}
              event={event}
              onTrade={setTradeMarket}
            />
          ))}
        </div>
      )}

      {/* Empty state */}
      {!isLoading && !error && events.length === 0 && (
        <EmptyState
          icon={
            <svg className="h-7 w-7 text-foreground-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
            </svg>
          }
          title="No events found"
          description={
            searchQuery
              ? `No events match "${searchQuery}". Try a different search term.`
              : 'No events available in this category.'
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
          market={tradeMarket as any} // Might need type assertion due to different hook
          onClose={() => setTradeMarket(null)}
          onSuccess={refetch}
        />
      )}
    </div>
  );
}
