'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState, useCallback } from 'react';

interface TradeRequest {
  marketId: string;
  marketQuestion?: string;
  tokenId: string;
  outcome: 'YES' | 'NO';
  shares: number;
  price: number;
}

interface TradeResult {
  success: boolean;
  trade?: {
    id: string;
    marketId: string;
    outcome: string;
    side: string;
    shares: number;
    price: number;
    total: number;
    timestamp: string;
  };
  error?: string;
}

interface UseTradeReturn {
  executeTrade: (req: TradeRequest) => Promise<TradeResult>;
  isLoading: boolean;
  error: string | null;
  lastTrade: TradeResult | null;
}

export function useTrade(): UseTradeReturn {
  const queryClient = useQueryClient();
  const [lastTrade, setLastTrade] = useState<TradeResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: async (req: TradeRequest) => {
      const res = await fetch('/api/trade', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...req, side: 'BUY' }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Trade failed');
      return data.data ?? data;
    },
    onSuccess: (trade) => {
      const result: TradeResult = { success: true, trade };
      setLastTrade(result);
      setError(null);
      // Invalidate portfolio and markets to reflect the trade
      queryClient.invalidateQueries({ queryKey: ['portfolio'] });
    },
    onError: (err) => {
      const errMsg = err instanceof Error ? err.message : 'Unknown error';
      setError(errMsg);
      const result: TradeResult = { success: false, error: errMsg };
      setLastTrade(result);
    },
  });

  const executeTrade = useCallback(
    async (req: TradeRequest): Promise<TradeResult> => {
      try {
        const trade = await mutation.mutateAsync(req);
        return { success: true, trade };
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : 'Unknown error';
        return { success: false, error: errMsg };
      }
    },
    [mutation],
  );

  return {
    executeTrade,
    isLoading: mutation.isPending,
    error,
    lastTrade,
  };
}
