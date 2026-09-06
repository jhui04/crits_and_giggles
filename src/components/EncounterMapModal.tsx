import { useState, useRef, useEffect } from 'react';

interface EncounterMapModalProps {
  isOpen: boolean;
  onClose: () => void;
  mapName: string;
  dmMapUrl?: string;
  playerMapUrl?: string;
}

export function EncounterMapModal({
  isOpen,
  onClose,
  mapName,
  dmMapUrl,
  playerMapUrl
}: EncounterMapModalProps) {
  const [viewVersion, setViewVersion] = useState<'dm' | 'player'>('dm');
  const headingRef = useRef<HTMLHeadingElement>(null);
  const modalContentRef = useRef<HTMLDivElement>(null);
  const closeBtnRef = useRef<HTMLButtonElement>(null);

  // Focus heading when modal opens
  useEffect(() => {
    if (isOpen) {
      headingRef.current?.focus();
    }
  }, [isOpen]);

  // Trap focus and handle Escape
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onClose();
        return;
      }

      if (e.key === 'Tab' && modalContentRef.current) {
        const focusable = modalContentRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
        );
        if (focusable.length > 0) {
          const first = focusable[0];
          const last = focusable[focusable.length - 1];

          if (e.shiftKey) {
            if (document.activeElement === first || document.activeElement === headingRef.current || !modalContentRef.current.contains(document.activeElement)) {
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

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const hasDm = Boolean(dmMapUrl);
  const hasPlayer = Boolean(playerMapUrl);
  const currentUrl = (viewVersion === 'player' && hasPlayer) ? playerMapUrl : (dmMapUrl || playerMapUrl);
  const activeLabel = viewVersion === 'dm' ? 'Dungeon Master Version (with room codes)' : 'Player Version (art only)';

  return (
    <div
      className="modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="encounter-map-title"
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: 'rgba(0,0,0,0.85)',
        zIndex: 3500,
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        padding: '1rem'
      }}
    >
      <div
        ref={modalContentRef}
        className="modal-content"
        style={{
          backgroundColor: '#1f2327',
          color: '#f8f9fa',
          borderRadius: '8px',
          width: '95%',
          maxWidth: '1000px',
          maxHeight: '92vh',
          display: 'flex',
          flexDirection: 'column',
          padding: '1.5rem',
          boxShadow: '0 8px 32px rgba(0,0,0,0.7)',
          border: '1px solid #495057'
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', flexWrap: 'wrap', gap: '0.75rem' }}>
          <div>
            <h2 id="encounter-map-title" ref={headingRef} tabIndex={-1} style={{ margin: 0, outline: 'none', fontSize: '1.4rem' }}>
              Map: {mapName}
            </h2>
            <p style={{ margin: '0.25rem 0 0 0', color: '#adb5bd', fontSize: '0.9rem' }}>
              Showing {activeLabel}
            </p>
          </div>

          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
            {hasDm && hasPlayer && (
              <div role="group" aria-label="Map version selection" style={{ display: 'flex', gap: '0.25rem' }}>
                <button
                  type="button"
                  onClick={() => setViewVersion('dm')}
                  aria-pressed={viewVersion === 'dm'}
                  style={{
                    padding: '0.4rem 0.8rem',
                    borderRadius: '4px',
                    border: '1px solid #6c757d',
                    backgroundColor: viewVersion === 'dm' ? '#0d6efd' : '#343a40',
                    color: '#fff',
                    fontWeight: viewVersion === 'dm' ? 'bold' : 'normal',
                    cursor: 'pointer'
                  }}
                >
                  DM Version
                </button>
                <button
                  type="button"
                  onClick={() => setViewVersion('player')}
                  aria-pressed={viewVersion === 'player'}
                  style={{
                    padding: '0.4rem 0.8rem',
                    borderRadius: '4px',
                    border: '1px solid #6c757d',
                    backgroundColor: viewVersion === 'player' ? '#0d6efd' : '#343a40',
                    color: '#fff',
                    fontWeight: viewVersion === 'player' ? 'bold' : 'normal',
                    cursor: 'pointer'
                  }}
                >
                  Player Version
                </button>
              </div>
            )}

            <button
              ref={closeBtnRef}
              type="button"
              onClick={onClose}
              style={{
                padding: '0.4rem 0.9rem',
                backgroundColor: '#dc3545',
                color: '#fff',
                border: 'none',
                borderRadius: '4px',
                fontWeight: 'bold',
                cursor: 'pointer'
              }}
            >
              Close (Esc)
            </button>
          </div>
        </div>

        <div
          style={{
            flex: 1,
            overflow: 'auto',
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
            backgroundColor: '#121416',
            borderRadius: '6px',
            padding: '0.5rem',
            border: '1px solid #343a40'
          }}
        >
          {currentUrl ? (
            <img
              src={currentUrl}
              alt={`${mapName} (${activeLabel})`}
              style={{
                maxWidth: '100%',
                maxHeight: '70vh',
                objectFit: 'contain',
                borderRadius: '4px'
              }}
            />
          ) : (
            <p style={{ color: '#adb5bd', padding: '2rem' }}>No image available for this map.</p>
          )}
        </div>
      </div>
    </div>
  );
}
