import React from 'react';
import type { MapPatchProposalPayload } from '../../types';

interface MapPatchProposalCardProps {
  payload: MapPatchProposalPayload;
}

/** A correction to the prepared map data, shown as a plain description list a screen reader reads in order. */
export const MapPatchProposalCard: React.FC<MapPatchProposalCardProps> = ({ payload }) => {
  const { map, ...details } = payload;
  return (
    <div
      className="hitl-map-patch-card"
      data-testid="hitl-map-patch-card"
      style={{
        fontSize: '0.9rem',
        color: '#f8fafc',
        backgroundColor: '#18181b',
        border: '1px solid #3f3f46',
        borderRadius: '6px',
        padding: '0.85rem',
        margin: '0.5rem 0',
      }}
    >
      <div style={{ fontWeight: 600, marginBottom: '0.5rem' }}>
        Map: <span style={{ color: '#93c5fd' }}>{map}</span>
      </div>
      <dl style={{ margin: 0 }}>
        {Object.entries(details).map(([label, value]) => (
          <div key={label} style={{ display: 'flex', gap: '0.5rem', padding: '0.15rem 0' }}>
            <dt style={{ color: '#cbd5e0' }}>{label}:</dt>
            <dd style={{ margin: 0 }}>{String(value)}</dd>
          </div>
        ))}
      </dl>
      <p style={{ margin: '0.5rem 0 0', fontSize: '0.8rem', color: '#a1a1aa' }}>
        Approving keeps this correction for every future encounter on this map. The generated map file is not changed.
      </p>
    </div>
  );
};
