'use client';

import { useCallback, useEffect, useRef } from 'react';

import { useKeyboardShortcuts } from '@/components/providers/shortcuts-provider';
import {
  formatCanonicalPhone,
  formatPitchCopyText,
  getTelUrl,
  getWhatsAppUrl,
} from '@/lib/outreach';

import type { CleanListing } from '@/types/database';

/* ─── Types ──────────────────────────────────────────────────────────────── */

export type ToastTone = 'ok' | 'fail';

export type UseKeyboardNavigationOptions = {
  /** Current board page — the feed J/K step through. */
  feed: CleanListing[];
  /** Lead currently open in the inspector (null = nothing selected). */
  selected: CleanListing | null;
  /** Selection setter shared with board + drawer; null deselects (Esc). */
  onSelect: (listing: CleanListing | null) => void;
  /** Flips the board between card grid and compact table (V). */
  onToggleViewMode: () => void;
  /** Quick feedback channel for C/W/T — the caller renders the toast. */
  onToast: (message: string, tone: ToastTone) => void;
};

export type UseKeyboardNavigation = {
  /** Id of the lead under the inspector — pass-through of `selected`. */
  activeSelectedId: string | null;
  /** True while the `?` shortcuts overlay is up. */
  isShortcutsModalOpen: boolean;
  /** Toggles the shortcuts overlay (`?` key or explicit click). */
  toggleShortcutsModal: () => void;
};

/* ─── Guards ─────────────────────────────────────────────────────────────── */

/** True while typing in a field — global shortcuts must stay inert there. */
function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  return target.closest('input, textarea, select') !== null;
}

/** First canonical phone of a listing ('' when the row carries none). */
function primaryPhone(listing: CleanListing): string {
  const raw = listing.phone_numbers[0] ?? '';
  return raw !== '' ? formatCanonicalPhone(raw) : '';
}

/* ─── Hook ───────────────────────────────────────────────────────────────── */

/**
 * Global keyboard command layer for the CRM (Phase 5A). One `window`
 * keydown listener, attached for the component's lifetime, silent whenever
 * a modifier is held or focus sits inside a form field:
 *
 *   J / ↓  select next lead    K / ↑  select previous lead
 *   Esc    close shortcuts overlay, else deselect (drawer closes)
 *   C      copy outreach pitch        W  WhatsApp (new tab)
 *   T      tel: dialer                V  toggle grid ⇄ table
 *   ?      shortcuts overlay
 *
 * Stepping clamps at the feed ends (no wrap); with no active selection — or
 * a selection that fell out of the current page — J restarts at the first
 * lead and K at the last. All command payloads are read through a ref so the
 * listener binds exactly once per mount.
 */
export function useKeyboardNavigation({
  feed,
  selected,
  onSelect,
  onToggleViewMode,
  onToast,
}: UseKeyboardNavigationOptions): UseKeyboardNavigation {
  /* Overlay state is app-wide (ShortcutsProvider): the top-nav `[?]` badge
   * and the `?` key drive the same modal instance. */
  const { isShortcutsModalOpen, toggleShortcutsModal, closeShortcutsModal } = useKeyboardShortcuts();

  /* Latest render values behind stable callbacks — no listener re-binding. */
  const latest = useRef({ feed, selected, onSelect, onToggleViewMode, onToast, isShortcutsModalOpen });
  useEffect(() => {
    latest.current = { feed, selected, onSelect, onToggleViewMode, onToast, isShortcutsModalOpen };
  }, [feed, selected, onSelect, onToggleViewMode, onToast, isShortcutsModalOpen]);

  /* J/K — clamped step over the feed; restarts at the ends when the
   * selection is empty or no longer present (e.g. after a filter change). */
  const step = useCallback((delta: -1 | 1): void => {
    const { feed: rows, selected: current, onSelect: select } = latest.current;
    if (rows.length === 0) return;
    const currentIndex = current === null ? -1 : rows.findIndex((row) => row.id === current.id);
    const nextIndex = currentIndex === -1 ? (delta === 1 ? 0 : rows.length - 1) : currentIndex + delta;
    const clamped = Math.min(Math.max(nextIndex, 0), rows.length - 1);
    if (currentIndex !== -1 && clamped === currentIndex) return;
    const next = rows[clamped];
    select(next);
    document.querySelector(`[data-lead-id="${next.id}"]`)?.scrollIntoView({ block: 'nearest' });
  }, []);

  /* C — copy the canonical pitch text (same format as the card copy buttons). */
  const copyPitch = useCallback((): void => {
    const { selected: current, onToast: toast } = latest.current;
    if (current === null) return;
    void (async () => {
      let ok = false;
      try {
        await navigator.clipboard.writeText(formatPitchCopyText(current));
        ok = true;
      } catch {
        ok = false;
      }
      toast(ok ? 'Pitch copied' : 'Copy failed', ok ? 'ok' : 'fail');
    })();
  }, []);

  /* W — WhatsApp chat in a new tab; dead end when the lead has no phone. */
  const openWhatsApp = useCallback((): void => {
    const { selected: current, onToast: toast } = latest.current;
    if (current === null) return;
    const phone = primaryPhone(current);
    const url = phone !== '' ? getWhatsAppUrl(phone, current) : null;
    if (url === null) {
      toast('No phone on lead', 'fail');
      return;
    }
    window.open(url, '_blank', 'noopener,noreferrer');
    toast('WhatsApp opened', 'ok');
  }, []);

  /* T — hand the lead to the OS dialer via `tel:` navigation. */
  const dialLead = useCallback((): void => {
    const { selected: current, onToast: toast } = latest.current;
    if (current === null) return;
    const phone = primaryPhone(current);
    const url = phone !== '' ? getTelUrl(phone) : null;
    if (url === null) {
      toast('No phone on lead', 'fail');
      return;
    }
    window.location.href = url;
    toast('Dialing…', 'ok');
  }, []);

  const handleKeyDown = useCallback(
    (event: KeyboardEvent): void => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (isTypingTarget(event.target)) return;

      const key = event.key.toLowerCase();

      /* Overlay mode: only Esc / ? respond. */
      if (latest.current.isShortcutsModalOpen) {
        if (key === 'escape') closeShortcutsModal();
        else if (key === '?') toggleShortcutsModal();
        return;
      }

      switch (key) {
        case 'j':
        case 'arrowdown':
          event.preventDefault();
          step(1);
          break;
        case 'k':
        case 'arrowup':
          event.preventDefault();
          step(-1);
          break;
        case 'escape':
          latest.current.onSelect(null);
          break;
        case 'c':
          event.preventDefault();
          copyPitch();
          break;
        case 'w':
          event.preventDefault();
          openWhatsApp();
          break;
        case 't':
          event.preventDefault();
          dialLead();
          break;
        case 'v':
          event.preventDefault();
          latest.current.onToggleViewMode();
          break;
        case '?':
          event.preventDefault();
          toggleShortcutsModal();
          break;
        default:
          break;
      }
    },
    [step, copyPitch, openWhatsApp, dialLead, toggleShortcutsModal, closeShortcutsModal],
  );

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  return {
    activeSelectedId: selected !== null ? selected.id : null,
    isShortcutsModalOpen,
    toggleShortcutsModal,
  };
}

