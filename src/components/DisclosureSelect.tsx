import { useEffect, useId, useRef, useState } from 'react';
import type { CSSProperties, FocusEvent, KeyboardEvent } from 'react';

export interface DisclosureSelectOption<T extends string> {
  value: T;
  label: string;
}

interface DisclosureSelectProps<T extends string> {
  /** Short label, spoken with the current value as the button's name: "Search Type: Monsters". */
  label: string;
  value: T;
  options: DisclosureSelectOption<T>[];
  onChange: (value: T) => void;
  /** id for the toggle button, so tests and other code can find it. */
  id?: string;
  buttonStyle?: CSSProperties;
}

/**
 * A single-choice picker for choices that are not form fields (e.g. which
 * kind of thing to search), built on the disclosure pattern.
 *
 * Why a disclosure and not a WAI-ARIA menu button: JAWS enters forms mode in
 * a role="menu" and keeps it after the menu closes, so after choosing, Up and
 * Down Arrow could not read on through the page. Plain buttons keep JAWS and
 * NVDA in browse mode throughout. So there are no menu, listbox, option,
 * combobox or radio roles here, and no aria-haspopup (JAWS keeps forms mode
 * on a button with aria-haspopup too).
 *
 * Closed: one <button aria-expanded="false"> whose text is "Label: Value", one
 * screen reader stop. It has no keydown handler: Enter, Space and a click
 * (including a screen reader's browse-mode Enter) toggle it natively.
 * Open: a <ul aria-label="Label"> rendered right after the button, so the
 * virtual cursor reaches it with one Down Arrow. Each option is a
 * <button aria-pressed>; DOM focus moves to the pressed one. Up/Down Arrow
 * move between options and wrap, Home/End go to the first/last, Tab and
 * Shift+Tab work natively. Activating an option chooses it, closes the list
 * and focuses the toggle. Escape closes without a change and focuses the
 * toggle. Focus or a click leaving the control closes it without moving focus.
 *
 * While open, everything outside the control is made inert, so a screen
 * reader's browse-mode Down Arrow stops at the last option instead of reading
 * on into the page (and Up Arrow stops at the toggle). Browse-mode arrows
 * never reach the page, so they cannot wrap; only real keydowns (focus mode,
 * sighted keyboard users) wrap. Tab out of the last option or Shift+Tab out
 * of the toggle lifts the inert first, so focus still leaves natively.
 */
