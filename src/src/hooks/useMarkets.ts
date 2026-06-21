'use client';

import { useQuery } from '@tanstack/react-query';
import { useState, useMemo } from 'react';

export interface Market {
  id: string;
  question: string;
  conditionId: string;
  outcomes: string[];
  outcomePrices: number[];
  tokenIds: string[];
  volume24hr: number;
  liquidity: number;
  lastTradePrice: number;
  bestBid: number;
  bestAsk: number;
  spread: number;
  image: string;
  icon: string;
  category: string;
  endDate: string;
  closed: boolean;
  // Additional fields from API
  description?: string;
}

interface UseMarketsReturn {
  markets: Market[];
  filteredMarkets: Market[];
  isLoading: boolean;
  error: string | null;
  category: string;
  setCategory: (category: string) => void;
  searchQuery: string;
  setSearchQuery: (query: string) => void;
  sortBy: 'volume' | 'newest' | 'trending';
  setSortBy: (sort: 'volume' | 'newest' | 'trending') => void;
  refetch: () => void;
}

async function fetchMarkets(category: string, search: string): Promise<Market[]> {
  const url = new URL('/api/markets', window.location.origin);
  url.searchParams.set('limit', '100');
  if (category && category !== 'All') {
    url.searchParams.set('category', category);
  }
  if (search.trim()) {
    url.searchParams.set('search', search);
  }
  const res = await fetch(url.toString());
  if (!res.ok) throw new Error('Failed to fetch markets');
  const json = await res.json();
  return json.data ?? [];
}

export function useMarkets(): UseMarketsReturn {
  const [category, setCategory] = useState('All');
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState<'volume' | 'newest' | 'trending'>('volume');

  const { data: markets = [], isLoading, error, refetch } = useQuery({
    queryKey: ['markets', category, searchQuery],
    queryFn: () => fetchMarkets(category, searchQuery),
    staleTime: 15_000,
    refetchInterval: 30_000,
  });

  const filteredMarkets = useMemo(() => {
    let result = [...markets];

    switch (sortBy) {
      case 'volume':
        result.sort((a, b) => b.volume24hr - a.volume24hr);
        break;
      case 'newest':
        result.sort((a, b) => new Date(b.endDate).getTime() - new Date(a.endDate).getTime());
        break;
      case 'trending':
        result.sort((a, b) => b.liquidity - a.liquidity);
        break;
    }

    return result;
  }, [markets, sortBy]);

  return {
    markets,
    filteredMarkets,
    isLoading,
    error: error?.message ?? null,
    category,
    setCategory,
    searchQuery,
    setSearchQuery,
    sortBy,
    setSortBy,
    refetch,
  };
}
