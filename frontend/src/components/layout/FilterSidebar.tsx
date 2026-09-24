'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { PanelLeftClose, PanelLeftOpen, RotateCcw, Search } from 'lucide-react';

import { useCurrency } from '@/components/providers/currency-provider';
import { useListingFilters } from '@/hooks/useListingFilters';
import { convertFromUsd, convertToUsd, currencySymbol } from '@/lib/currency';
import { BEDROOM_OPTIONS, DISTRICTS } from '@/lib/filters';
import { cn } from '@/lib/utils';

import type { Currency } from '@/lib/currency';
import type { DealFilter, SourceFilter } from '@/lib/filters';

const INPUT_CLASS =
  'w-full min-w-0 rounded-lg border border-line bg-slate-50 px-2 py-1.5 font-mono text-xs text-ink placeholder:text-muted/60 focus:border-accent focus:bg-panel focus:outline-none focus:ring-2 focus:ring-accent/20';

const SOURCE_OPTIONS: ReadonlyArray<{ value: SourceFilter; label: string }> = [
  { value: 'ALL', label: 'All' },
  { value: 'SS_GE', label: 'ss.ge' },
  { value: 'FACEBOOK', label: 'Facebook' },
];

const DEAL_OPTIONS: ReadonlyArray<{ value: DealFilter; label: string }> = [
  { value: 'ALL', label: 'All' },
  { value: 'RENT', label: 'Rent' },
  { value: 'SALE', label: 'Sale' },
  { value: 'GIRAO', label: 'Girao' },
];

function Segmented<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: ReadonlyArray<{ value: T; label: string; activeClass?: string }>;
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <div role="group" aria-label={label} className="flex gap-1 rounded-lg border border-line bg-panel p-0.5">
      {options.map((option) => {
        const active = value === option.value;
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(option.value)}
            className={cn(
              'flex-1 rounded-md px-1 py-1 font-mono text-[10px] font-bold uppercase tracking-[0.08em] transition-colors',
              active ? 'bg-accent-soft text-accent' : 'text-muted hover:text-ink',
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

function Section({ title, hint, children }: { title: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <section className="border-b border-line">
      <div className="flex items-center justify-between gap-2 px-4 py-2.5">
        <p className="font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-muted">{title}</p>
        {hint}
      </div>
      <div className="px-4 pb-3">{children}</div>
    </section>
  );
}

/**
 * Dual numeric input with local drafts. Drafts only resync when the
 * committed values or the sync key (e.g. display currency) actually
 * change — unrelated re-renders never wipe in-progress typing. Commits
 * happen on blur / Enter through `fromDisplay`.
 */
function DualRangeInput({
  syncKey,
  minValue,
  maxValue,
  toDisplay,
  fromDisplay,
  minPlaceholder,
  maxPlaceholder,
  prefix,
  onCommit,
}: {
  syncKey: string;
  minValue: number | null;
  maxValue: number | null;
  toDisplay: (value: number) => string;
  fromDisplay: (raw: string) => number | null;
  minPlaceholder: string;
  maxPlaceholder: string;
  prefix?: string;
  onCommit: (min: number | null, max: number | null) => void;
}) {
  const [minDraft, setMinDraft] = useState(() => (minValue === null ? '' : toDisplay(minValue)));
  const [maxDraft, setMaxDraft] = useState(() => (maxValue === null ? '' : toDisplay(maxValue)));
  const syncedRef = useRef(`${syncKey}|${minValue}|${maxValue}`);

  useEffect(() => {
    const signature = `${syncKey}|${minValue}|${maxValue}`;
    if (signature === syncedRef.current) return;
    syncedRef.current = signature;
    setMinDraft(minValue === null ? '' : toDisplay(minValue));
    setMaxDraft(maxValue === null ? '' : toDisplay(maxValue));
  }, [syncKey, minValue, maxValue, toDisplay]);

  const commit = () => onCommit(fromDisplay(minDraft), fromDisplay(maxDraft));

  return (
    <div className="flex items-center gap-1.5">
      <div className="relative min-w-0 flex-1">
        {prefix !== undefined && (
          <span
            aria-hidden
            className="pointer-events-none absolute left-1.5 top-1/2 -translate-y-1/2 font-mono text-xs text-muted"
          >
            {prefix}
          </span>
        )}
        <input
          type="number"
          min={0}
          inputMode="numeric"
          value={minDraft}
          onChange={(event) => setMinDraft(event.target.value)}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              commit();
              event.currentTarget.blur();
            }
          }}
          placeholder={minPlaceholder}
          aria-label={minPlaceholder}
          className={cn(INPUT_CLASS, prefix !== undefined && 'pl-5')}
        />
      </div>
      <span aria-hidden className="font-mono text-xs text-muted">
        –
      </span>
      <div className="min-w-0 flex-1">
        <input
          type="number"
          min={0}
          inputMode="numeric"
          value={maxDraft}
          onChange={(event) => setMaxDraft(event.target.value)}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              commit();
              event.currentTarget.blur();
            }
          }}
          placeholder={maxPlaceholder}
          aria-label={maxPlaceholder}
          className={INPUT_CLASS}
        />
      </div>
    </div>
  );
}