export function DisclosureSelect<T extends string>({ label, value, options, onChange, id, buttonStyle }: DisclosureSelectProps<T>) {
  const autoId = useId();
  const buttonId = id ?? `${autoId}-button`;
  const listId = `${buttonId}-list`;
  const [isOpen, setIsOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const optionRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const releaseInertRef = useRef<() => void>(() => {});

  const selectedIndex = Math.max(0, options.findIndex((o) => o.value === value));
  const current = options[selectedIndex];

  // Opening moves focus to the pressed option (after it has rendered).
  // The value cannot change while the list is open (choosing closes it).
  useEffect(() => {
    if (isOpen) optionRefs.current[selectedIndex]?.focus();
  }, [isOpen, selectedIndex]);

  // While open, make every element outside the control inert (removed from
  // the accessibility tree and from focus), so a screen reader can only read
  // the toggle and the options. Elements that were already inert are left alone.
  useEffect(() => {
    if (!isOpen) return;
    const madeInert: Element[] = [];
    for (let node: HTMLElement | null = wrapperRef.current; node && node !== document.body; node = node.parentElement) {
      for (const sibling of Array.from(node.parentElement?.children ?? [])) {
        if (sibling !== node && !sibling.hasAttribute('inert')) {
          sibling.setAttribute('inert', '');
          madeInert.push(sibling);
        }
      }
    }
    const release = () => {
      madeInert.forEach((el) => el.removeAttribute('inert'));
      madeInert.length = 0;
    };
    releaseInertRef.current = release;
    return release;
  }, [isOpen]);

  // A click anywhere outside the control closes it, without moving focus.
  useEffect(() => {
    if (!isOpen) return;
    const onPointerDown = (e: MouseEvent) => {
      if (!wrapperRef.current?.contains(e.target as Node)) setIsOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [isOpen]);

  const closeToButton = () => {
    setIsOpen(false);
    buttonRef.current?.focus();
  };

  const choose = (index: number) => {
    const option = options[index];
    closeToButton();
    if (option && option.value !== value) onChange(option.value);
  };

  const handleListKeyDown = (e: KeyboardEvent<HTMLUListElement>) => {
    const last = options.length - 1;
    const focused = optionRefs.current.findIndex((el) => el === document.activeElement);
    let next: number;
    switch (e.key) {
      case 'ArrowDown': next = focused < 0 || focused >= last ? 0 : focused + 1; break;
      case 'ArrowUp': next = focused <= 0 ? last : focused - 1; break;
      case 'Home': next = 0; break;
      case 'End': next = last; break;
      default: return;
    }
    e.preventDefault();
    optionRefs.current[next]?.focus();
  };

  const handleWrapperKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Tab' && isOpen) {
      // About to Tab out of the control: lift the inert now, before the
      // browser picks the next focusable element. The blur then closes the list.
      const lastOption = optionRefs.current[options.length - 1];
      const active = document.activeElement;
      if (e.shiftKey ? active === buttonRef.current : active === lastOption) releaseInertRef.current();
      return;
    }
    if (e.key === 'Escape' && isOpen) {
      // Handled here: the surrounding dialog must not close as well.
      e.preventDefault();
      e.stopPropagation();
      closeToButton();
    }
  };

  const handleWrapperBlur = (e: FocusEvent<HTMLDivElement>) => {
    // Focus left the toggle and the list entirely (Tab, Shift+Tab, a click elsewhere).
    if (isOpen && !e.currentTarget.contains(e.relatedTarget as Node | null)) setIsOpen(false);
  };

  return (
    <div ref={wrapperRef} style={{ position: 'relative' }} onKeyDown={handleWrapperKeyDown} onBlur={handleWrapperBlur}>
      <button
        ref={buttonRef}
        id={buttonId}
        type="button"
        aria-expanded={isOpen}
        aria-controls={isOpen ? listId : undefined}
        onClick={() => (isOpen ? closeToButton() : setIsOpen(true))}
        // While open, a mouse press on the toggle must not move focus first;
        // the click then closes the list and focuses the toggle.
        onMouseDown={(e) => { if (isOpen) e.preventDefault(); }}
        style={{ textAlign: 'left', cursor: 'pointer', ...buttonStyle }}
      >
        {label}: {current?.label}
        <span aria-hidden="true" style={{ float: 'right' }}>{isOpen ? '▲' : '▼'}</span>
      </button>
      {isOpen && (
        <ul
          id={listId}
          aria-label={label}
          onKeyDown={handleListKeyDown}
          className="disclosure-select-list"
          style={{
            position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 10,
            margin: '0.25rem 0 0', padding: '0.25rem 0', listStyle: 'none',
            background: '#222', color: 'white', border: '1px solid #666', borderRadius: '4px',
            boxShadow: '0 4px 12px rgba(0,0,0,0.6)',
          }}
        >
          {options.map((option, i) => {
            const pressed = i === selectedIndex;
            return (
              <li key={option.value}>
                <button
                  ref={(el) => { optionRefs.current[i] = el; }}
                  type="button"
                  aria-pressed={pressed}
                  onClick={() => choose(i)}
                  className="disclosure-select-option"
                  style={{
                    display: 'block', width: '100%', textAlign: 'left',
                    padding: '0.75rem 1rem', cursor: 'pointer', fontWeight: pressed ? 'bold' : 'normal',
                    color: 'inherit', border: 'none', borderRadius: 0, fontFamily: 'inherit', fontSize: 'inherit',
                  }}
                >
                  <span aria-hidden="true" style={{ display: 'inline-block', width: '1.5rem' }}>{pressed ? '✓' : ''}</span>
                  {option.label}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
