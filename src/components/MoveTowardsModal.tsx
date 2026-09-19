import { useState, useRef, useEffect, useMemo } from 'react';
import type { EncounterUnit, Position, MapSize } from '../types';
import {
  calculateDistance,
  coordinateToLabel,
  columnIndexToLabel,
  getCreatureSpeed,
  calculateMoveTowards
} from '../utils/mapUtils';

interface MoveTowardsModalProps {
  isOpen: boolean;
  originUnit: EncounterUnit;
  targetUnit: EncounterUnit;
  allUnits: EncounterUnit[];
  mapSize?: MapSize;
  onClose: () => void;
  onConfirmMove: (newPos: Position, movedFeet: number, announcement: string) => void;
}

const DEFAULT_MAP_SIZE: MapSize = { width: 20, height: 20 };

export function MoveTowardsModal({
  isOpen,
  originUnit,
  targetUnit,
  allUnits,
  mapSize = DEFAULT_MAP_SIZE,
  onClose,
  onConfirmMove
}: MoveTowardsModalProps) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  const modalContainerRef = useRef<HTMLDivElement>(null);

  const fromPos = originUnit.position;
  const toPos = targetUnit.position;

  const totalDistance = useMemo(() => {
    if (!fromPos || !toPos) return 0;
    return calculateDistance(fromPos, toPos);
  }, [fromPos, toPos]);

  const maxSpeed = useMemo(() => {
    return getCreatureSpeed(originUnit);
  }, [originUnit]);

  // Default is whichever is lower: creature's max speed or distance to target
  const defaultMoveAmount = useMemo(() => {
    return Math.min(maxSpeed, totalDistance);
  }, [maxSpeed, totalDistance]);

  const [moveAmount, setMoveAmount] = useState<number>(defaultMoveAmount);
  const [manualPos, setManualPos] = useState<Position | null>(null);
  const [prevKey, setPrevKey] = useState(`${originUnit.instanceId}-${targetUnit.instanceId}-${defaultMoveAmount}`);

  // Adjust default move amount whenever origin or target changes
  const currentKey = `${originUnit.instanceId}-${targetUnit.instanceId}-${defaultMoveAmount}`;
  if (prevKey !== currentKey) {
    setPrevKey(currentKey);
    setMoveAmount(defaultMoveAmount);
    setManualPos(null);
  }

  useEffect(() => {
    if (isOpen) {
      headingRef.current?.focus();
      const timer = setTimeout(() => {
        headingRef.current?.focus();
      }, 50);
      return () => clearTimeout(timer);
    }
  }, [isOpen]);

  // Global window listener for Escape and robust focus trapping
  useEffect(() => {
    if (!isOpen) return;

    const handleWindowKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onClose();
        return;
      }

      // Strict modal focus trap
      if (e.key === 'Tab' && modalContainerRef.current) {
        const focusable = modalContainerRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
        );
        if (focusable.length > 0) {
          const first = focusable[0];
          const last = focusable[focusable.length - 1];

          if (e.shiftKey) {
            if (document.activeElement === first || document.activeElement === headingRef.current || !modalContainerRef.current.contains(document.activeElement)) {
              e.preventDefault();
              last.focus();
            }
          } else {
            if (document.activeElement === last || !modalContainerRef.current.contains(document.activeElement)) {
              e.preventDefault();
              first.focus();
            }
          }
        }
      }
    };

    window.addEventListener('keydown', handleWindowKeyDown);
    return () => window.removeEventListener('keydown', handleWindowKeyDown);
  }, [isOpen, onClose]);

  // Set of occupied cells (excluding origin unit itself)
  const occupiedSet = useMemo(() => {
    const set = new Set<string>();
    allUnits.forEach(u => {
      if (u.position && u.instanceId !== originUnit.instanceId) {
        set.add(`${u.position.x},${u.position.y}`);
      }
    });
    return set;
  }, [allUnits, originUnit.instanceId]);

  if (!isOpen || !fromPos || !toPos) return null;

  const preview = calculateMoveTowards(fromPos, toPos, moveAmount, occupiedSet, mapSize?.walls, mapSize);
  const effectivePos = manualPos || preview.newPos;
  const effectiveMovedFeet = manualPos ? calculateDistance(fromPos, manualPos) : preview.movedFeet;
  const fromCoord = coordinateToLabel(fromPos);
  const toCoord = coordinateToLabel(toPos);
  const destCoord = coordinateToLabel(effectivePos);

  const isOccupied = occupiedSet.has(`${effectivePos.x},${effectivePos.y}`);
  const occupyingUnit = isOccupied
    ? allUnits.find(u => u.position?.x === effectivePos.x && u.position?.y === effectivePos.y)
    : null;
  const isAdjacentToTarget = calculateDistance(effectivePos, toPos) <= 5;

  const handleConfirm = () => {
    if (isOccupied) return;

    let announcement = `${originUnit.name} moved ${effectiveMovedFeet} ft towards ${targetUnit.name} to ${destCoord}.`;
    if (isAdjacentToTarget) {
      announcement += ` Now adjacent to ${targetUnit.name}.`;
    } else if (preview.stoppedEarly && !manualPos) {
      announcement += ` Stopped at ${destCoord} to avoid collision.`;
    }
    onConfirmMove(effectivePos, effectiveMovedFeet, announcement);
  };

  return (
    <div
      className="modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="move-towards-title"
      style={{
        position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
        backgroundColor: 'rgba(0,0,0,0.75)', zIndex: 3200,
        display: 'flex', justifyContent: 'center', alignItems: 'center'
      }}
    >
      <div
        ref={modalContainerRef}
        className="modal-content"
        style={{
          backgroundColor: '#fff', color: '#111', padding: '1.5rem',
          borderRadius: '8px', width: '90%', maxWidth: '520px',
          maxHeight: '90vh', overflowY: 'auto',
          boxShadow: '0 4px 20px rgba(0,0,0,0.5)'
        }}
      >
        <h2 id="move-towards-title" ref={headingRef} tabIndex={-1} style={{ outline: 'none', marginTop: 0 }}>
          Move Towards {targetUnit.name}
        </h2>

        <p style={{ margin: '0 0 1rem 0', color: '#495057' }}>
          Moving <strong>{originUnit.name}</strong> (from {fromCoord}) towards <strong>{targetUnit.name}</strong> (at {toCoord}).
        </p>

        <div style={{ backgroundColor: '#f8f9fa', border: '1px solid #ced4da', borderRadius: '6px', padding: '0.75rem 1rem', marginBottom: '1rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.25rem' }}>
            <span>Distance to Target:</span>
            <strong>{totalDistance} ft</strong>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span>Creature Base Speed:</span>
            <strong>{maxSpeed} ft</strong>
          </div>
        </div>

        {/* Input for movement distance */}
        <div style={{ marginBottom: '1rem' }}>
          <label htmlFor="move-amount-input" style={{ display: 'block', fontWeight: 'bold', marginBottom: '0.5rem' }}>
            Movement Distance (feet):
          </label>
          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
            <input
              id="move-amount-input"
              type="number"
              min="0"
              step="5"
              value={moveAmount}
              onChange={e => {
                const val = parseInt(e.target.value, 10);
                setMoveAmount(isNaN(val) ? 0 : Math.max(0, val));
                setManualPos(null);
              }}
              style={{
                flex: 1,
                padding: '0.5rem',
                fontSize: '1.1rem',
                fontWeight: 'bold',
                borderRadius: '4px',
                border: '1px solid #ced4da'
              }}
            />
            <button
              type="button"
              onClick={() => {
                setMoveAmount(prev => Math.max(0, prev - 5));
                setManualPos(null);
              }}
              aria-label="Decrease distance by 5 feet"
              style={{ padding: '0.5rem 0.75rem', fontWeight: 'bold', cursor: 'pointer' }}
            >
              -5 ft
            </button>
            <button
              type="button"
              onClick={() => {
                setMoveAmount(prev => prev + 5);
                setManualPos(null);
              }}
              aria-label="Increase distance by 5 feet"
              style={{ padding: '0.5rem 0.75rem', fontWeight: 'bold', cursor: 'pointer' }}
            >
              +5 ft
            </button>
          </div>
        </div>

        {/* Quick Presets */}
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '1.25rem' }}>
          <button
            type="button"
            onClick={() => {
              setMoveAmount(defaultMoveAmount);
              setManualPos(null);
            }}
            style={{ padding: '0.3rem 0.6rem', fontSize: '0.85rem', cursor: 'pointer', backgroundColor: '#e9ecef', border: '1px solid #ced4da', borderRadius: '4px' }}
          >
            Default ({defaultMoveAmount} ft)
          </button>
          <button
            type="button"
            onClick={() => {
              setMoveAmount(maxSpeed);
              setManualPos(null);
            }}
            style={{ padding: '0.3rem 0.6rem', fontSize: '0.85rem', cursor: 'pointer', backgroundColor: '#e9ecef', border: '1px solid #ced4da', borderRadius: '4px' }}
          >
            Full Speed ({maxSpeed} ft)
          </button>
          <button
            type="button"
            onClick={() => {
              setMoveAmount(Math.max(0, totalDistance - 5));
              setManualPos(null);
            }}
            style={{ padding: '0.3rem 0.6rem', fontSize: '0.85rem', cursor: 'pointer', backgroundColor: '#e9ecef', border: '1px solid #ced4da', borderRadius: '4px' }}
          >
            Melee Range ({Math.max(0, totalDistance - 5)} ft)
          </button>
          <button
            type="button"
            onClick={() => {
              setMoveAmount(maxSpeed * 2);
              setManualPos(null);
            }}
            style={{ padding: '0.3rem 0.6rem', fontSize: '0.85rem', cursor: 'pointer', backgroundColor: '#e9ecef', border: '1px solid #ced4da', borderRadius: '4px' }}
          >
            Dash ({maxSpeed * 2} ft)
          </button>
        </div>

        {/* Destination Coordinate Fine-Tuning */}
        <div style={{ backgroundColor: '#f1f3f5', border: '1px solid #dee2e6', borderRadius: '6px', padding: '0.75rem 1rem', marginBottom: '1.25rem' }}>
          <div style={{ fontWeight: 'bold', marginBottom: '0.5rem' }}>
            Modify Destination Cell (Optional):
          </div>
          <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', alignItems: 'center' }}>
            <div>
              <label htmlFor="dest-col-select" style={{ fontSize: '0.85rem', marginRight: '0.35rem' }}>
                Column:
              </label>
              <select
                id="dest-col-select"
                value={effectivePos.x}
                onChange={e => {
                  const newX = parseInt(e.target.value, 10);
                  setManualPos({ x: newX, y: effectivePos.y });
                }}
                style={{ padding: '0.3rem 0.5rem', borderRadius: '4px', border: '1px solid #ced4da' }}
              >
                {Array.from({ length: mapSize.width }, (_, i) => (
                  <option key={i} value={i}>
                    {columnIndexToLabel(i)}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="dest-row-select" style={{ fontSize: '0.85rem', marginRight: '0.35rem' }}>
                Row:
              </label>
              <select
                id="dest-row-select"
                value={effectivePos.y}
                onChange={e => {
                  const newY = parseInt(e.target.value, 10);
                  setManualPos({ x: effectivePos.x, y: newY });
                }}
                style={{ padding: '0.3rem 0.5rem', borderRadius: '4px', border: '1px solid #ced4da' }}
              >
                {Array.from({ length: mapSize.height }, (_, i) => (
                  <option key={i} value={i}>
                    {i + 1}
                  </option>
                ))}
              </select>
            </div>
            {manualPos && (
              <button
                type="button"
                onClick={() => setManualPos(null)}
                style={{ padding: '0.3rem 0.6rem', fontSize: '0.8rem', cursor: 'pointer', backgroundColor: '#6c757d', color: '#fff', border: 'none', borderRadius: '4px' }}
              >
                Reset to Auto Path
              </button>
            )}
          </div>
        </div>

        {/* Dynamic Move Result Preview */}
        <div
          role="status"
          aria-live="polite"
          style={{
            backgroundColor: isOccupied ? '#f8d7da' : '#e7f1ff',
            border: `1px solid ${isOccupied ? '#f5c2c7' : '#b6d4fe'}`,
            color: isOccupied ? '#842029' : '#084298',
            padding: '0.75rem 1rem',
            borderRadius: '6px',
            marginBottom: '1.25rem',
            fontSize: '0.95rem'
          }}
        >
          <strong>Outcome: </strong>
          Will move {effectiveMovedFeet} ft to cell <strong>{destCoord}</strong>.
          {isOccupied && (
            <span style={{ display: 'block', marginTop: '0.25rem', fontWeight: 'bold' }}>
              ⚠ Cannot place at {destCoord}: Cell occupied by {occupyingUnit ? occupyingUnit.name : 'another creature'}.
            </span>
          )}
          {!isOccupied && isAdjacentToTarget && (
            <span style={{ display: 'block', marginTop: '0.25rem', fontWeight: 'bold', color: '#0f5132' }}>
              ✓ Reaches adjacent melee range with {targetUnit.name}.
            </span>
          )}
          {!isOccupied && !isAdjacentToTarget && preview.stoppedEarly && !manualPos && (
            <span style={{ display: 'block', marginTop: '0.25rem', color: '#664d03' }}>
              ⚠ Stopped early to avoid collision with occupied cell.
            </span>
          )}
        </div>

        {/* Action Buttons */}
        <div style={{ display: 'flex', gap: '0.75rem' }}>
          <button
            type="button"
            disabled={isOccupied}
            onClick={handleConfirm}
            style={{
              flex: 1,
              padding: '0.75rem',
              backgroundColor: isOccupied ? '#6c757d' : '#198754',
              color: '#fff',
              fontWeight: 'bold',
              border: 'none',
              borderRadius: '4px',
              cursor: isOccupied ? 'not-allowed' : 'pointer'
            }}
          >
            Confirm Move
          </button>
          <button
            type="button"
            onClick={onClose}
            style={{
              padding: '0.75rem 1.25rem',
              backgroundColor: '#6c757d',
              color: '#fff',
              fontWeight: 'bold',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer'
            }}
          >
            Cancel (Esc)
          </button>
        </div>
      </div>
    </div>
  );
}
