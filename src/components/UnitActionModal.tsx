import { useRef, useEffect } from 'react';
import type { EncounterUnit, Position } from '../types';
import { coordinateToLabel } from '../utils/mapUtils';

interface UnitActionModalProps {
  isOpen: boolean;
  unit: EncounterUnit | null;
  position: Position | null;
  onClose: () => void;
  onStartMove: (unit: EncounterUnit) => void;
  onOpenOperations?: (unit: EncounterUnit) => void;
  onOpenDetails?: (unit: EncounterUnit) => void;
  onOpenRadar: (unit: EncounterUnit) => void;
}

export function UnitActionModal({
  isOpen,
  unit,
  position,
  onClose,
  onStartMove,
  onOpenOperations,
  onOpenDetails,
  onOpenRadar
}: UnitActionModalProps) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  const modalContentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isOpen) {
      headingRef.current?.focus();
      const timer = setTimeout(() => {
        headingRef.current?.focus();
      }, 50);
      return () => clearTimeout(timer);
    }
  }, [isOpen]);

  // Global window listener for Escape, shortcuts, and focus trap
  useEffect(() => {
    if (!isOpen || !unit) return;

    const handleWindowKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onClose();
        return;
      }

      // Focus trap
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
        return;
      }

      const key = e.key.toLowerCase();
      if (key === 'm') {
        e.preventDefault();
        e.stopPropagation();
        onStartMove(unit);
        return;
      }
      if (key === 'a' && onOpenOperations && !unit.isPlayer) {
        e.preventDefault();
        e.stopPropagation();
        onOpenOperations(unit);
        return;
      }
      if (key === 'd' && onOpenDetails) {
        e.preventDefault();
        e.stopPropagation();
        onOpenDetails(unit);
        return;
      }
      if (key === 'r') {
        e.preventDefault();
        e.stopPropagation();
        onOpenRadar(unit);
        return;
      }
    };

    window.addEventListener('keydown', handleWindowKeyDown);
    return () => window.removeEventListener('keydown', handleWindowKeyDown);
  }, [isOpen, unit, onClose, onStartMove, onOpenOperations, onOpenDetails, onOpenRadar]);

  if (!isOpen || !unit || !position) return null;

  const coord = coordinateToLabel(position);
  const roleText = unit.isPlayer ? 'Player' : 'Monster';
  const hpText = unit.currentHp !== undefined ? `${unit.currentHp}/${unit.maxHp ?? '?'} HP` : '';

  return (
    <div
      className="modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="unit-action-title"
      style={{
        position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
        backgroundColor: 'rgba(0,0,0,0.7)', zIndex: 3100,
        display: 'flex', justifyContent: 'center', alignItems: 'center'
      }}
    >
      <div
        ref={modalContentRef}
        className="modal-content"
        style={{
          backgroundColor: '#fff', color: '#111', padding: '1.5rem',
          borderRadius: '8px', width: '90%', maxWidth: '450px',
          boxShadow: '0 4px 20px rgba(0,0,0,0.5)'
        }}
      >
        <h2 id="unit-action-title" ref={headingRef} tabIndex={-1} style={{ outline: 'none', marginTop: 0 }}>
          {unit.name} ({roleText}) Options
        </h2>

        <p style={{ margin: '0 0 1.25rem 0', color: '#495057' }}>
          Cell <strong>{coord}</strong> {hpText ? `• ${hpText}` : ''}
        </p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', marginBottom: '1.25rem' }}>
          <button
            type="button"
            onClick={() => {
              onStartMove(unit);
            }}
            style={{
              padding: '0.75rem 1rem',
              textAlign: 'left',
              fontWeight: 'bold',
              fontSize: '1rem',
              backgroundColor: '#0d6efd',
              color: '#fff',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer',
              display: 'flex',
              justifyContent: 'space-between'
            }}
          >
            <span>Move on Map</span>
            <kbd style={{ backgroundColor: 'rgba(255,255,255,0.2)', padding: '0.1rem 0.4rem', borderRadius: '3px', fontSize: '0.85rem' }}>M</kbd>
          </button>

          {!unit.isPlayer && onOpenOperations && (
            <button
              type="button"
              onClick={() => {
                onOpenOperations(unit);
              }}
              style={{
                padding: '0.75rem 1rem',
                textAlign: 'left',
                fontWeight: 'bold',
                fontSize: '1rem',
                backgroundColor: '#dc3545',
                color: '#fff',
                border: 'none',
                borderRadius: '4px',
                cursor: 'pointer',
                display: 'flex',
                justifyContent: 'space-between'
              }}
            >
              <span>Actions & Attacks</span>
              <kbd style={{ backgroundColor: 'rgba(255,255,255,0.2)', padding: '0.1rem 0.4rem', borderRadius: '3px', fontSize: '0.85rem' }}>A</kbd>
            </button>
          )}

          {onOpenDetails && (
            <button
              type="button"
              onClick={() => {
                onOpenDetails(unit);
              }}
              style={{
                padding: '0.75rem 1rem',
                textAlign: 'left',
                fontWeight: 'bold',
                fontSize: '1rem',
                backgroundColor: '#495057',
                color: '#fff',
                border: 'none',
                borderRadius: '4px',
                cursor: 'pointer',
                display: 'flex',
                justifyContent: 'space-between'
              }}
            >
              <span>View Details & Stats</span>
              <kbd style={{ backgroundColor: 'rgba(255,255,255,0.2)', padding: '0.1rem 0.4rem', borderRadius: '3px', fontSize: '0.85rem' }}>D</kbd>
            </button>
          )}

          <button
            type="button"
            onClick={() => {
              onOpenRadar(unit);
            }}
            style={{
              padding: '0.75rem 1rem',
              textAlign: 'left',
              fontWeight: 'bold',
              fontSize: '1rem',
              backgroundColor: '#198754',
              color: '#fff',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer',
              display: 'flex',
              justifyContent: 'space-between'
            }}
          >
            <span>Scan Radar (Nearby Entities)</span>
            <kbd style={{ backgroundColor: 'rgba(255,255,255,0.2)', padding: '0.1rem 0.4rem', borderRadius: '3px', fontSize: '0.85rem' }}>R</kbd>
          </button>
        </div>

        <button
          type="button"
          onClick={onClose}
          style={{
            width: '100%',
            padding: '0.6rem',
            fontWeight: 'bold',
            cursor: 'pointer',
            backgroundColor: '#e9ecef',
            color: '#333',
            border: '1px solid #ced4da',
            borderRadius: '4px'
          }}
        >
          Close (Esc)
        </button>
      </div>
    </div>
  );
}
