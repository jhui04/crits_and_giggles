import { useState, useRef, useEffect, useMemo } from 'react';
import type { EncounterUnit, Position, MapSize } from '../types';
import { calculateDistance, calculateDirection, coordinateToLabel } from '../utils/mapUtils';
import { calculateCover } from '../utils/coverCalculation';
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

  // Track button that opened MoveTowardsModal to restore focus on close
  const moveBtnRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const lastActiveMoveBtnRef = useRef<HTMLButtonElement | null>(null);
  const lastMoveTargetIdRef = useRef<string | null>(null);

  // All combatants currently on the board
  const positionedUnits = useMemo(() => {
    return allUnits.filter(u => !!u.position);
  }, [allUnits]);

  const defaultOriginId = useMemo(() => {
    if (originUnit && originUnit.position) {
      return originUnit.instanceId;
    }
    const fallback =
      positionedUnits.find(u => !u.isPlayer) ||
      positionedUnits[0];
    return fallback?.instanceId || '';
  }, [originUnit, positionedUnits]);

  const [selectedOriginId, setSelectedOriginId] = useState<string | null>(null);
  const [prevIsOpen, setPrevIsOpen] = useState(isOpen);
  const [prevOriginId, setPrevOriginId] = useState(originUnit?.instanceId);

  // Adjust state during render when modal opens or originUnit prop changes
  if (prevIsOpen !== isOpen || prevOriginId !== originUnit?.instanceId) {
    setPrevIsOpen(isOpen);
    setPrevOriginId(originUnit?.instanceId);
    setSelectedOriginId(null);
  }

  const effectiveOriginId = selectedOriginId ?? defaultOriginId;

  // The active creature acting as the radar scanner origin
  const activeOriginUnit = useMemo(() => {
    return positionedUnits.find(u => u.instanceId === effectiveOriginId) || originUnit || positionedUnits[0] || null;
  }, [positionedUnits, effectiveOriginId, originUnit]);

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
      // Arrow Key navigation between radar controls (only when not focused on a select dropdown)
      if ((e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Home' || e.key === 'End') && document.activeElement?.tagName !== 'SELECT') {
        if (modalContentRef.current) {
          const focusable = Array.from(modalContentRef.current.querySelectorAll<HTMLElement>(
            'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
          ));
          if (focusable.length > 0) {
            e.preventDefault();
            e.stopPropagation();
            if (e.key === 'Home') {
              focusable[0].focus();
            } else if (e.key === 'End') {
              focusable[focusable.length - 1].focus();
            } else if (e.key === 'ArrowDown') {
              const curIdx = focusable.indexOf(document.activeElement as HTMLElement);
              if (curIdx === -1 || curIdx === focusable.length - 1) {
                focusable[0].focus();
              } else {
                focusable[curIdx + 1].focus();
              }
            } else if (e.key === 'ArrowUp') {
              const curIdx = focusable.indexOf(document.activeElement as HTMLElement);
              if (curIdx <= 0) {
                focusable[focusable.length - 1].focus();
              } else {
                focusable[curIdx - 1].focus();
              }
            }
          }
        }
        return;
      }
    };

    window.addEventListener('keydown', handleWindowKeyDown);
    return () => window.removeEventListener('keydown', handleWindowKeyDown);
  }, [isOpen, moveTarget, onClose]);

  const regionByCoord = useMemo(() => {
    const map = new Map<string, string>();
    if (mapSize?.regions) {
      for (const reg of mapSize.regions) {
        const idPart = reg.id && reg.id !== 'ocean' ? ` - ${reg.id}` : '';
        const display = `${reg.name}${idPart}`;
        for (const cell of reg.cells) {
          map.set(cell, display);
        }
      }
    }
    return map;
  }, [mapSize]);

  if (!isOpen || !activeOriginPos) return null;

  // Filter out the active origin unit, calculate relative distances & directions
  const otherEntities = positionedUnits
    .filter(u => !activeOriginUnit || u.instanceId !== activeOriginUnit.instanceId)
    .map(u => {
      const pos = u.position!;
      const distance = calculateDistance(activeOriginPos, pos);
      const direction = calculateDirection(activeOriginPos, pos);
      const regionName = regionByCoord.get(`${pos.x},${pos.y}`);
      const locLabel = regionName ? `${coordinateToLabel(pos)} (${regionName})` : coordinateToLabel(pos);
      const cover = calculateCover(activeOriginPos, pos, mapSize?.walls);
      return {
        unit: u,
        distance,
        direction,
        coordLabel: locLabel,
        cover
      };
    })
    .sort((a, b) => a.distance - b.distance);

  const originRegion = regionByCoord.get(`${activeOriginPos.x},${activeOriginPos.y}`);
  const originRegionTag = originRegion ? ` (${originRegion})` : '';

  const originLabel = activeOriginUnit
    ? `${activeOriginUnit.name} (${activeOriginUnit.isPlayer ? 'Player' : 'Monster'}) at ${coordinateToLabel(activeOriginPos)}${originRegionTag}`
    : `Cell ${coordinateToLabel(activeOriginPos)}${originRegionTag}`;

  return (
    <>
      <div
        className="modal-overlay"
        role="dialog"
        aria-modal="true"
        aria-label="Nearby Entities (Radar)"
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
          role="document"
          tabIndex={-1}
          className="modal-content"
          style={{
            backgroundColor: '#fff', color: '#111', padding: '1.5rem',
            borderRadius: '8px', width: '90%', maxWidth: '640px',
            maxHeight: '85vh', display: 'flex', flexDirection: 'column',
            boxShadow: '0 4px 20px rgba(0,0,0,0.5)', outline: 'none'
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
                {otherEntities.map(({ unit, distance, direction, coordLabel, cover }) => {
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
                        <strong>{unit.name}</strong> <span style={{ fontSize: '0.85em', color: '#555' }}>({roleText})</span>
                        {hpText && <div style={{ fontSize: '0.85em', color: '#444' }}>{hpText}</div>}
                        {cover && cover.type !== 'none' && (
                          <div
                            style={{
                              fontSize: '0.85em',
                              fontWeight: 'bold',
                              color: cover.type === 'total' ? '#b02a37' : cover.type === 'three_quarters' ? '#b45309' : '#0b5ed7',
                              marginTop: '0.2rem'
                            }}
                          >
                            Cover: {cover.description}
                          </div>
                        )}
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
                            aria-label={`Move towards ${unit.name}${cover && cover.type !== 'none' ? ` (${cover.description})` : ''}`}
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
