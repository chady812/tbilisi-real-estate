'use client';

import { useCurrency } from '@/components/providers/currency-provider';
import { USD_TO_GEL_RATE, type Currency } from '@/lib/currency';
import { cn } from '@/lib/utils';

const OPTIONS: ReadonlyArray<{ value: Currency; label: string; symbol: string }> = [
  { value: 'USD', label: 'USD', symbol: '$' },
  { value: 'GEL', label: 'GEL', symbol: '₾' },
];

/**
 * Central header toggle switching every price surface between USD and GEL
 * (1 USD = 2.6 GEL, standard market rate). Segmented control: the active
 * side is accent-tinted; tapping flips the whole board via `useCurrency()`.
 */
export function CurrencyToggle() {
  const { currency, setCurrency } = useCurrency();

  return (
    <div
      role="group"
      aria-label="Display currency"
      title={`1 USD = ${USD_TO_GEL_RATE.toFixed(2)} GEL · standard market rate`}
      className="flex rounded-lg border border-line bg-panel"
    >
      {OPTIONS.map(({ value, label, symbol }) => {
        const active = currency === value;
        return (
          <button
            key={value}
            type="button"
            onClick={() => setCurrency(value)}
            aria-pressed={active}
            className={cn(
              'rounded-md px-2 py-1 text-[11px] font-bold uppercase tracking-[0.12em] transition-colors',
              active ? 'bg-accent-soft text-accent' : 'text-muted hover:text-ink',
            )}
          >
            <span aria-hidden className="mr-1">
              {symbol}
            </span>
            {label}
          </button>
        );
      })}
    </div>
  );
}
