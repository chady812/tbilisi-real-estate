'use client';

import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';

import type { Currency } from '@/lib/currency';

type CurrencyContextValue = {
  currency: Currency;
  setCurrency: (currency: Currency) => void;
};

const CurrencyContext = createContext<CurrencyContextValue | null>(null);

/**
 * App-wide display-currency state (default USD — the pipeline's canonical
 * storage unit). Every price surface reads this through `useCurrency()`
 * so the header toggle flips the whole board without refetching.
 */
export function CurrencyProvider({ children }: { children: ReactNode }) {
  const [currency, setCurrency] = useState<Currency>('USD');
  const value = useMemo(() => ({ currency, setCurrency }), [currency]);
  return <CurrencyContext.Provider value={value}>{children}</CurrencyContext.Provider>;
}

/** Accessor for the active display currency. Throws outside the provider. */
export function useCurrency(): CurrencyContextValue {
  const ctx = useContext(CurrencyContext);
  if (!ctx) {
    throw new Error('[currency] useCurrency() must be used within <CurrencyProvider>');
  }
  return ctx;
}
