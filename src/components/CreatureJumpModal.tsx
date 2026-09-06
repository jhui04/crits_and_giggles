import React, { useRef, useEffect } from 'react';
import type { EncounterUnit, Position } from '../types';
import { coordinateToLabel } from '../utils/mapUtils';

interface CreatureJumpModalProps {
  isOpen: boolean;
  units: EncounterUnit[];
  onSelect: (position: Position) => void;
  onClose: () => void;
}

export function CreatureJumpModal({
  isOpen,
  units,
  onSelect,
  onClose
}: CreatureJumpModalProps) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  const firstItemRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (isOpen) {
      setTimeout(() => {
        headingRef.current?.focus();
      }, 0);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    }
  };

  const positionedUnits = units.filter(u => !!u.position);

  return (
    <div
      className="modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="jump-modal-title"
      onKeyDown={handleKeyDown}
      style={{
        position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
        backgroundColor: 'rgba(0,0,0,0.7)', zIndex: 3000,
        display: 'flex', justifyContent: 'center', alignItems: 'center'
      }}
    >
      <div
        className="modal-content"
        style={{
          backgroundColor: '#fff', color: '#111', padding: '1.5rem',
          borderRadius: '8px', width: '90%', maxWidth: '500px',
          maxHeight: '85vh', display: 'flex', flexDirection: 'column',
          boxShadow: '0 4px 20px rgba(0,0,0,0.5)'
        }}
      >
        <h2 id="jump-modal-title" ref={headingRef} tabIndex={-1} style={{ outline: 'none', marginTop: 0 }}>
          Jump to Creature
        </h2>

        <p style={{ margin: '0 0 1rem 0', color: '#555' }}>
          Select a combatant to move the map focus directly to their cell.
        </p>

        <div style={{ overflowY: 'auto', flex: 1, marginBottom: '1rem' }}>
          {positionedUnits.length === 0 ? (
            <p>No positioned creatures on the board.</p>
          ) : (
            <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
              {positionedUnits.map((unit, index) => {
                const coord = coordinateToLabel(unit.position!);
                const roleText = unit.isPlayer ? 'Player' : 'Monster';
                const hpText = unit.currentHp !== undefined ? ` • ${unit.currentHp}/${unit.maxHp ?? '?'} HP` : '';
                return (
                  <li key={unit.instanceId} style={{ marginBottom: '0.5rem' }}>
                    <button
                      ref={index === 0 ? firstItemRef : null}
                      type="button"
                      onClick={() => onSelect(unit.position!)}
                      style={{
                        width: '100%',
                        textAlign: 'left',
                        padding: '0.75rem 1rem',
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        backgroundColor: '#f8f9fa',
                        border: '1px solid #ced4da',
                        borderRadius: '4px',
                        cursor: 'pointer'
                      }}
                    >
                      <div>
                        <strong>{unit.name}</strong> <span style={{ fontSize: '0.85em', color: '#666' }}>({roleText})</span>
                        <div style={{ fontSize: '0.85em', color: '#555' }}>Cell {coord}{hpText}</div>
                      </div>
                      <span style={{ fontWeight: 'bold', color: '#0056b3' }}>Jump &rarr;</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <button
          type="button"
          onClick={onClose}
          style={{
            width: '100%',
            padding: '0.75rem',
            fontWeight: 'bold',
            cursor: 'pointer',
            backgroundColor: '#6c757d',
            color: '#fff',
            border: 'none',
            borderRadius: '4px'
          }}
        >
          Close (Esc)
        </button>
      </div>
    </div>
  );
}
