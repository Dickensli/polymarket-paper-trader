'use client';

import { useQuery } from '@tanstack/react-query';
import { useState, useMemo } from 'react';

export interface Market {
  id: string;
  eventId: string;
  question: string;
  conditionId: string;
  outcomes: string[];
  outcomePrices: number[];
  tokenIds: string[];
  volume24hr?: string;
  liquidity?: string;
  image?: string;
  icon?: string;
  category?: string;
  closed: boolean;
  endDate?: string;
}

export interface PolymarketEvent {
  id: string;
  ticker?: string;
  slug?: string;
  title: string;
  description?: string;
  startDate?: string;
  creationDate?: string;
  endDate?: string;
  image?: string;
  icon?: string;
  active: boolean;
  closed: boolean;
  category?: string;
  markets: Market[];
}

interface UseEventsReturn {
  events: PolymarketEvent[];
  isLoading: boolean;
  error: string | null;
  category: string;
  setCategory: (category: string) => void;
  searchQuery: string;
  setSearchQuery: (query: string) => void;
  refetch: () => void;
}

async function fetchEvents(category: string, search: string): Promise<PolymarketEvent[]> {
  const url = new URL('/api/events', window.location.origin);
  url.searchParams.set('limit', '50');
  if (category && category !== 'All') {
    url.searchParams.set('category', category);
  }
  if (search.trim()) {
    url.searchParams.set('search', search);
  }
  const res = await fetch(url.toString());
  if (!res.ok) throw new Error('Failed to fetch events');
  const json = await res.json();
  return json.data ?? [];
}

export function useEvents(): UseEventsReturn {
  const [category, setCategory] = useState('All');
  const [searchQuery, setSearchQuery] = useState('');

  const { data: events = [], isLoading, error, refetch } = useQuery({
    queryKey: ['events', category, searchQuery],
    queryFn: () => fetchEvents(category, searchQuery),
    staleTime: 60_000,
  });

  return {
    events,
    isLoading,
    error: error?.message ?? null,
    category,
    setCategory,
    searchQuery,
    setSearchQuery,
    refetch,
  };
}
