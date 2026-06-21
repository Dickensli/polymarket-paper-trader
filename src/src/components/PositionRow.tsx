'use client';

import type { Position } from '@/hooks/usePortfolio';

interface PositionRowProps {
  position: Position;
  onClose: (positionId: string) => void;
}

export default function PositionRow({ position, onClose }: PositionRowProps) {
  const pnlPositive = position.unrealizedPnL >= 0;

  return (
    <div className="glass-card p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center gap-4 transition-all duration-200 hover:bg-white/[0.04]">
      {/* Market + outcome */}
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-foreground truncate">
          {position.marketQuestion}
        </p>
        <div className="flex items-center gap-2 mt-1.5">
          <span
            className={`inline-flex items-center rounded-md px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide ${
              position.outcome === 'YES'
                ? 'bg-profit/15 text-profit-light border border-profit/25'
                : 'bg-loss/15 text-loss-light border border-loss/25'
            }`}
          >
            {position.outcome}
          </span>
          <span className="text-xs text-foreground-muted">
            {position.shares} shares @ {(position.avgEntryPrice * 100).toFixed(1)}¢
          </span>
        </div>
      </div>

      {/* Price info */}
      <div className="flex items-center gap-6 sm:gap-8">
        <div className="text-right">
          <p className="text-xs text-foreground-muted mb-0.5">Current</p>
          <p className="text-sm font-semibold text-foreground">
            {(position.currentPrice * 100).toFixed(1)}¢
          </p>
        </div>

        <div className="text-right min-w-[80px]">
          <p className="text-xs text-foreground-muted mb-0.5">P&L</p>
          <p
            className={`text-sm font-bold ${
              pnlPositive ? 'text-profit-light' : 'text-loss-light'
            }`}
          >
            {pnlPositive ? '+' : ''}${position.unrealizedPnL.toFixed(2)}
            <span className="text-xs font-medium ml-1">
              ({pnlPositive ? '+' : ''}{position.unrealizedPnLPercent.toFixed(1)}%)
            </span>
          </p>
        </div>

        <button
          onClick={() => onClose(position.id)}
          className="rounded-xl border border-loss/25 bg-loss/10 px-3.5 py-2 text-xs font-semibold text-loss-light transition-all duration-200 hover:bg-loss/20 hover:border-loss/40 active:scale-95"
        >
          Close
        </button>
      </div>
    </div>
  );
}
