import { useEffect, useRef, useState } from 'react';
import type { CSSProperties, KeyboardEvent, ReactNode, RefObject } from 'react';

/*
 * Shared building blocks for the Oracle's browse pages (Monsters, Spells,
 * Magic Items, World Assets). Every page has the same structure, so a screen
 * reader user learns it once:
 *
 *   search landmark:  "Search <Kind>" text field, then a "Filters" button
 *                     (its name says how many filters are active)
 *   heading "Results" (h3 by default)
 *   status line:      "<n> <kind> found." (polite live region)
 *   list:             one button per result, named "Name, detail, detail",
 *                     RESULTS_PAGE_SIZE per page; the heading names the page
 *                     ("Results, page 2 of 5") and Previous page / Next page
 *                     buttons sit above and below the list
 *
 * A result button opens a details dialog (OracleDialog) whose heading takes
 * focus; Escape or Close returns focus to the result button. The Filters
 * button opens OracleFiltersDialog: one collapsed <details> per filter group
 * holding a checkbox fieldset, then "Apply Filters". Filters differ per page,
 * the structure does not.
 */

const FOCUSABLE = 'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), summary, [tabindex]:not([tabindex="-1"])';

/** id of the heading inside every browse page's details dialog. */
export const DETAILS_TITLE_ID = 'details-title';

const panelStyle: CSSProperties = {
  backgroundColor: 'white', color: 'black', padding: '2rem', borderRadius: '8px',
  width: '90%', maxHeight: '90vh', overflowY: 'auto',
};

interface OracleDialogProps {
  /** id of the dialog's heading, which also gets focus first in the Tab loop. */
  labelledBy: string;
  onClose: () => void;
  maxWidth?: string;
  children: ReactNode;
}

/** Modal dialog for a browse page: Escape closes, Tab and Shift+Tab loop from the heading to the last control. */
export function OracleDialog({ labelledBy, onClose, maxWidth = '800px', children }: OracleDialogProps) {
  const contentRef = useRef<HTMLDivElement>(null);

  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      onClose();
      return;
    }
    if (e.key !== 'Tab' || !contentRef.current) return;
    const heading = document.getElementById(labelledBy);
    const controls = Array.from(contentRef.current.querySelectorAll<HTMLElement>(FOCUSABLE))
      .filter((el) => el.getClientRects().length > 0);
    const focusable = heading ? [heading, ...controls] : controls;
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (e.shiftKey && heading && document.activeElement === controls[0]) {
      // The heading has tabindex="-1", so native Shift+Tab would skip it.
      e.preventDefault();
      heading.focus();
    } else if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };

  return (
    <div
      className="modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby={labelledBy}
      onKeyDown={handleKeyDown}
      style={{
        position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
        backgroundColor: 'rgba(0,0,0,0.5)', display: 'flex',
        alignItems: 'center', justifyContent: 'center', zIndex: 10000,
      }}
    >
      <div className="modal-content" ref={contentRef} style={{ ...panelStyle, maxWidth }}>
        {children}
      </div>
    </div>
  );
}

