import React, { useRef, useEffect } from 'react';

interface ShortcutsHelpProps {
  isOpen: boolean;
  onClose: () => void;
}

export function ShortcutsHelp({ isOpen, onClose }: ShortcutsHelpProps) {
  const modalHeadingRef = useRef<HTMLHeadingElement>(null);
  const modalContentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isOpen) {
      setTimeout(() => {
        modalHeadingRef.current?.focus();
      }, 0);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
      return;
    }

    // Modal focus trap
    if (e.key === 'Tab' && modalContentRef.current) {
      const focusable = modalContentRef.current.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      );
      if (focusable.length > 0) {
        const first = focusable[0];
        const last = focusable[focusable.length - 1];

        if (e.shiftKey) {
          if (document.activeElement === first || document.activeElement === modalHeadingRef.current || !modalContentRef.current.contains(document.activeElement)) {
            e.preventDefault();
            last.focus();
          }
        } else {
          if (document.activeElement === last || !modalContentRef.current.contains(document.activeElement)) {
            e.preventDefault();
            first.focus();
          }
        }
      }
    }
  };

  const shortcuts = [
    { key: 'Alt + O', description: 'Open/Close The Oracle (Search Monsters, Spells, Magic Items, and World Assets)' },
    { key: 'Alt + R', description: 'Open/Close Quick Dice Roller' },
    { key: 'Alt + D', description: 'Open/Close DM Dice Roll Log' },
    { key: 'Alt + M', description: 'Toggle between Create Mode and Run Mode' },
    { key: 'Alt + C', description: 'Open Campaign Switcher' },
    { key: 'Alt + W', description: 'Open World Switcher' },
    { key: 'Alt + 1', description: 'Switch to Campaign Tab (Create Mode)' },
    { key: 'Alt + 2', description: 'Switch to World Tab (Create Mode)' },
    { key: 'Alt + S', description: 'Switch to Spells tab' },
    { key: 'Alt + H', description: 'Show/Hide this Shortcuts Help' },
    { key: 'Alt + N', description: 'Next Turn (during Combat)' },
    { key: 'Alt + B', description: 'Jump Focus to Combat Map' },
    { key: 'Alt + E', description: 'Nearby Entities Radar (Combat Map)' },
    { key: 'Alt + J', description: 'Jump to Creature (Combat Map)' },
    { key: 'Alt + L', description: 'Jump to Region (Combat Map)' },
    { key: 'Esc', description: 'Close any open modal or dialog' },
  ];

  return (
    <div 
      className="modal-overlay" 
      role="dialog" 
      aria-modal="true" 
      aria-labelledby="shortcuts-title"
      onKeyDown={handleKeyDown}
      style={{
        position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
        backgroundColor: 'rgba(0,0,0,0.7)', zIndex: 4000,
        display: 'flex', justifyContent: 'center', alignItems: 'center'
      }}
    >
      <div 
        ref={modalContentRef}
        className="modal-content"
        style={{
          backgroundColor: '#fff', color: '#333', padding: '2rem',
          borderRadius: '8px', width: '90%', maxWidth: '500px',
          boxShadow: '0 4px 20px rgba(0,0,0,0.5)'
        }}
      >
        <h2 id="shortcuts-title" ref={modalHeadingRef} tabIndex={-1} style={{ outline: 'none', marginTop: 0 }}>
          Keyboard Shortcuts
        </h2>
        
        <ul style={{ listStyle: 'none', padding: 0, margin: '1.5rem 0' }}>
          {shortcuts.map((s, i) => (
            <li key={i} style={{ marginBottom: '1rem', display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid #eee', paddingBottom: '0.5rem' }}>
              <kbd style={{ 
                backgroundColor: '#eee', padding: '0.2rem 0.5rem', borderRadius: '4px', 
                border: '1px solid #ccc', fontWeight: 'bold', fontFamily: 'monospace'
              }}>
                {s.key}
              </kbd>
              <span style={{ marginLeft: '1rem', textAlign: 'right' }}>{s.description}</span>
            </li>
          ))}
        </ul>

        <button 
          type="button" 
          onClick={onClose}
          style={{ width: '100%', padding: '0.75rem', fontWeight: 'bold', cursor: 'pointer' }}
        >
          Close (Esc)
        </button>
      </div>
    </div>
  );
}
