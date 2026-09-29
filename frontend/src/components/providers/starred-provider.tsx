'use client';

import { createContext, useContext, type ReactNode } from 'react';

import { useStarredLeads, type UseStarredLeads } from '@/hooks/useStarredLeads';

const StarredContext = createContext<UseStarredLeads | null>(null);

/**
 * App-wide "working leads" bookmark state (Phase 8).
 *
 * The starred id set is read once per app load and shared through context so
 * the card cover, the compact table row, the inspector drawer and the
 * `/starred` route all read ONE source of truth — the presentational listings
 * components stay prop-free (`LeadBoard` never learns what a star is) and no
 * star prop is threaded through the board.
 *
 * Persistence is the `starred_listings` relation (`db/starred.ts`); the
 * context only owns the client-side set and the optimistic toggle.
 */
export function StarredProvider({ children }: { children: ReactNode }) {
  const starred = useStarredLeads();
  return <StarredContext.Provider value={starred}>{children}</StarredContext.Provider>;
}

/** Accessor for starred-lead state. Throws outside the provider. */
export function useStarred(): UseStarredLeads {
  const ctx = useContext(StarredContext);
  if (!ctx) {
    throw new Error('[starred] useStarred() must be used within <StarredProvider>');
  }
  return ctx;
}
