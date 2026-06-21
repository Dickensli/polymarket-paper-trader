'use client';

import { useQuery } from '@tanstack/react-query';

interface CategoryFilterProps {
  selected: string;
  onSelect: (category: string) => void;
}

async function fetchCategories(): Promise<string[]> {
  const res = await fetch('/api/categories');
  if (!res.ok) throw new Error('Failed to fetch categories');
  const json = await res.json();
  return json.data ?? ['All'];
}

export default function CategoryFilter({ selected, onSelect }: CategoryFilterProps) {
  const { data: categories = ['All'], isLoading } = useQuery({
    queryKey: ['categories'],
    queryFn: fetchCategories,
    staleTime: 5 * 60 * 1000, // 5 minutes
  });

  return (
    <div className="flex items-center gap-2 overflow-x-auto pb-1 scrollbar-none">
      {isLoading ? (
        // Loading skeletons for categories
        Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="shrink-0 rounded-xl px-4 py-2 bg-white/[0.03] animate-pulse w-20 h-9" />
        ))
      ) : (
        categories.map((cat) => {
          const active = selected === cat;
          return (
            <button
              key={cat}
              onClick={() => onSelect(cat)}
              className={`
                shrink-0 rounded-xl px-4 py-2 text-sm font-medium transition-all duration-200
                ${
                  active
                    ? 'bg-primary/15 text-primary-light border border-primary/30 shadow-[0_0_12px_rgba(59,130,246,0.15)]'
                    : 'bg-white/[0.03] text-foreground-muted border border-white/[0.06] hover:bg-white/[0.06] hover:text-foreground'
                }
              `}
            >
              {cat}
            </button>
          );
        })
      )}
    </div>
  );
}
