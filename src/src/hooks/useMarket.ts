'use client';

import { useQuery } from '@tanstack/react-query';
import type { Market } from './useMarkets';

interface MarketDetail extends Market {
  midpoints?: { YES: number | null; NO: number | null };
  orderBook?: unknown;
}

interface UseMarketReturn {
  market: MarketDetail | null;
  isLoading: boolean;
  error: string | null;
  refetch: () => void;
}

async function fetchMarket(id: string): Promise<MarketDetail> {
  const res = await fetch(`/api/markets/${id}`);
  if (!res.ok) throw new Error('Failed to fetch market');
  const json = await res.json();
  return json.data ?? json;
}

export function useMarket(id: string): UseMarketReturn {
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['market', id],
    queryFn: () => fetchMarket(id),
    enabled: !!id,
    staleTime: 30_000,
    // [Performance Note] Increased refetch interval from 10s to 60s to limit 
    // excessive network calls from the client, saving Vercel fluid CPU.
    refetchInterval: 60_000,
  });

  return {
    market: data ?? null,
    isLoading,
    error: error?.message ?? null,
    refetch,
  };
}
