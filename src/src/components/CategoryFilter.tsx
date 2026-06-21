'use client';

const CATEGORIES = [
  'All',
  'Politics',
  'Sports',
  'Crypto',
  'Culture',
  'Science',
  'Economics',
  'Tech',
];

interface CategoryFilterProps {
  selected: string;
  onSelect: (category: string) => void;
}

export default function CategoryFilter({ selected, onSelect }: CategoryFilterProps) {
  return (
    <div className="flex items-center gap-2 overflow-x-auto pb-1 scrollbar-none">
      {CATEGORIES.map((cat) => {
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
      })}
    </div>
  );
}
