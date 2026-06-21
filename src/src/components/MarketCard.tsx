'use client';

import Link from 'next/link';
import Image from 'next/image';
import PriceBar from './PriceBar';
import type { Market } from '@/hooks/useMarkets';

interface MarketCardProps {
  market: Market;
  onTrade: (market: Market) => void;
}

function formatVolume(v: number): string {
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `$${(v / 1_000).toFixed(1)}K`;
  return `$${v.toFixed(0)}`;
}

export default function MarketCard({ market, onTrade }: MarketCardProps) {
  const yesPrice = market.outcomePrices[0] ?? 0.5;
  const noPrice = market.outcomePrices[1] ?? 0.5;

  return (
    <div className="glass-card glass-card-hover group relative flex flex-col overflow-hidden">
      {/* Top section with image & category */}
      <div className="relative">
        {market.image ? (
          <div className="relative h-36 w-full overflow-hidden bg-white/[0.02]">
            <Image
              src={market.image}
              alt=""
              fill
              sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 33vw"
              className="object-cover transition-transform duration-500 group-hover:scale-105"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-[#0a0b0f] via-[#0a0b0f]/60 to-transparent" />
          </div>
        ) : (
          <div className="h-20 w-full bg-gradient-to-br from-primary/10 to-primary/5" />
        )}

        {/* Category badge */}
        <span className="absolute top-3 left-3 rounded-lg bg-white/10 backdrop-blur-md px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-white/80 border border-white/10">
          {market.category}
        </span>

        {/* Volume badge */}
        <span className="absolute top-3 right-3 rounded-lg bg-white/10 backdrop-blur-md px-2.5 py-1 text-[10px] font-semibold text-white/80 border border-white/10 flex items-center gap-1">
          <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
          </svg>
          {formatVolume(market.volume24hr)}
        </span>
      </div>

      {/* Content */}
      <div className="flex flex-1 flex-col p-5 pt-4">
        <Link
          href={`/market/${market.id}`}
          className="text-sm font-semibold text-foreground leading-snug mb-4 line-clamp-2 hover:text-primary-light transition-colors"
        >
          {market.question}
        </Link>

        {/* Price bar */}
        <div className="mb-4">
          <PriceBar yesPrice={yesPrice} noPrice={noPrice} />
        </div>

        {/* Bottom row */}
        <div className="mt-auto flex items-center justify-between gap-2">
          <div className="flex items-center gap-3 text-xs text-foreground-muted">
            <span className="flex items-center gap-1">
              <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              {new Date(market.endDate).toLocaleDateString('en-US', {
                month: 'short',
                day: 'numeric',
              })}
            </span>
            <span className="text-foreground-muted/50">•</span>
            <span>Spread {(market.spread * 100).toFixed(1)}¢</span>
          </div>

          <button
            onClick={(e) => {
              e.preventDefault();
              onTrade(market);
            }}
            className="rounded-xl bg-primary/15 px-4 py-2 text-xs font-semibold text-primary-light border border-primary/25 transition-all duration-200 hover:bg-primary/25 hover:shadow-[0_0_16px_rgba(59,130,246,0.2)] active:scale-95"
          >
            Trade
          </button>
        </div>
      </div>
    </div>
  );
}
