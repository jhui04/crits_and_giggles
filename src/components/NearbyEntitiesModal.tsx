import { useState, useRef, useEffect, useMemo } from 'react';
import type { EncounterUnit, Position, MapSize } from '../types';
import { calculateDistance, calculateDirection, coordinateToLabel } from '../utils/mapUtils';
import { MoveTowardsModal } from './MoveTowardsModal';

interface NearbyEntitiesModalProps {
  isOpen: boolean;
  originUnit: EncounterUnit | null;
  originPosition: Position | null;
  allUnits: EncounterUnit[];
  mapSize?: MapSize;
  onClose: () => void;
  onConfirmMoveTowards?: (newPos: Position, movedFeet: number, announcement: string, unitId?: string) => void;
}

export function NearbyEntitiesModal({
  isOpen,
  originUnit,
  originPosition,
  allUnits,
  mapSize,
  onClose,
  onConfirmMoveTowards
}: NearbyEntitiesModalProps) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  const [moveTarget, setMoveTarget] = useState<EncounterUnit | null>(null);
  const [selectedOriginId, setSelectedOriginId] = useState<string>('');

  // Track button that opened MoveTowardsModal to restore focus on close
  const moveBtnRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const lastActiveMoveBtnRef = useRef<HTMLButtonElement | null>(null);
  const lastMoveTargetIdRef = useRef<string | null>(null);

  // All combatants currently on the board
  const positionedUnits = useMemo(() => {
    return allUnits.filter(u => !!u.position);
  }, [allUnits]);

  // Sync selected origin unit when modal opens or originUnit changes
  useEffect(() => {
    if (isOpen) {
      if (originUnit && originUnit.position) {
        setSelectedOriginId(originUnit.instanceId);
      } else {
        // Fallback to active turn combatant, first monster, or first positioned unit
        const fallback =
          positionedUnits.find(u => !u.isPlayer) ||
          positionedUnits[0];
        if (fallback) {
          setSelectedOriginId(fallback.instanceId);
        }
      }
    }
  }, [isOpen, originUnit, positionedUnits]);

  // The active creature acting as the radar scanner origin
  const activeOriginUnit = useMemo(() => {
    return positionedUnits.find(u => u.instanceId === selectedOriginId) || originUnit || positionedUnits[0] || null;
  }, [positionedUnits, selectedOriginId, originUnit]);

  const activeOriginPos = activeOriginUnit?.position || originPosition || null;

  const wasOpenRef = useRef(false);

  const modalContentRef = useRef<HTMLDivElement>(null);

  // Focus heading only when Radar first opens, not when returning from MoveTowardsModal
  useEffect(() => {
    if (isOpen && !wasOpenRef.current) {
      headingRef.current?.focus();
      const timer = setTimeout(() => {
        headingRef.current?.focus();
      }, 50);
      wasOpenRef.current = true;
      return () => clearTimeout(timer);
    }
    if (!isOpen) {
      wasOpenRef.current = false;
    }
  }, [isOpen]);

  // Global window listener for Escape and focus trap (only active when MoveTowardsModal is not open)
  useEffect(() => {
    if (!isOpen || moveTarget) return;

    const handleWindowKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
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

    window.addEventListener('keydown', handleWindowKeyDown);
    return () => window.removeEventListener('keydown', handleWindowKeyDown);
  }, [isOpen, moveTarget, onClose]);

  if (!isOpen || !activeOriginPos) return null;

  // Filter out the active origin unit, calculate relative distances & directions
  const otherEntities = positionedUnits
    .filter(u => !activeOriginUnit || u.instanceId !== activeOriginUnit.instanceId)
    .map(u => {
      const pos = u.position!;
      const distance = calculateDistance(activeOriginPos, pos);
      const direction = calculateDirection(activeOriginPos, pos);
      return {
        unit: u,
        distance,
        direction,
        coordLabel: coordinateToLabel(pos)
      };
    })
    .sort((a, b) => a.distance - b.distance);

  const originLabel = activeOriginUnit
    ? `${activeOriginUnit.name} (${activeOriginUnit.isPlayer ? 'Player' : 'Monster'}) at ${coordinateToLabel(activeOriginPos)}`
    : `Cell ${coordinateToLabel(activeOriginPos)}`;

  return (
    <>
      <div
        className="modal-overlay"
        role="dialog"
        aria-modal="true"
        aria-labelledby="radar-title"
        aria-hidden={!!moveTarget}
        style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          backgroundColor: 'rgba(0,0,0,0.7)', zIndex: 3000,
          display: 'flex',
          justifyContent: 'center', alignItems: 'center',
          pointerEvents: moveTarget ? 'none' : 'auto'
        }}
      >
        <div
          ref={modalContentRef}
          className="modal-content"
          style={{
            backgroundColor: '#fff', color: '#111', padding: '1.5rem',
            borderRadius: '8px', width: '90%', maxWidth: '640px',
            maxHeight: '85vh', display: 'flex', flexDirection: 'column',
            boxShadow: '0 4px 20px rgba(0,0,0,0.5)'
          }}
        >
          <h2 id="radar-title" ref={headingRef} tabIndex={-1} style={{ outline: 'none', marginTop: 0 }}>
            Nearby Entities (Radar)
          </h2>

          {/* Accessible Origin Creature Selector */}
          <div
            style={{
              backgroundColor: '#f8f9fa',
              border: '1px solid #dee2e6',
              borderRadius: '6px',
              padding: '0.75rem 1rem',
              marginBottom: '1rem',
              display: 'flex',
              flexWrap: 'wrap',
              alignItems: 'center',
              gap: '0.5rem'
            }}
          >
            <label htmlFor="radar-origin-select" style={{ fontWeight: 'bold' }}>
              Scanning From Creature:
            </label>
            <select
              id="radar-origin-select"
              value={activeOriginUnit?.instanceId || ''}
              onChange={e => setSelectedOriginId(e.target.value)}
              style={{
                flex: '1 1 220px',
                padding: '0.4rem 0.6rem',
                borderRadius: '4px',
                border: '1px solid #ced4da',
                fontSize: '0.95rem',
                fontWeight: 'bold',
                backgroundColor: '#fff'
              }}
            >
              {positionedUnits.map(u => (
                <option key={u.instanceId} value={u.instanceId}>
                  {u.name} ({u.isPlayer ? 'Player' : 'Monster'}) at {coordinateToLabel(u.position!)}
                </option>
              ))}
            </select>
          </div>

          <p style={{ margin: '0 0 1rem 0', color: '#555', fontSize: '0.9rem' }}>
            Current Origin: <strong>{originLabel}</strong>
          </p>

          <div style={{ overflowY: 'auto', flex: 1, marginBottom: '1rem' }}>
            {otherEntities.length === 0 ? (
              <p>No other entities detected on the map.</p>
            ) : (
              <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                {otherEntities.map(({ unit, distance, direction, coordLabel }) => {
                  const roleText = unit.isPlayer ? 'Ally/Player' : 'Enemy/Monster';
                  const hpText = unit.currentHp !== undefined ? `${unit.currentHp}/${unit.maxHp ?? '?'} HP` : '';
                  return (
                    <li
                      key={unit.instanceId}
                      style={{
                        padding: '0.75rem',
                        borderBottom: '1px solid #e0e0e0',
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        flexWrap: 'wrap',
                        gap: '0.5rem'
                      }}
                    >
                      <div style={{ flex: '1 1 200px' }}>
                        <strong>{unit.name}</strong> <span style={{ fontSize: '0.85em', color: '#666' }}>({roleText})</span>
                        {hpText && <div style={{ fontSize: '0.85em', color: '#444' }}>{hpText}</div>}
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                        <div style={{ textAlign: 'right', fontWeight: 'bold' }}>
                          <span>{distance} ft {direction}</span>
                          <div style={{ fontSize: '0.85em', color: '#555' }}>at {coordLabel}</div>
                        </div>
                        {activeOriginUnit && onConfirmMoveTowards && (
                          <button
                            ref={el => { moveBtnRefs.current[unit.instanceId] = el; }}
                            type="button"
                            onClick={(e) => {
                              lastActiveMoveBtnRef.current = e.currentTarget;
                              lastMoveTargetIdRef.current = unit.instanceId;
                              setMoveTarget(unit);
                            }}
                            aria-label={`Move towards ${unit.name}`}
                            style={{
                              padding: '0.4rem 0.8rem',
                              backgroundColor: '#198754',
                              color: '#fff',
                              fontWeight: 'bold',
                              fontSize: '0.85rem',
                              border: 'none',
                              borderRadius: '4px',
                              cursor: 'pointer'
                            }}
                          >
                            Move Towards
                          </button>
                        )}
                      </div>
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
              backgroundColor: '#0056b3',
              color: '#fff',
              border: 'none',
              borderRadius: '4px'
            }}
          >
            Close Radar (Esc)
          </button>
        </div>
      </div>

      {/* Move Towards Modal (True new popup dialog, isolation guaranteed) */}
      {activeOriginUnit && moveTarget && (
        <MoveTowardsModal
          isOpen={!!moveTarget}
          originUnit={activeOriginUnit}
          targetUnit={moveTarget}
          allUnits={allUnits}
          mapSize={mapSize}
          onClose={() => {
            const targetId = lastMoveTargetIdRef.current;
            setMoveTarget(null);
            setTimeout(() => {
              if (targetId && moveBtnRefs.current[targetId]) {
                moveBtnRefs.current[targetId]?.focus();
              } else {
                lastActiveMoveBtnRef.current?.focus();
              }
            }, 50);
          }}
          onConfirmMove={(newPos, movedFeet, announcement) => {
            setMoveTarget(null);
            if (onConfirmMoveTowards) {
              onConfirmMoveTowards(newPos, movedFeet, announcement, activeOriginUnit.instanceId);
            } else {
              onClose();
            }
          }}
        />
      )}
    </>
  );
}
