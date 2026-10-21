import { useState, useRef, useEffect, useMemo } from 'react';
import type { EncounterUnit, Position, MapSize } from '../types';
import {
  calculateDistance,
  coordinateToLabel,
  columnIndexToLabel,
  getCreatureSpeed,
  calculateMoveTowards
} from '../utils/mapUtils';
import { parseCellLabel } from '../shared/spatial/labels';

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
  const [destDraft, setDestDraft] = useState<string | null>(null);
  const clearManual = () => { setManualPos(null); setDestDraft(null); };
  const [prevKey, setPrevKey] = useState(`${originUnit.instanceId}-${targetUnit.instanceId}-${defaultMoveAmount}`);

  // Adjust default move amount whenever origin or target changes
  const currentKey = `${originUnit.instanceId}-${targetUnit.instanceId}-${defaultMoveAmount}`;
  if (prevKey !== currentKey) {
    setPrevKey(currentKey);
    setMoveAmount(defaultMoveAmount);
    clearManual();
  }

  useEffect(() => {
    if (isOpen) {
      headingRef.current?.focus();
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

  const destInvalid = destDraft !== null;
  const isOccupied = occupiedSet.has(`${effectivePos.x},${effectivePos.y}`);
  const occupyingUnit = isOccupied
    ? allUnits.find(u => u.position?.x === effectivePos.x && u.position?.y === effectivePos.y)
    : null;
  const isAdjacentToTarget = calculateDistance(effectivePos, toPos) <= 5;

  const handleConfirm = () => {
    if (isOccupied || destInvalid) return;

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
                clearManual();
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
                clearManual();
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
                clearManual();
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
              clearManual();
            }}
            style={{ padding: '0.3rem 0.6rem', fontSize: '0.85rem', cursor: 'pointer', backgroundColor: '#e9ecef', border: '1px solid #ced4da', borderRadius: '4px' }}
          >
            Default ({defaultMoveAmount} ft)
          </button>
          <button
            type="button"
            onClick={() => {
              setMoveAmount(maxSpeed);
              clearManual();
            }}
            style={{ padding: '0.3rem 0.6rem', fontSize: '0.85rem', cursor: 'pointer', backgroundColor: '#e9ecef', border: '1px solid #ced4da', borderRadius: '4px' }}
          >
            Full Speed ({maxSpeed} ft)
          </button>
          <button
            type="button"
            onClick={() => {
              setMoveAmount(Math.max(0, totalDistance - 5));
              clearManual();
            }}
            style={{ padding: '0.3rem 0.6rem', fontSize: '0.85rem', cursor: 'pointer', backgroundColor: '#e9ecef', border: '1px solid #ced4da', borderRadius: '4px' }}
          >
            Melee Range ({Math.max(0, totalDistance - 5)} ft)
          </button>
          <button
            type="button"
            onClick={() => {
              setMoveAmount(maxSpeed * 2);
              clearManual();
            }}
            style={{ padding: '0.3rem 0.6rem', fontSize: '0.85rem', cursor: 'pointer', backgroundColor: '#e9ecef', border: '1px solid #ced4da', borderRadius: '4px' }}
          >
            Dash ({maxSpeed * 2} ft)
          </button>
        </div>

        {/* Destination Coordinate Fine-Tuning */}
        <div style={{ backgroundColor: '#f1f3f5', border: '1px solid #dee2e6', borderRadius: '6px', padding: '0.75rem 1rem', marginBottom: '1.25rem' }}>
          <div style={{ fontWeight: 'bold', marginBottom: '0.5rem' }}>
            Modify Destination Cell (Optional)
          </div>
          <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', alignItems: 'center' }}>
            <div>
              <label htmlFor="dest-cell-input" style={{ fontSize: '0.85rem', marginRight: '0.35rem' }}>
                Destination Cell (for example C4):
              </label>
              <input
                id="dest-cell-input"
                type="text"
                value={destDraft ?? destCoord}
                aria-invalid={destInvalid}
                aria-describedby={destInvalid ? 'dest-cell-error' : undefined}
                onChange={e => {
                  const text = e.target.value;
                  const cell = parseCellLabel(text);
                  if (cell && cell.x < mapSize.width && cell.y < mapSize.height) {
                    setManualPos(cell);
                    setDestDraft(null);
                  } else {
                    setDestDraft(text);
                  }
                }}
                style={{ padding: '0.3rem 0.5rem', borderRadius: '4px', border: '1px solid #ced4da', width: '6rem' }}
              />
            </div>
            {destInvalid && (
              <div id="dest-cell-error" role="alert" style={{ color: '#842029', fontWeight: 'bold' }}>
                Enter a cell on the map, from A1 to {columnIndexToLabel(mapSize.width - 1)}{mapSize.height}.
              </div>
            )}
            {manualPos && (
              <button
                type="button"
                onClick={() => clearManual()}
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
            disabled={isOccupied || destInvalid}
            onClick={handleConfirm}
            style={{
              flex: 1,
              padding: '0.75rem',
              backgroundColor: isOccupied || destInvalid ? '#6c757d' : '#198754',
              color: '#fff',
              fontWeight: 'bold',
              border: 'none',
              borderRadius: '4px',
              cursor: isOccupied || destInvalid ? 'not-allowed' : 'pointer'
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
