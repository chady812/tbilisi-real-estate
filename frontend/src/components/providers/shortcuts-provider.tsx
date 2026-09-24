'use client';

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';

import { KeyboardShortcutsModal } from '@/components/layout/KeyboardShortcutsModal';

type ShortcutsContextValue = {
  /** True while the `?` keyboard-commands overlay is up. */
  isShortcutsModalOpen: boolean;
  /** Toggles the overlay — the `[?] SHORTCUTS` badge and the `?` key share it. */
  toggleShortcutsModal: () => void;
  /** Closes the overlay (global Esc / scrim / ✕). */
  closeShortcutsModal: () => void;
};

const ShortcutsContext = createContext<ShortcutsContextValue | null>(null);

/**
 * App-wide keyboard-shortcuts overlay state (Phase 5B). The `?` key lives in
 * `useKeyboardNavigation`, but the `[?] SHORTCUTS` badge sits in the server-
 * rendered top-nav zone — a client context lets both surfaces drive one modal
 * instance without prop drilling across the server/client boundary.
 */
export function ShortcutsProvider({ children }: { children: ReactNode }) {
  const [isShortcutsModalOpen, setIsShortcutsModalOpen] = useState(false);
  const toggleShortcutsModal = useCallback(() => setIsShortcutsModalOpen((open) => !open), []);
  const closeShortcutsModal = useCallback(() => setIsShortcutsModalOpen(false), []);

  const value = useMemo(
    () => ({ isShortcutsModalOpen, toggleShortcutsModal, closeShortcutsModal }),
    [isShortcutsModalOpen, toggleShortcutsModal, closeShortcutsModal],
  );

  return (
    <ShortcutsContext.Provider value={value}>
      {children}
      {isShortcutsModalOpen && <KeyboardShortcutsModal open onClose={closeShortcutsModal} />}
    </ShortcutsContext.Provider>
  );
}

/** Accessor for shortcuts-overlay state. Throws outside the provider. */
export function useKeyboardShortcuts(): ShortcutsContextValue {
  const ctx = useContext(ShortcutsContext);
  if (!ctx) {
    throw new Error('[shortcuts] useKeyboardShortcuts() must be used within <ShortcutsProvider>');
  }
  return ctx;
}
