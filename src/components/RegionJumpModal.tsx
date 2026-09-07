import React, { useRef, useEffect, useMemo } from 'react';
import type { Position, MapSize, MapRegion } from '../types';
import { coordinateToLabel, sortRegionsByLocation } from '../utils/mapUtils';

interface RegionJumpModalProps {
  isOpen: boolean;
  regions: MapRegion[];
  mapSize?: MapSize;
  onSelect: (position: Position, region: MapRegion) => void;
  onClose: () => void;
}

export function RegionJumpModal({
  isOpen,
  regions,
  mapSize,
  onSelect,
  onClose
}: RegionJumpModalProps) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  const firstItemRef = useRef<HTMLButtonElement>(null);
  const modalContentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isOpen) {
      setTimeout(() => {
        headingRef.current?.focus();
      }, 0);
    }
  }, [isOpen]);

  // Sort regions geographically: North to South, West to East
  const sortedRegions = useMemo(() => {
    return sortRegionsByLocation(regions, mapSize);
  }, [regions, mapSize]);

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

  return (
    <div
      className="modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="Jump to Region"
      aria-labelledby="region-jump-title"
      onKeyDown={handleKeyDown}
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: 'rgba(0,0,0,0.7)',
        zIndex: 3000,
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center'
      }}
    >
      <div
        ref={modalContentRef}
        className="modal-content"
        style={{
          backgroundColor: '#fff',
          color: '#111',
          padding: '1.5rem',
          borderRadius: '8px',
          width: '90%',
          maxWidth: '560px',
          maxHeight: '85vh',
          display: 'flex',
          flexDirection: 'column',
          boxShadow: '0 4px 20px rgba(0,0,0,0.5)'
        }}
      >
        <h2
          id="region-jump-title"
          ref={headingRef}
          tabIndex={-1}
          style={{ outline: 'none', marginTop: 0 }}
        >
          Jump to Region
        </h2>

        <p style={{ margin: '0 0 1rem 0', color: '#555', fontSize: '0.9rem' }}>
          Select a battlemap region to teleport cursor focus directly to its center point. Regions are organized in geographic order from North to South.
        </p>

        <div style={{ overflowY: 'auto', flex: 1, marginBottom: '1rem' }}>
          {sortedRegions.length === 0 ? (
            <p>No designated regions found for this battlemap.</p>
          ) : (
            <ul style={{ listStyle: 'none', padding: 0, margin: 0 }} role="list">
              {sortedRegions.map(({ region, center, sector }, index) => {
                const coord = coordinateToLabel(center);
                const idTag = region.id && region.id !== 'ocean' ? ` (${region.id})` : '';
                const cellCountText = region.cells ? `${region.cells.length} cells` : '';

                return (
                  <li key={region.id || region.name} style={{ marginBottom: '0.5rem' }}>
                    <button
                      ref={index === 0 ? firstItemRef : null}
                      type="button"
                      onClick={() => onSelect(center, region)}
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
                        <strong>{region.name}</strong>
                        {idTag && (
                          <span style={{ fontSize: '0.85em', color: '#495057', marginLeft: '0.35rem', fontWeight: 'bold' }}>
                            {idTag}
                          </span>
                        )}
                        <div style={{ fontSize: '0.85em', color: '#555', marginTop: '0.2rem' }}>
                          Center: <strong>{coord}</strong> • Sector: <strong>{sector}</strong>
                          {cellCountText && <span> • {cellCountText}</span>}
                        </div>
                      </div>
                      <span style={{ fontWeight: 'bold', color: '#0056b3', whiteSpace: 'nowrap', marginLeft: '1rem' }}>
                        Teleport &rarr;
                      </span>
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
