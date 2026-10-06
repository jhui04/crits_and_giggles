import { useEffect, useRef } from 'react';
import type { RefObject } from 'react';

// Helpers for the Oracle browse pages (see src/components/OracleBrowserParts.tsx).

/** Wraps plain strings as filter options whose label is the value. */
export const asOptions = (values: string[]) => values.map((value) => ({ value, label: value }));

/** Toggles `value` in a list. */
export const toggleIn = (list: string[], value: string) =>
  list.includes(value) ? list.filter((v) => v !== value) : [...list, value];

/**
 * Focuses a page's search field once its data has loaded, unless a dialog
 * opened first. `enabled` is the page's autoFocus prop.
 */
export function useInitialSearchFocus(enabled: boolean, ready: boolean, inputRef: RefObject<HTMLInputElement | null>, isDialogOpen: () => boolean) {
  const isDialogOpenRef = useRef(isDialogOpen);
  useEffect(() => { isDialogOpenRef.current = isDialogOpen; });
  useEffect(() => {
    if (!enabled || !ready) return;
    const timer = setTimeout(() => {
      if (!isDialogOpenRef.current()) inputRef.current?.focus();
    }, 50);
    return () => clearTimeout(timer);
  }, [enabled, ready, inputRef]);
}
