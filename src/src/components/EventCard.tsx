'use client';

import Image from 'next/image';
import type { PolymarketEvent, Market } from '@/hooks/useEvents';
import { useLivePrices } from '@/hooks/useLivePrices';
import { formatProbability } from '@/lib/utils';

interface EventCardProps {
  event: PolymarketEvent;
  onTrade: (market: Market) => void;
}

export default function EventCard({ event, onTrade }: EventCardProps) {
  // Collect all token IDs from all markets in this event to subscribe to live prices
  const allTokenIds = event.markets.flatMap((m) => m.tokenIds || []);
  
  // Use the WebSocket hook to get live prices
  const livePrices = useLivePrices(allTokenIds);

  return (
    <div className="glass-card flex flex-col overflow-hidden mb-6 animate-fade-in-up">
      {/* Event Header */}
      <div className="flex flex-col sm:flex-row p-5 gap-4 border-b border-white/[0.05]">
        {event.image && (
          <div className="relative h-16 w-16 flex-shrink-0 rounded-lg overflow-hidden border border-white/[0.1]">
            <Image
              src={event.image}
              alt={event.title}
              fill
              className="object-cover"
            />
          </div>
        )}
        <div className="flex-1">
          <h2 className="text-lg font-bold text-foreground leading-snug">
            {event.title}
          </h2>
          <div className="flex gap-2 mt-2">
            <span className="rounded bg-white/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-white/80">
              {event.category || 'General'}
            </span>
          </div>
        </div>
      </div>

      {/* Markets List */}
      <div className="flex flex-col divide-y divide-white/[0.05]">
        {event.markets.map((market) => {
          // Yes token is typically at index 0, No token at index 1
          const yesTokenId = market.tokenIds?.[0];
          const noTokenId = market.tokenIds?.[1];

          // Use live price if available, otherwise fallback to cached price
          const yesPrice = (yesTokenId ? livePrices[yesTokenId] : undefined) ?? (market.outcomePrices?.[0] || 0.5);
          const noPrice = (noTokenId ? livePrices[noTokenId] : undefined) ?? (market.outcomePrices?.[1] || 0.5);

          const yesProb = formatProbability(yesPrice);
          const noProb = formatProbability(noPrice);

          return (
            <div key={market.id} className="p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 hover:bg-white/[0.02] transition-colors">
              {/* Market Question */}
              <div className="flex-1 text-sm text-foreground-muted font-medium">
                {market.question}
              </div>

              {/* Trade Buttons */}
              <div className="flex items-center gap-2">
                <button
                  onClick={() => onTrade(market)}
                  className="flex flex-col items-center justify-center rounded-lg bg-[#22c55e]/10 border border-[#22c55e]/20 hover:bg-[#22c55e]/20 px-4 py-1.5 min-w-[80px] transition-all"
                >
                  <span className="text-xs font-bold text-[#22c55e]">Yes</span>
                  <span className="text-[10px] text-[#22c55e]/80">{yesProb}%</span>
                </button>
                <button
                  onClick={() => onTrade(market)}
                  className="flex flex-col items-center justify-center rounded-lg bg-[#ef4444]/10 border border-[#ef4444]/20 hover:bg-[#ef4444]/20 px-4 py-1.5 min-w-[80px] transition-all"
                >
                  <span className="text-xs font-bold text-[#ef4444]">No</span>
                  <span className="text-[10px] text-[#ef4444]/80">{noProb}%</span>
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
