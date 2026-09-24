import { useCallback, useEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';

const INTERACTIVE_SELECTOR =
  'button,a,summary,[role=button],[role=link],[role=switch],[role=checkbox],[role=menuitem],input,textarea,select,[contenteditable],td,th';

/**
 * True when a keydown target is (or sits inside) a natively keyboard-operable
 * element. Window-level handlers must NOT preventDefault Enter/Space for these,
 * otherwise <details><summary>, links and custom buttons stop working.
 */
export function isInteractiveTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  return target.closest(INTERACTIVE_SELECTOR) !== null;
}

/** True when any of alt/ctrl/meta is held (single-letter shortcuts must ignore these). */
export function hasCommandModifier(e: { altKey: boolean; ctrlKey: boolean; metaKey: boolean }): boolean {
  return e.altKey || e.ctrlKey || e.metaKey;
}

/**
 * Live-region message state that re-announces identical consecutive messages
 * by alternating a trailing zero-width space (screen readers ignore
 * unchanged text).
 */
export function useAnnouncer(initial = ''): [string, (msg: string) => void] {
  const [message, setMessage] = useState(initial);
  const announce = useCallback((msg: string) => {
    setMessage(prev => (msg !== '' && prev === msg ? msg + '​' : msg));
  }, []);
  return [message, announce];
}

/**
 * Per-key focus restoration. `remember(key)` stores the currently focused
 * element (or an explicit one); `restore(key)` refocuses it after the DOM
 * settles. Separate keys avoid one overlay clobbering another's trigger.
 */
export function useFocusRestore() {
  const map = useRef<Map<string, HTMLElement | null>>(new Map());
  const remember = useCallback((key: string, el?: HTMLElement | null) => {
    map.current.set(key, el ?? (document.activeElement as HTMLElement | null));
  }, []);
  const restore = useCallback((key: string, fallback?: () => void) => {
    const el = map.current.get(key);
    map.current.delete(key);
    setTimeout(() => {
      if (el && el !== document.body && document.body.contains(el)) el.focus();
      else fallback?.();
    }, 0);
  }, []);
  return { remember, restore };
}

/** Standard Tab trap for a modal container. */
export function useFocusTrap(containerRef: RefObject<HTMLElement | null>, active: boolean) {
  useEffect(() => {
    if (!active) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key !== 'Tab' || !containerRef.current) return;
      const focusable = Array.from(
        containerRef.current.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), summary, [tabindex]:not([tabindex="-1"])'
        )
      );
      if (focusable.length === 0) {
        e.preventDefault();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const activeEl = document.activeElement;
      const outside = !containerRef.current.contains(activeEl);
      if (e.shiftKey) {
        if (outside || activeEl === first || (activeEl instanceof HTMLElement && activeEl.getAttribute('tabindex') === '-1')) {
          e.preventDefault();
          last.focus();
        }
      } else if (outside || activeEl === last) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [containerRef, active]);
}