/**
 * 300px brutalist filter rail, collapsible to a 44px icon rail. Fully
 * URL-driven through `useListingFilters()` — every control writes to the
 * query string, so board state survives reloads and link sharing. Price
 * bounds render in the active currency but commit as canonical USD.
 */
export function FilterSidebar() {
  const {
    filters,
    activeCount,
    isSearching,
    setQ,
    flushSearch,
    toggleDistrict,
    setPriceRange,
    setAreaRange,
    setMinBedrooms,
    setSource,
    setDealType,
    resetAll,
  } = useListingFilters();
  const { currency } = useCurrency();
  const [collapsed, setCollapsed] = useState(false);

  /* Local draft mirrors the committed keyword so typing stays instant;
   * the hook throttles URL writes to 300ms. */
  const [searchDraft, setSearchDraft] = useState(filters.q);
  useEffect(() => {
    if (!isSearching) setSearchDraft(filters.q);
  }, [filters.q, isSearching]);

  const handleReset = () => {
    setSearchDraft('');
    resetAll();
  };

  if (collapsed) {
    return (
      <aside
        aria-label="Search and filters (collapsed)"
        className="sticky top-0 z-10 flex w-full shrink-0 items-center gap-2 border-b border-line bg-panel px-3 py-2 lg:h-fit lg:w-11 lg:flex-col lg:items-stretch lg:border-b-0 lg:border-r lg:py-3"
      >
        <button
          type="button"
          onClick={() => setCollapsed(false)}
          aria-label="Expand filters"
          title="Expand filters"
          className="flex items-center justify-center rounded-md border border-line p-1.5 text-muted transition-colors hover:text-ink"
        >
          <PanelLeftOpen className="size-4" aria-hidden />
        </button>
        <span className="font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-muted lg:self-center lg:[writing-mode:vertical-rl]">
          Filters
        </span>
        {activeCount > 0 && (
          <span className="rounded-full bg-accent px-1.5 font-mono text-[10px] font-black leading-4 text-white lg:mt-1 lg:self-center">
            {activeCount}
          </span>
        )}
      </aside>
    );
  }

  return (
    <aside
      aria-label="Search and filters"
      className="sticky top-0 z-10 flex max-h-dvh w-full shrink-0 flex-col border-b border-line bg-panel lg:h-fit lg:w-[300px] lg:border-b-0 lg:border-r"
    >
      {/* Header */}
      <div className="flex items-center justify-between gap-2 border-b border-line px-4 py-3">
        <p className="font-mono text-[11px] font-bold uppercase tracking-[0.18em]">Search & Filters</p>
        <span className="flex items-center gap-1.5">
          {activeCount > 0 && (
            <span
              aria-label={`${activeCount} active filters`}
              className="rounded-full bg-accent px-2 py-0.5 font-mono text-[10px] font-black text-white"
            >
              {activeCount}
            </span>
          )}
          <button
            type="button"
            onClick={handleReset}
            disabled={activeCount === 0}
            title="Reset all filters"
            className="flex items-center gap-1 rounded-md border border-line px-1.5 py-0.5 font-mono text-[10px] font-bold uppercase tracking-[0.1em] text-muted transition-colors hover:text-ink disabled:pointer-events-none disabled:opacity-40"
          >
            <RotateCcw className="size-3" aria-hidden />
            Reset All
          </button>
          <button
            type="button"
            onClick={() => setCollapsed(true)}
            aria-label="Collapse filters"
            title="Collapse filters"
            className="flex items-center rounded-md border border-line p-1 text-muted transition-colors hover:text-ink"
          >
            <PanelLeftClose className="size-3.5" aria-hidden />
          </button>
        </span>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {/* Keyword search */}
        <Section
          title="Keyword"
          hint={
            isSearching ? (
              <span className="font-mono text-[10px] text-accent" role="status">
                typing…
              </span>
            ) : undefined
          }
        >
          <div className="flex items-center rounded-lg border border-line bg-slate-50 focus-within:border-accent focus-within:bg-panel focus-within:ring-2 focus-within:ring-accent/20">
            <Search className="ml-2.5 size-3.5 shrink-0 text-muted" aria-hidden />
            <input
              type="text"
              value={searchDraft}
              onChange={(event) => {
                setSearchDraft(event.target.value);
                setQ(event.target.value);
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  flushSearch();
                  event.currentTarget.blur();
                }
              }}
              placeholder="District, street, desc, phone…"
              aria-label="Search listings"
              className="min-w-0 flex-1 bg-transparent px-2 py-1.5 font-mono text-xs text-ink placeholder:text-muted/60 focus:outline-none"
            />
            {searchDraft !== '' && (
              <button
                type="button"
                onClick={() => {
                  setSearchDraft('');
                  setQ('');
                  flushSearch();
                }}
                aria-label="Clear search"
                title="Clear search"
                className="px-2 font-mono text-sm leading-none text-muted transition-colors hover:text-alert"
              >
                ×
              </button>
            )}
          </div>
        </Section>

        {/* Source */}
        <Section title="Source">
          <Segmented label="Source" options={SOURCE_OPTIONS} value={filters.source} onChange={setSource} />
        </Section>

        {/* Deal type */}
        <Section title="Deal type">
          <Segmented label="Deal type" options={DEAL_OPTIONS} value={filters.dealType} onChange={setDealType} />
        </Section>

        {/* Price — canonical USD in the URL, active currency on screen */}
        <Section
          title="Price"
          hint={
            <span className="font-mono text-[10px] font-bold text-ink">
              {currencySymbol(currency)} {currency}
            </span>
          }
        >
          <DualRangeInput
            syncKey={currency}
            minValue={filters.minPrice}
            maxValue={filters.maxPrice}
            toDisplay={(usd) => String(Math.round(convertFromUsd(usd, currency)))}
            fromDisplay={(raw) => {
              const trimmed = raw.trim();
              if (trimmed === '') return null;
              const n = Number(trimmed);
              if (!Number.isFinite(n) || n < 0) return null;
              return convertToUsd(n, currency);
            }}
            minPlaceholder="min"
            maxPlaceholder="max"
            prefix={currencySymbol(currency)}
            onCommit={setPriceRange}
          />
        </Section>

        {/* Bedrooms */}
        <Section title="Bedrooms">
          <div role="group" aria-label="Minimum bedrooms" className="flex gap-1 rounded-lg border border-line bg-panel p-0.5">
            {BEDROOM_OPTIONS.map((option) => {
              const active = filters.minBedrooms === option.value;
              return (
                <button
                  key={option.label}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setMinBedrooms(option.value)}
                  className={cn(
                    'flex-1 rounded-md px-1 py-1 font-mono text-[10px] font-bold uppercase tracking-[0.08em] transition-colors',
                    active ? 'bg-accent-soft text-accent' : 'text-muted hover:text-ink',
                  )}
                >
                  {option.label}
                </button>
              );
            })}
          </div>
        </Section>

        {/* Area */}
        <Section title="Area" hint={<span className="font-mono text-[10px] text-muted">m²</span>}>
          <DualRangeInput
            syncKey="sqm"
            minValue={filters.minArea}
            maxValue={filters.maxArea}
            toDisplay={(value) => String(value)}
            fromDisplay={(raw) => {
              const trimmed = raw.trim();
              if (trimmed === '') return null;
              const n = Number(trimmed);
              if (!Number.isFinite(n) || n < 0) return null;
              return Math.round(n);
            }}
            minPlaceholder="min m²"
            maxPlaceholder="max m²"
            onCommit={setAreaRange}
          />
        </Section>

        {/* Districts */}
        <Section
          title="Districts"
          hint={
            <span className="font-mono text-[10px] text-muted">
              {filters.districts.length}/{DISTRICTS.length}
            </span>
          }
        >
          <div className="grid grid-cols-2 gap-1">
            {DISTRICTS.map((district) => {
              const active = filters.districts.includes(district.slug);
              return (
                <button
                  key={district.slug}
                  type="button"
                  aria-pressed={active}
                  onClick={() => toggleDistrict(district.slug)}
                  className={cn(
                    'rounded-md px-2 py-1.5 text-left font-mono text-[10px] font-bold uppercase tracking-[0.06em] transition-colors',
                    active
                      ? 'bg-accent-soft text-accent'
                      : 'border border-line bg-panel text-muted hover:text-ink',
                  )}
                >
                  {district.label}
                </button>
              );
            })}
          </div>
        </Section>
      </div>
    </aside>
  );
}

