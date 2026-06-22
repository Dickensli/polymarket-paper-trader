'use client';

import { useState, useEffect, useCallback } from 'react';
import { useTrade } from '@/hooks/useTrade';
import type { Market } from '@/hooks/useMarkets';
import PriceBar from './PriceBar';
import LoadingSpinner from './LoadingSpinner';

interface TradeModalProps {
  market: Market & { midpoints?: { YES: number | null; NO: number | null } };
  onClose: () => void;
  onSuccess?: () => void;
}

export default function TradeModal({ market, onClose, onSuccess }: TradeModalProps) {
  const [outcome, setOutcome] = useState<'YES' | 'NO'>('YES');
  const [shares, setShares] = useState(10);
  const [showSuccess, setShowSuccess] = useState(false);
  const { executeTrade, isLoading, error } = useTrade();

  const yesPrice = market.midpoints?.YES ?? market.outcomePrices[0] ?? 0.5;
  const noPrice = market.midpoints?.NO ?? market.outcomePrices[1] ?? 0.5;
  const price = outcome === 'YES' ? yesPrice : noPrice;
  const cost = shares * price;
  const potentialPayout = shares;
  const potentialProfit = potentialPayout - cost;

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  const handleTrade = useCallback(async () => {
    const result = await executeTrade({
      marketId: market.id,
      marketQuestion: market.question,
      tokenId: outcome === 'YES' ? market.tokenIds[0] : market.tokenIds[1],
      outcome,
      shares,
      price,
    });
    if (result.success) {
      setShowSuccess(true);
      setTimeout(() => {
        onSuccess?.();
        onClose();
      }, 1500);
    }
  }, [executeTrade, market.id, outcome, shares, price, onSuccess, onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center animate-fade-in">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="relative w-full sm:max-w-md mx-auto sm:mx-4 animate-slide-up">
        <div className="glass-card border border-white/[0.08] bg-[#12131a]/95 backdrop-blur-xl rounded-t-2xl sm:rounded-2xl overflow-hidden">
          {/* Success overlay */}
          {showSuccess && (
            <div className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-[#12131a]/95 animate-fade-in">
              <div className="h-16 w-16 rounded-full bg-profit/20 flex items-center justify-center mb-4">
                <svg
                  className="h-8 w-8 text-profit-light"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2.5}
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <p className="text-lg font-semibold text-foreground">Trade Placed!</p>
              <p className="text-sm text-foreground-muted mt-1">
                {shares} shares of {outcome} @ {(price * 100).toFixed(1)}¢
              </p>
            </div>
          )}

          {/* Header */}
          <div className="flex items-start justify-between p-5 pb-4 border-b border-white/[0.06]">
            <div className="flex-1 min-w-0 pr-4">
              <p className="text-xs font-medium uppercase tracking-wider text-foreground-muted mb-1">
                Paper Trade
              </p>
              <p className="text-sm font-semibold text-foreground leading-snug line-clamp-2">
                {market.question}
              </p>
            </div>
            <button
              onClick={onClose}
              className="shrink-0 rounded-lg p-1.5 text-foreground-muted hover:text-foreground hover:bg-white/[0.06] transition-colors"
            >
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* Price bar */}
          <div className="px-5 pt-4">
            <PriceBar yesPrice={yesPrice} noPrice={noPrice} height="lg" />
          </div>

          {/* Body */}
          <div className="p-5 space-y-5">
            {/* Outcome toggle */}
            <div>
              <label className="text-xs font-medium text-foreground-muted mb-2 block">
                Outcome
              </label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={() => setOutcome('YES')}
                  className={`rounded-xl py-3 text-sm font-bold transition-all duration-200 border ${
                    outcome === 'YES'
                      ? 'bg-profit/15 text-profit-light border-profit/40 shadow-[0_0_16px_rgba(16,185,129,0.15)]'
                      : 'bg-white/[0.03] text-foreground-muted border-white/[0.06] hover:bg-white/[0.06]'
                  }`}
                >
                  YES — {(yesPrice * 100).toFixed(1)}¢
                </button>
                <button
                  onClick={() => setOutcome('NO')}
                  className={`rounded-xl py-3 text-sm font-bold transition-all duration-200 border ${
                    outcome === 'NO'
                      ? 'bg-loss/15 text-loss-light border-loss/40 shadow-[0_0_16px_rgba(244,63,94,0.15)]'
                      : 'bg-white/[0.03] text-foreground-muted border-white/[0.06] hover:bg-white/[0.06]'
                  }`}
                >
                  NO — {(noPrice * 100).toFixed(1)}¢
                </button>
              </div>
            </div>

            {/* Shares input */}
            <div>
              <label className="text-xs font-medium text-foreground-muted mb-2 block">
                Shares
              </label>
              <div className="flex items-center gap-3">
                <button
                  onClick={() => setShares(Math.max(1, shares - 10))}
                  className="rounded-lg bg-white/[0.04] border border-white/[0.06] px-3 py-2 text-foreground-muted hover:bg-white/[0.08] hover:text-foreground transition-colors"
                >
                  −
                </button>
                <input
                  type="number"
                  value={shares}
                  onChange={(e) => setShares(Math.max(1, parseInt(e.target.value) || 1))}
                  className="flex-1 rounded-xl border border-white/[0.06] bg-white/[0.03] px-4 py-2.5 text-center text-lg font-bold text-foreground outline-none focus:border-primary/40 focus:ring-1 focus:ring-primary/20 transition-all"
                />
                <button
                  onClick={() => setShares(shares + 10)}
                  className="rounded-lg bg-white/[0.04] border border-white/[0.06] px-3 py-2 text-foreground-muted hover:bg-white/[0.08] hover:text-foreground transition-colors"
                >
                  +
                </button>
              </div>
              <input
                type="range"
                min={1}
                max={500}
                value={shares}
                onChange={(e) => setShares(parseInt(e.target.value))}
                className="w-full mt-3"
              />
              <div className="flex justify-between text-[10px] text-foreground-muted mt-1">
                <span>1</span>
                <span>500</span>
              </div>
            </div>

            {/* Cost breakdown */}
            <div className="rounded-xl bg-white/[0.02] border border-white/[0.04] p-4 space-y-2.5">
              <div className="flex justify-between text-sm">
                <span className="text-foreground-muted">Price per share</span>
                <span className="text-foreground font-medium">
                  {(price * 100).toFixed(1)}¢
                </span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-foreground-muted">Total cost</span>
                <span className="text-foreground font-semibold">
                  ${cost.toFixed(2)}
                </span>
              </div>
              <div className="border-t border-white/[0.04] pt-2.5 flex justify-between text-sm">
                <span className="text-foreground-muted">Potential payout</span>
                <span className="text-profit-light font-bold">
                  ${potentialPayout.toFixed(2)}
                </span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-foreground-muted">Potential profit</span>
                <span className="text-profit-light font-bold">
                  +${potentialProfit.toFixed(2)}
                  <span className="text-xs ml-1">
                    ({((potentialProfit / cost) * 100).toFixed(0)}%)
                  </span>
                </span>
              </div>
            </div>

            {/* Error */}
            {error && (
              <div className="rounded-xl bg-loss/10 border border-loss/25 p-3 text-sm text-loss-light">
                {error}
              </div>
            )}

            {/* Submit */}
            <button
              onClick={handleTrade}
              disabled={isLoading}
              className={`w-full rounded-xl py-3.5 text-sm font-bold transition-all duration-200 active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed ${
                outcome === 'YES'
                  ? 'bg-gradient-to-r from-profit to-profit-light text-white shadow-[0_4px_20px_rgba(16,185,129,0.3)]'
                  : 'bg-gradient-to-r from-loss to-loss-light text-white shadow-[0_4px_20px_rgba(244,63,94,0.3)]'
              }`}
            >
              {isLoading ? (
                <LoadingSpinner size="sm" />
              ) : (
                `Buy ${shares} ${outcome} Shares — $${cost.toFixed(2)}`
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
