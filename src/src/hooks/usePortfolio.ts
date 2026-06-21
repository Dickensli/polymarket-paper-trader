'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';

export interface Position {
  id: string;
  marketId: string;
  marketQuestion: string;
  outcome: string;
  shares: number;
  avgEntryPrice: number;
  currentPrice: number;
  unrealizedPnL: number;
  unrealizedPnLPercent: number;
  createdAt: string;
}

export interface Trade {
  id: string;
  marketId: string;
  marketQuestion: string;
  outcome: string;
  side: 'BUY' | 'SELL';
  shares: number;
  price: number;
  total: number;
  timestamp: string;
}

export interface Portfolio {
  balance: number;
  totalValue: number;
  totalPnL: number;
  totalPnLPercent: number;
  positions: Position[];
  tradeHistory: Trade[];
}

interface UsePortfolioReturn {
  portfolio: Portfolio | null;
  isLoading: boolean;
  error: string | null;
  refetch: () => void;
  resetPortfolio: () => Promise<void>;
  closePosition: (positionId: string) => Promise<void>;
}

async function fetchPortfolio(): Promise<Portfolio> {
  const res = await fetch('/api/portfolio');
  if (!res.ok) throw new Error('Failed to fetch portfolio');
  const json = await res.json();
  return json.data ?? json;
}

export function usePortfolio(): UsePortfolioReturn {
  const queryClient = useQueryClient();

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['portfolio'],
    queryFn: fetchPortfolio,
    staleTime: 5_000,
    refetchInterval: 15_000,
  });

  const resetMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/portfolio', { method: 'DELETE' });
      if (!res.ok) throw new Error('Failed to reset portfolio');
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['portfolio'] });
    },
  });

  const closeMutation = useMutation({
    mutationFn: async (positionId: string) => {
      const res = await fetch('/api/trade', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ closePositionId: positionId }),
      });
      if (!res.ok) throw new Error('Failed to close position');
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['portfolio'] });
    },
  });

  const resetPortfolio = useCallback(async () => {
    await resetMutation.mutateAsync();
  }, [resetMutation]);

  const closePosition = useCallback(
    async (positionId: string) => {
      await closeMutation.mutateAsync(positionId);
    },
    [closeMutation],
  );

  return {
    portfolio: data ?? null,
    isLoading,
    error: error?.message ?? null,
    refetch,
    resetPortfolio,
    closePosition,
  };
}
