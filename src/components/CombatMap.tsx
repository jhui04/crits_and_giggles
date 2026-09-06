import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import type { EncounterUnit, Position, MapSize } from '../types';
import {
  calculateDistance,
  columnIndexToLabel,
  coordinateToLabel
} from '../utils/mapUtils';
import { NearbyEntitiesModal } from './NearbyEntitiesModal';
import { CreatureJumpModal } from './CreatureJumpModal';
import { UnitActionModal } from './UnitActionModal';

interface CombatMapProps {
  units: EncounterUnit[];
  mapSize?: MapSize;
  activeTurnUnitId?: string;
  onUpdateUnitPosition: (instanceId: string, newPos: Position) => void;
  onOpenOperations?: (unit: EncounterUnit) => void;
  onOpenDetails?: (unit: EncounterUnit) => void;
  externalRadarUnit?: EncounterUnit | null;
  onResetExternalRadarUnit?: () => void;
}

const DEFAULT_MAP_SIZE: MapSize = { width: 20, height: 20 };

export function CombatMap({
  units,
  mapSize = DEFAULT_MAP_SIZE,
  activeTurnUnitId,
  onUpdateUnitPosition,
  onOpenOperations,
  onOpenDetails,
  externalRadarUnit,
  onResetExternalRadarUnit
}: CombatMapProps) {
  const [focusedCell, setFocusedCell] = useState<Position>({ x: 0, y: 0 });
  const [moveModeUnit, setMoveModeUnit] = useState<EncounterUnit | null>(null);
  const [moveOrigin, setMoveOrigin] = useState<Position | null>(null);
  const [liveAnnouncement, setLiveAnnouncement] = useState<string>('');
  const [isRadarOpen, setIsRadarOpen] = useState(false);
  const [radarOriginUnit, setRadarOriginUnit] = useState<EncounterUnit | null>(null);
  const [isJumpOpen, setIsJumpOpen] = useState(false);

  // Unit Action Modal state (menu when clicking/pressing Enter on monster/unit)
  const [actionModalUnit, setActionModalUnit] = useState<EncounterUnit | null>(null);
  const [actionModalPos, setActionModalPos] = useState<Position | null>(null);
  const [isActionModalOpen, setIsActionModalOpen] = useState(false);

  const tableRef = useRef<HTMLTableElement>(null);
  const mapSectionRef = useRef<HTMLElement>(null);
  const radarTriggerRef = useRef<HTMLButtonElement>(null);
  const jumpTriggerRef = useRef<HTMLButtonElement>(null);
  const focusBoardTriggerRef = useRef<HTMLButtonElement>(null);
  const isInternalFocusChange = useRef(false);

  // Lookup map: `${x},${y}` -> EncounterUnit
  const unitByCoord = useMemo(() => {
    const map = new Map<string, EncounterUnit>();
    units.forEach(u => {
      if (u.position) {
        map.set(`${u.position.x},${u.position.y}`, u);
      }
    });
    return map;
  }, [units]);

  // All occupied cells sorted in board reading order
  const occupiedCells = useMemo(() => {
    return units
      .filter(u => !!u.position)
      .map(u => u.position!)
      .sort((a, b) => (a.y === b.y ? a.x - b.x : a.y - b.y));
  }, [units]);

  const focusedOccupant = unitByCoord.get(`${focusedCell.x},${focusedCell.y}`) || null;

  const openRadarForUnit = useCallback((unitOverride?: EncounterUnit | null) => {
    const candidate =
      unitOverride ||
      focusedOccupant ||
      units.find(u => u.instanceId === activeTurnUnitId) ||
      units.find(u => !u.isPlayer && !!u.position) ||
      units.find(u => !!u.position) ||
      null;
    setRadarOriginUnit(candidate);
    setIsRadarOpen(true);
  }, [focusedOccupant, units, activeTurnUnitId]);

  useEffect(() => {
    if (externalRadarUnit) {
      openRadarForUnit(externalRadarUnit);
      onResetExternalRadarUnit?.();
    }
  }, [externalRadarUnit, onResetExternalRadarUnit, openRadarForUnit]);

  // Focus the active cell DOM element when focusedCell updates
  useEffect(() => {
    if (isInternalFocusChange.current) {
      const cellEl = tableRef.current?.querySelector<HTMLTableCellElement>(
        `[data-cell="${focusedCell.x}-${focusedCell.y}"]`
      );
      cellEl?.focus();
      isInternalFocusChange.current = false;
    }
  }, [focusedCell]);

  // Global keyboard shortcuts: Alt+B (Focus Board), Alt+E (Radar), Alt+J (Jump)
  useEffect(() => {
    const handleGlobalShortcuts = (e: KeyboardEvent) => {
      if (e.altKey && e.key.toLowerCase() === 'b') {
        e.preventDefault();
        const cellEl = tableRef.current?.querySelector<HTMLTableCellElement>(
          `[data-cell="${focusedCell.x}-${focusedCell.y}"]`
        );
        cellEl?.focus();
        setLiveAnnouncement(`Combat Map board focused at cell ${coordinateToLabel(focusedCell)}.`);
      } else if (e.altKey && e.key.toLowerCase() === 'e') {
        e.preventDefault();
        openRadarForUnit();
      } else if (e.altKey && e.key.toLowerCase() === 'j') {
        e.preventDefault();
        setIsJumpOpen(prev => !prev);
      }
    };
    window.addEventListener('keydown', handleGlobalShortcuts);
    return () => window.removeEventListener('keydown', handleGlobalShortcuts);
  }, [focusedCell, openRadarForUnit]);

  const moveFocusTo = useCallback((newPos: Position) => {
    const clampedX = Math.max(0, Math.min(mapSize.width - 1, newPos.x));
    const clampedY = Math.max(0, Math.min(mapSize.height - 1, newPos.y));
    isInternalFocusChange.current = true;
    setFocusedCell({ x: clampedX, y: clampedY });

    const coord = coordinateToLabel({ x: clampedX, y: clampedY });
    const occupant = unitByCoord.get(`${clampedX},${clampedY}`);

    if (moveModeUnit && moveOrigin) {
      const dist = calculateDistance(moveOrigin, { x: clampedX, y: clampedY });
      const occupancyNote = occupant && occupant.instanceId !== moveModeUnit.instanceId
        ? ` (Occupied by ${occupant.name})`
        : '';
      setLiveAnnouncement(`Moved ${moveModeUnit.name} to ${coord}${occupancyNote}. ${dist} ft from start. Press Enter to place.`);
    } else {
      if (occupant) {
        const role = occupant.isPlayer ? 'Player' : 'Monster';
        const hp = occupant.currentHp !== undefined ? `, ${occupant.currentHp} of ${occupant.maxHp ?? '?'} HP` : '';
        const turnNote = occupant.instanceId === activeTurnUnitId ? ', Active Turn' : '';
        setLiveAnnouncement(`${coord}: ${occupant.name} (${role})${hp}${turnNote}. Press Enter for menu.`);
      } else {
        setLiveAnnouncement(`${coord}, Empty`);
      }
    }
  }, [mapSize.width, mapSize.height, moveModeUnit, moveOrigin, unitByCoord, activeTurnUnitId]);

  // Jump to Next / Previous occupied cell
  const jumpToOccupied = useCallback((forward: boolean) => {
    if (occupiedCells.length === 0) return;
    const currentIndex = occupiedCells.findIndex(
      pos => pos.x === focusedCell.x && pos.y === focusedCell.y
    );

    let nextIndex: number;
    if (currentIndex === -1) {
      nextIndex = forward ? 0 : occupiedCells.length - 1;
    } else {
      nextIndex = forward
        ? (currentIndex + 1) % occupiedCells.length
        : (currentIndex - 1 + occupiedCells.length) % occupiedCells.length;
    }

    moveFocusTo(occupiedCells[nextIndex]);
  }, [occupiedCells, focusedCell, moveFocusTo]);

  // Jump focus to current turn combatant
  const jumpToActiveCombatant = useCallback(() => {
    if (!activeTurnUnitId) return;
    const activeUnit = units.find(u => u.instanceId === activeTurnUnitId);
    if (activeUnit?.position) {
      moveFocusTo(activeUnit.position);
      setLiveAnnouncement(`Focused on active turn: ${activeUnit.name} at ${coordinateToLabel(activeUnit.position)}.`);
    }
  }, [activeTurnUnitId, units, moveFocusTo]);

  const handleStartMoveMode = (unit: EncounterUnit) => {
    if (!unit.position) return;
    setMoveModeUnit(unit);
    setMoveOrigin(unit.position);
    setFocusedCell(unit.position);
    isInternalFocusChange.current = true;
    setLiveAnnouncement(
      `Move mode started for ${unit.name} at ${coordinateToLabel(unit.position)}. Use arrow keys to navigate around the board, Enter to confirm, Escape to cancel.`
    );
  };

  const handleConfirmMove = (targetPos?: Position) => {
    if (!moveModeUnit || !moveOrigin) return;
    const dest = targetPos || focusedCell;

    // Check if target cell is occupied by a different unit
    const occupant = unitByCoord.get(`${dest.x},${dest.y}`);
    if (occupant && occupant.instanceId !== moveModeUnit.instanceId) {
      setLiveAnnouncement(
        `Cannot place ${moveModeUnit.name} at ${coordinateToLabel(dest)}: Space occupied by ${occupant.name}.`
      );
      return;
    }

    const dist = calculateDistance(moveOrigin, dest);
    onUpdateUnitPosition(moveModeUnit.instanceId, dest);
    setLiveAnnouncement(
      `${moveModeUnit.name} placed at ${coordinateToLabel(dest)}. Moved ${dist} feet.`
    );
    setMoveModeUnit(null);
    setMoveOrigin(null);
  };

  const handleCancelMove = () => {
    if (!moveModeUnit || !moveOrigin) return;
    moveFocusTo(moveOrigin);
    setLiveAnnouncement(
      `Move cancelled. ${moveModeUnit.name} returned to ${coordinateToLabel(moveOrigin)}.`
    );
    setMoveModeUnit(null);
    setMoveOrigin(null);
  };

  // Opens action menu for a given unit
  const openUnitActionMenu = (unit: EncounterUnit, pos: Position) => {
    setActionModalUnit(unit);
    setActionModalPos(pos);
    setIsActionModalOpen(true);
  };

  // Cell click handler
  const handleCellClick = (pos: Position) => {
    if (moveModeUnit) {
      moveFocusTo(pos);
      handleConfirmMove(pos);
    } else {
      moveFocusTo(pos);
      const occupant = unitByCoord.get(`${pos.x},${pos.y}`);
      if (occupant) {
        openUnitActionMenu(occupant, pos);
      }
    }
  };

  // Cell keyboard listener
  const handleCellKeyDown = (e: React.KeyboardEvent<HTMLTableCellElement>, pos: Position) => {
    // Arrow Navigation around board
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      moveFocusTo({ x: pos.x, y: pos.y - 1 });
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      moveFocusTo({ x: pos.x, y: pos.y + 1 });
      return;
    }
    if (e.key === 'ArrowLeft') {
      e.preventDefault();
      moveFocusTo({ x: pos.x - 1, y: pos.y });
      return;
    }
    if (e.key === 'ArrowRight') {
      e.preventDefault();
      moveFocusTo({ x: pos.x + 1, y: pos.y });
      return;
    }

    // ARIA Grid Bounds Keys
    if (e.key === 'Home') {
      e.preventDefault();
      if (e.ctrlKey) {
        moveFocusTo({ x: 0, y: 0 });
      } else {
        moveFocusTo({ x: 0, y: pos.y });
      }
      return;
    }
    if (e.key === 'End') {
      e.preventDefault();
      if (e.ctrlKey) {
        moveFocusTo({ x: mapSize.width - 1, y: mapSize.height - 1 });
      } else {
        moveFocusTo({ x: mapSize.width - 1, y: pos.y });
      }
      return;
    }

    // Quick creature cycle
    if (e.key === ']' || (e.key === 'n' && !e.altKey && !e.ctrlKey)) {
      e.preventDefault();
      jumpToOccupied(true);
      return;
    }
    if (e.key === '[' || (e.key === 'p' && !e.altKey && !e.ctrlKey)) {
      e.preventDefault();
      jumpToOccupied(false);
      return;
    }

    // Quick single-key triggers on occupied cells
    const occupant = unitByCoord.get(`${pos.x},${pos.y}`);
    if (occupant && !moveModeUnit) {
      if (e.key.toLowerCase() === 'm') {
        e.preventDefault();
        handleStartMoveMode(occupant);
        return;
      }
      if (e.key.toLowerCase() === 'a' && onOpenOperations && !occupant.isPlayer) {
        e.preventDefault();
        onOpenOperations(occupant);
        return;
      }
      if (e.key.toLowerCase() === 'd' && onOpenDetails) {
        e.preventDefault();
        onOpenDetails(occupant);
        return;
      }
    }

    // Enter / Space: In move mode confirms move, otherwise opens Action Menu for occupied cell
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      if (moveModeUnit) {
        handleConfirmMove();
      } else if (occupant) {
        openUnitActionMenu(occupant, pos);
      }
      return;
    }

    // Escape cancels move mode
    if (e.key === 'Escape') {
      if (moveModeUnit) {
        e.preventDefault();
        e.stopPropagation();
        handleCancelMove();
      }
    }
  };

  return (
    <section
      ref={mapSectionRef}
      aria-labelledby="map-heading"
      className="combat-map-section"
      style={{
        marginTop: '2rem',
        padding: '1.5rem',
        backgroundColor: '#1a1d20',
        color: '#f8f9fa',
        borderRadius: '8px',
        border: '1px solid #343a40'
      }}
    >
      {/* Accessible Live Region for Screen Reader Announcements */}
      <div
        aria-live="polite"
        className="sr-only"
        style={{ position: 'absolute', width: '1px', height: '1px', overflow: 'hidden', clip: 'rect(0,0,0,0)' }}
      >
        {liveAnnouncement}
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', gap: '0.75rem' }}>
        <div>
          <h2 id="map-heading" style={{ margin: 0, fontSize: '1.4rem' }}>
            Combat Map ({mapSize.width * 5}x{mapSize.height * 5} ft)
          </h2>
          <span style={{ fontSize: '0.85rem', color: '#adb5bd' }}>
            Grid coordinates A1 to {coordinateToLabel({ x: mapSize.width - 1, y: mapSize.height - 1 })}. Use arrow keys to navigate. Click or press Enter on a monster for its menu.
          </span>
        </div>

        {/* Toolbar Controls */}
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          <button
            ref={focusBoardTriggerRef}
            type="button"
            onClick={() => {
              isInternalFocusChange.current = true;
              setFocusedCell({ ...focusedCell });
            }}
            style={{ padding: '0.4rem 0.8rem', cursor: 'pointer', backgroundColor: '#198754', color: '#fff', fontWeight: 'bold', border: 'none', borderRadius: '4px' }}
          >
            Focus Board (Alt+B)
          </button>
          {activeTurnUnitId && (
            <button
              type="button"
              onClick={jumpToActiveCombatant}
              style={{ padding: '0.4rem 0.8rem', cursor: 'pointer', backgroundColor: '#e0a800', color: '#000', fontWeight: 'bold', border: 'none', borderRadius: '4px' }}
            >
              Focus Active Turn
            </button>
          )}
          <button
            ref={jumpTriggerRef}
            type="button"
            onClick={() => setIsJumpOpen(true)}
            style={{ padding: '0.4rem 0.8rem', cursor: 'pointer', backgroundColor: '#495057', color: '#fff', border: '1px solid #6c757d', borderRadius: '4px' }}
          >
            Jump to Creature (Alt+J)
          </button>
          <button
            ref={radarTriggerRef}
            type="button"
            onClick={() => openRadarForUnit()}
            style={{ padding: '0.4rem 0.8rem', cursor: 'pointer', backgroundColor: '#0d6efd', color: '#fff', fontWeight: 'bold', border: 'none', borderRadius: '4px' }}
          >
            Radar Scan (Alt+E)
          </button>
        </div>
      </div>

      {/* Directional Pad Navigation Toolbar */}
      <div
        role="group"
        aria-label="Directional Navigation Controls"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '0.5rem',
          marginBottom: '0.75rem',
          flexWrap: 'wrap',
          backgroundColor: '#23272b',
          padding: '0.5rem 0.75rem',
          borderRadius: '4px'
        }}
      >
        <span style={{ fontSize: '0.85rem', color: '#ced4da', marginRight: '0.5rem' }}>
          Arrow Controls:
        </span>
        <button
          type="button"
          onClick={() => moveFocusTo({ x: focusedCell.x, y: focusedCell.y - 1 })}
          aria-label="Move Up (North)"
          style={{ padding: '0.3rem 0.6rem', cursor: 'pointer', backgroundColor: '#343a40', color: '#fff', border: '1px solid #495057', borderRadius: '4px' }}
        >
          ▲ Up
        </button>
        <button
          type="button"
          onClick={() => moveFocusTo({ x: focusedCell.x, y: focusedCell.y + 1 })}
          aria-label="Move Down (South)"
          style={{ padding: '0.3rem 0.6rem', cursor: 'pointer', backgroundColor: '#343a40', color: '#fff', border: '1px solid #495057', borderRadius: '4px' }}
        >
          ▼ Down
        </button>
        <button
          type="button"
          onClick={() => moveFocusTo({ x: focusedCell.x - 1, y: focusedCell.y })}
          aria-label="Move Left (West)"
          style={{ padding: '0.3rem 0.6rem', cursor: 'pointer', backgroundColor: '#343a40', color: '#fff', border: '1px solid #495057', borderRadius: '4px' }}
        >
          ◀ Left
        </button>
        <button
          type="button"
          onClick={() => moveFocusTo({ x: focusedCell.x + 1, y: focusedCell.y })}
          aria-label="Move Right (East)"
          style={{ padding: '0.3rem 0.6rem', cursor: 'pointer', backgroundColor: '#343a40', color: '#fff', border: '1px solid #495057', borderRadius: '4px' }}
        >
          ▶ Right
        </button>
        <span style={{ fontSize: '0.85rem', color: '#ffc107', marginLeft: 'auto' }}>
          Current: <strong>{coordinateToLabel(focusedCell)}</strong> {focusedOccupant ? `(${focusedOccupant.name})` : '(Empty)'}
        </span>
      </div>

      {/* Move Mode Active Banner */}
      {moveModeUnit && (
        <div
          role="status"
          style={{
            backgroundColor: '#ffc107',
            color: '#212529',
            padding: '0.75rem 1rem',
            borderRadius: '4px',
            marginBottom: '1rem',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            fontWeight: 'bold'
          }}
        >
          <span>
            Moving {moveModeUnit.name}: currently at {coordinateToLabel(focusedCell)} ({moveOrigin ? calculateDistance(moveOrigin, focusedCell) : 0} ft from start).
          </span>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button
              type="button"
              onClick={() => handleConfirmMove()}
              style={{ backgroundColor: '#198754', color: '#fff', border: 'none', padding: '0.3rem 0.8rem', borderRadius: '4px', cursor: 'pointer' }}
            >
              Confirm Move (Enter)
            </button>
            <button
              type="button"
              onClick={handleCancelMove}
              style={{ backgroundColor: '#dc3545', color: '#fff', border: 'none', padding: '0.3rem 0.8rem', borderRadius: '4px', cursor: 'pointer' }}
            >
              Cancel (Esc)
            </button>
          </div>
        </div>
      )}

      {/* Selected Cell Action Helper Bar */}
      {focusedOccupant && !moveModeUnit && (
        <div
          style={{
            backgroundColor: '#2b3035',
            padding: '0.5rem 1rem',
            borderRadius: '4px',
            marginBottom: '0.75rem',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            border: '1px solid #495057'
          }}
        >
          <div>
            <strong>{focusedOccupant.name}</strong> at {coordinateToLabel(focusedCell)} • {focusedOccupant.isPlayer ? 'Player' : 'Monster'} • {focusedOccupant.currentHp ?? '?'}/{focusedOccupant.maxHp ?? '?'} HP
            {focusedOccupant.instanceId === activeTurnUnitId && <span style={{ color: '#ffc107', marginLeft: '0.5rem' }}>★ Active Turn</span>}
          </div>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button
              type="button"
              onClick={() => openUnitActionMenu(focusedOccupant, focusedCell)}
              style={{ padding: '0.25rem 0.6rem', fontSize: '0.85rem', cursor: 'pointer', backgroundColor: '#0d6efd', color: '#fff', fontWeight: 'bold', border: 'none', borderRadius: '4px' }}
            >
              Open Menu (Enter)
            </button>
            <button
              type="button"
              onClick={() => handleStartMoveMode(focusedOccupant)}
              style={{ padding: '0.25rem 0.6rem', fontSize: '0.85rem', cursor: 'pointer', backgroundColor: '#495057', color: '#fff', border: 'none', borderRadius: '4px' }}
            >
              Move (M)
            </button>
            {onOpenOperations && !focusedOccupant.isPlayer && (
              <button
                type="button"
                onClick={() => onOpenOperations(focusedOccupant)}
                style={{ padding: '0.25rem 0.6rem', fontSize: '0.85rem', cursor: 'pointer', backgroundColor: '#dc3545', color: '#fff', border: 'none', borderRadius: '4px' }}
              >
                Actions (A)
              </button>
            )}
            {onOpenDetails && (
              <button
                type="button"
                onClick={() => onOpenDetails(focusedOccupant)}
                style={{ padding: '0.25rem 0.6rem', fontSize: '0.85rem', cursor: 'pointer', backgroundColor: '#6c757d', color: '#fff', border: 'none', borderRadius: '4px' }}
              >
                Details (D)
              </button>
            )}
          </div>
        </div>
      )}

      {/* ARIA Grid Container */}
      <div style={{ overflowX: 'auto', border: '2px solid #495057', borderRadius: '6px', backgroundColor: '#121416' }}>
        <table
          ref={tableRef}
          role="grid"
          aria-label="Combat Map"
          aria-rowcount={mapSize.height}
          aria-colcount={mapSize.width}
          style={{
            borderCollapse: 'collapse',
            margin: '0 auto',
            tableLayout: 'fixed'
          }}
        >
          <thead>
            <tr role="row">
              {/* Corner Empty Header */}
              <th scope="col" style={{ width: '38px', height: '32px', backgroundColor: '#212529', border: '1px solid #343a40' }}>
                <span className="sr-only">Coordinates</span>
              </th>
              {Array.from({ length: mapSize.width }, (_, colIdx) => (
                <th
                  key={colIdx}
                  scope="col"
                  style={{
                    width: '42px',
                    height: '32px',
                    backgroundColor: '#212529',
                    color: '#ced4da',
                    fontSize: '0.75rem',
                    textAlign: 'center',
                    border: '1px solid #343a40'
                  }}
                >
                  {columnIndexToLabel(colIdx)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: mapSize.height }, (_, rowIdx) => (
              <tr key={rowIdx} role="row" aria-rowindex={rowIdx + 1}>
                {/* Row Header Number */}
                <th
                  scope="row"
                  style={{
                    width: '38px',
                    height: '42px',
                    backgroundColor: '#212529',
                    color: '#ced4da',
                    fontSize: '0.75rem',
                    textAlign: 'center',
                    border: '1px solid #343a40'
                  }}
                >
                  {rowIdx + 1}
                </th>

                {/* Grid Cells */}
                {Array.from({ length: mapSize.width }, (_, colIdx) => {
                  const pos: Position = { x: colIdx, y: rowIdx };
                  const coordLabel = coordinateToLabel(pos);
                  const isFocused = focusedCell.x === colIdx && focusedCell.y === rowIdx;
                  const occupant = unitByCoord.get(`${colIdx},${rowIdx}`);
                  const isMovingThis = moveModeUnit && occupant?.instanceId === moveModeUnit.instanceId;
                  const isActiveTurn = occupant && occupant.instanceId === activeTurnUnitId;

                  // Build Accessible Label
                  let cellAriaLabel = coordLabel;
                  if (occupant) {
                    const role = occupant.isPlayer ? 'Player' : 'Monster';
                    const hp = occupant.currentHp !== undefined ? `${occupant.currentHp} of ${occupant.maxHp ?? '?'} HP` : '';
                    const activePrefix = isActiveTurn ? 'Active Turn, ' : '';
                    const movingPrefix = isMovingThis ? 'Moving ' : '';
                    cellAriaLabel = `${coordLabel}: ${activePrefix}${movingPrefix}${occupant.name} (${role}), ${hp}. Press Enter for menu.`;
                  } else {
                    cellAriaLabel = `${coordLabel}, Empty`;
                  }

                  // Visual indicator styling
                  let cellBg = '#16191c';
                  let cellBorder = '1px solid #2b3035';
                  if (isFocused) {
                    cellBorder = '3px solid #ffc107';
                  }

                  return (
                    <td
                      key={colIdx}
                      role="gridcell"
                      data-cell={`${colIdx}-${rowIdx}`}
                      aria-colindex={colIdx + 1}
                      aria-label={cellAriaLabel}
                      tabIndex={isFocused ? 0 : -1}
                      onClick={() => handleCellClick(pos)}
                      onKeyDown={e => handleCellKeyDown(e, pos)}
                      style={{
                        width: '42px',
                        height: '42px',
                        textAlign: 'center',
                        verticalAlign: 'middle',
                        cursor: 'pointer',
                        position: 'relative',
                        backgroundColor: cellBg,
                        border: cellBorder,
                        padding: 0,
                        outline: 'none',
                        boxSizing: 'border-box'
                      }}
                    >
                      {occupant ? (
                        <>
                          <div
                            aria-hidden="true"
                            style={{
                              width: '32px',
                              height: '32px',
                              margin: '0 auto',
                              borderRadius: '50%',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              fontWeight: 'bold',
                              fontSize: '0.8rem',
                              color: '#fff',
                              backgroundColor: occupant.isPlayer ? '#0d6efd' : '#dc3545',
                              border: isActiveTurn ? '2px solid #ffc107' : '1px solid rgba(255,255,255,0.4)',
                              boxShadow: isFocused ? '0 0 8px rgba(255,193,7,0.8)' : undefined
                            }}
                            title={`${occupant.name} (${coordLabel}) - Click for options`}
                          >
                            {occupant.name.slice(0, 2).toUpperCase()}
                          </div>
                          {/* Explicit screen reader text so assistive tech never reads raw dots or letters */}
                          <span className="sr-only">
                            {cellAriaLabel}
                          </span>
                        </>
                      ) : (
                        <>
                          {/* Middle dot is explicitly aria-hidden so screen readers never say "middle dot" */}
                          <span
                            aria-hidden="true"
                            style={{
                              fontSize: '0.65rem',
                              color: '#343a40',
                              userSelect: 'none'
                            }}
                          >
                            ·
                          </span>
                          <span className="sr-only">Empty</span>
                        </>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Unit Action Menu Modal (Opens when clicking or pressing Enter on a monster/unit) */}
      <UnitActionModal
        isOpen={isActionModalOpen}
        unit={actionModalUnit}
        position={actionModalPos}
        onClose={() => {
          setIsActionModalOpen(false);
          const cellToFocus = actionModalPos || focusedCell;
          setActionModalUnit(null);
          setActionModalPos(null);
          // Restore focus to the cell that opened the menu
          setTimeout(() => {
            const cellEl = tableRef.current?.querySelector<HTMLTableCellElement>(
              `[data-cell="${cellToFocus.x}-${cellToFocus.y}"]`
            );
            cellEl?.focus();
          }, 50);
        }}
        onStartMove={unit => {
          handleStartMoveMode(unit);
        }}
        onOpenOperations={onOpenOperations}
        onOpenDetails={onOpenDetails}
        onOpenRadar={unit => {
          openRadarForUnit(unit);
        }}
      />

      {/* Nearby Entities Modal */}
      <NearbyEntitiesModal
        isOpen={isRadarOpen}
        originUnit={radarOriginUnit || focusedOccupant}
        originPosition={radarOriginUnit?.position || focusedCell}
        allUnits={units}
        mapSize={mapSize}
        onConfirmMoveTowards={(newPos, _movedFeet, announcement, movingUnitId) => {
          const unitIdToMove = movingUnitId || radarOriginUnit?.instanceId || focusedOccupant?.instanceId;
          if (unitIdToMove) {
            onUpdateUnitPosition(unitIdToMove, newPos);
          }
          setIsRadarOpen(false);
          setRadarOriginUnit(null);
          const clampedX = Math.max(0, Math.min(mapSize.width - 1, newPos.x));
          const clampedY = Math.max(0, Math.min(mapSize.height - 1, newPos.y));
          setFocusedCell({ x: clampedX, y: clampedY });
          setLiveAnnouncement(announcement);

          // Return focus to the map point where creature moved
          setTimeout(() => {
            const cellEl = tableRef.current?.querySelector<HTMLTableCellElement>(
              `[data-cell="${newPos.x}-${newPos.y}"]`
            );
            cellEl?.focus();
          }, 50);
        }}
        onClose={() => {
          setIsRadarOpen(false);
          setRadarOriginUnit(null);
          // Restore focus to radar trigger button
          setTimeout(() => radarTriggerRef.current?.focus(), 50);
        }}
      />

      {/* Creature Jump Modal */}
      <CreatureJumpModal
        isOpen={isJumpOpen}
        units={units}
        onSelect={targetPos => {
          setIsJumpOpen(false);
          moveFocusTo(targetPos);
          setLiveAnnouncement(`Jumped map focus to ${coordinateToLabel(targetPos)}.`);
        }}
        onClose={() => {
          setIsJumpOpen(false);
          // Restore focus to jump trigger button
          setTimeout(() => jumpTriggerRef.current?.focus(), 0);
        }}
      />
    </section>
  );
}