/** Heading for a details dialog whose content has no heading of its own; takes focus when shown. */
export function OracleDetailsHeading({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLHeadingElement>(null);
  useEffect(() => { ref.current?.focus(); }, []);
  return (
    <h3 id={DETAILS_TITLE_ID} ref={ref} tabIndex={-1} style={{ marginTop: 0, outline: 'none' }}>
      {children}
    </h3>
  );
}

/** The details dialog's closing row: optional extra actions, then Close. */
export function OracleDialogActions({ onClose, children }: { onClose: () => void; children?: ReactNode }) {
  return (
    <div style={{ marginTop: '1.5rem', display: 'flex', gap: '1rem' }}>
      {children}
      <button type="button" onClick={onClose} style={{ flex: 1, padding: '0.75rem', fontWeight: 'bold' }}>
        Close
      </button>
    </div>
  );
}

interface OracleSearchBarProps {
  /** id of the text field, e.g. "spell-search". */
  id: string;
  /** Visible label, e.g. "Search Spells". */
  label: string;
  value: string;
  onChange: (value: string) => void;
  inputRef?: RefObject<HTMLInputElement | null>;
  activeFilterCount: number;
  onOpenFilters: (trigger: HTMLButtonElement) => void;
}

/** The search landmark: one labelled text field and the Filters button. */
export function OracleSearchBar({ id, label, value, onChange, inputRef, activeFilterCount, onOpenFilters }: OracleSearchBarProps) {
  return (
    <form role="search" onSubmit={(e) => e.preventDefault()} className="oracle-search-bar">
      <div style={{ flexGrow: 1 }}>
        <label htmlFor={id} style={{ display: 'block', fontWeight: 'bold', marginBottom: '0.25rem' }}>{label}</label>
        <input
          id={id}
          ref={inputRef}
          type="text"
          autoComplete="off"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          style={{ width: '100%', padding: '0.5rem' }}
        />
      </div>
      <button type="button" onClick={(e) => onOpenFilters(e.currentTarget)} style={{ padding: '0.5rem 1rem' }}>
        Filters{activeFilterCount > 0 ? ` (${activeFilterCount} active)` : ''}
      </button>
    </form>
  );
}

/** Results per page on every browse page. */
export const RESULTS_PAGE_SIZE = 100;

interface OracleResultsProps<T> {
  /** [singular, plural], e.g. ['spell', 'spells']. */
  noun: [string, string];
  /** Every matching result. Pass a memoized array: a new array (a new search or filter) returns to page 1. */
  items: T[];
  /** Renders one result, an OracleResultItem. */
  renderItem: (item: T) => ReactNode;
  headingLevel?: 3 | 4;
}

/**
 * The "Results" heading, the live count, one page of the result list, and
 * the page buttons. With more than one page the heading says which page is
 * shown ("Results, page 2 of 5"); Previous page and Next page sit both
 * above the list (after the count) and below it, rendered only when there is
 * a page to go to, and move focus to the heading. The count line only changes when the matches do, so turning a
 * page is announced once, by the focused heading.
 */
export function OracleResults<T>({ noun, items, renderItem, headingLevel = 3 }: OracleResultsProps<T>) {
  const [page, setPage] = useState(0);
  const [pageItems, setPageItems] = useState(items);
  if (items !== pageItems) {
    setPageItems(items);
    setPage(0);
  }
  const headingRef = useRef<HTMLHeadingElement>(null);
  const focusHeadingRef = useRef(false);
  useEffect(() => {
    if (focusHeadingRef.current) {
      focusHeadingRef.current = false;
      headingRef.current?.focus();
    }
  }, [page]);

  const found = items.length;
  const pageCount = Math.max(1, Math.ceil(found / RESULTS_PAGE_SIZE));
  const current = Math.min(page, pageCount - 1);
  const shown = items.slice(current * RESULTS_PAGE_SIZE, (current + 1) * RESULTS_PAGE_SIZE);
  const goTo = (next: number) => {
    focusHeadingRef.current = true;
    setPage(next);
  };

  // Rendered both above and below the list.
  const pager = pageCount > 1 && (
    <div className="oracle-pager">
      {current > 0 && <button type="button" onClick={() => goTo(current - 1)}>Previous page</button>}
      {current < pageCount - 1 && <button type="button" onClick={() => goTo(current + 1)}>Next page</button>}
    </div>
  );

  const Heading = headingLevel === 3 ? 'h3' : 'h4';
  const count = found === 0 ? `No ${noun[1]} found.` : `${found} ${found === 1 ? noun[0] : noun[1]} found.`;
  return (
    <>
      <Heading ref={headingRef} tabIndex={-1} style={{ margin: '0 0 0.25rem', outline: 'none' }}>
        {pageCount > 1 ? `Results, page ${current + 1} of ${pageCount}` : 'Results'}
      </Heading>
      <p role="status" aria-live="polite" style={{ margin: '0 0 0.75rem' }}>{count}</p>
      {pager}
      {/* Keyed by page so a new page starts scrolled to the top. */}
      {found > 0 && <ul key={current} className="oracle-results">{shown.map(renderItem)}</ul>}
      {pager}
    </>
  );
}

interface OracleResultItemProps {
  name: string;
  /** Short facts read after the name, e.g. ['Level 3', 'Evocation', 'PHB']. Empty entries are skipped. */
  details: (string | undefined | null | false)[];
  onOpen: (trigger: HTMLButtonElement) => void;
}

/** One result: a single button named "Name, detail, detail". */
export function OracleResultItem({ name, details, onOpen }: OracleResultItemProps) {
  const text = details.filter(Boolean).join(', ');
  return (
    <li>
      <button type="button" className="oracle-result" onClick={(e) => onOpen(e.currentTarget)}>
        <strong className="oracle-result-name">{name}</strong>
        {text && <span className="sr-only">, </span>}
        {text && <span className="oracle-result-details">{text}</span>}
      </button>
    </li>
  );
}

export interface OracleFilterGroup {
  key: string;
  legend: string;
  options: { value: string; label: string }[];
  selected: string[];
}

interface OracleFiltersDialogProps {
  /** e.g. "Filter Spells". */
  title: string;
  groups: OracleFilterGroup[];
  onToggle: (groupKey: string, value: string) => void;
  onClose: () => void;
}

/** The Filters dialog: one collapsed group per filter, each a checkbox fieldset, then Apply Filters. */
export function OracleFiltersDialog({ title, groups, onToggle, onClose }: OracleFiltersDialogProps) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => { headingRef.current?.focus(); }, []);

  return (
    <OracleDialog labelledBy="filters-title" onClose={onClose} maxWidth="600px">
      <h3 id="filters-title" ref={headingRef} tabIndex={-1} style={{ marginTop: 0, outline: 'none' }}>{title}</h3>
      <form onSubmit={(e) => { e.preventDefault(); onClose(); }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', marginTop: '1rem' }}>
          {groups.map((group) => (
            <details key={group.key}>
              <summary style={{ fontWeight: 'bold', cursor: 'pointer', padding: '0.5rem', backgroundColor: '#f5f5f5' }}>
                {group.legend}{group.selected.length > 0 ? ` (${group.selected.length} selected)` : ''}
              </summary>
              <fieldset style={{ border: 'none', padding: '0.5rem 0 0 0', margin: 0, display: 'flex', flexDirection: 'column', gap: '0.5rem', maxHeight: '200px', overflowY: 'auto' }}>
                <legend className="sr-only">{group.legend}</legend>
                {group.options.map((option) => (
                  <label key={option.value} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <input
                      type="checkbox"
                      checked={group.selected.includes(option.value)}
                      onChange={() => onToggle(group.key, option.value)}
                    />
                    {option.label}
                  </label>
                ))}
              </fieldset>
            </details>
          ))}
        </div>
        <div style={{ marginTop: '1.5rem', display: 'flex', justifyContent: 'flex-end' }}>
          <button type="submit" style={{ padding: '0.75rem 1.5rem', fontWeight: 'bold' }}>Apply Filters</button>
        </div>
      </form>
    </OracleDialog>
  );
}
