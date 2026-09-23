import React from 'react';
import type { MovementProposalPayload } from '../../types';

interface MovementProposalCardProps {
  payload: MovementProposalPayload;
}

export const MovementProposalCard: React.FC<MovementProposalCardProps> = ({ payload }) => {
  const originRegion = payload.origin?.regionName ? ` (${payload.origin.regionName})` : '';
  const destRegion = payload.destination?.regionName ? ` (${payload.destination.regionName})` : '';

  const originEnemies =
    payload.originAdjacencies?.enemies && payload.originAdjacencies.enemies.length > 0
      ? payload.originAdjacencies.enemies.join(', ')
      : 'None';
  const originAllies =
    payload.originAdjacencies?.allies && payload.originAdjacencies.allies.length > 0
      ? payload.originAdjacencies.allies.join(', ')
      : 'None';
  const originNeutral =
    payload.originAdjacencies?.neutral && payload.originAdjacencies.neutral.length > 0
      ? payload.originAdjacencies.neutral.join(', ')
      : 'None';

  const destEnemies =
    payload.destinationAdjacencies?.enemies && payload.destinationAdjacencies.enemies.length > 0
      ? payload.destinationAdjacencies.enemies.join(', ')
      : 'None';
  const destAllies =
    payload.destinationAdjacencies?.allies && payload.destinationAdjacencies.allies.length > 0
      ? payload.destinationAdjacencies.allies.join(', ')
      : 'None';
  const destNeutral =
    payload.destinationAdjacencies?.neutral && payload.destinationAdjacencies.neutral.length > 0
      ? payload.destinationAdjacencies.neutral.join(', ')
      : 'None';

  const characterName = payload.combatantName || payload.combatantId || 'Unknown Combatant';
  const originCoordLabel = payload.origin?.label || (payload.origin ? `${payload.origin.x},${payload.origin.y}` : '?');
  const destCoordLabel = payload.destination?.label || (payload.destination ? `${payload.destination.x},${payload.destination.y}` : '?');

  return (
    <div
      className="hitl-movement-card"
      data-testid="hitl-movement-card"
      style={{ fontSize: '0.9rem', color: '#f7fafc', lineHeight: 1.5 }}
    >
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
          gap: '0.75rem',
          marginBottom: '0.75rem',
        }}
      >
        <section
          aria-labelledby="movement-card-combatant-heading"
          style={{
            backgroundColor: '#1a202c',
            border: '1px solid #2d3748',
            padding: '0.6rem 0.85rem',
            borderRadius: '4px',
          }}
        >
          <h4
            id="movement-card-combatant-heading"
            style={{ margin: 0, fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.05em', color: '#cbd5e0' }}
          >
            Character Moving
          </h4>
          <div
            data-testid="movement-combatant-name"
            style={{ color: '#63b3ed', fontWeight: 700, fontSize: '1.05rem', marginTop: '0.2rem' }}
          >
            {characterName}
          </div>
        </section>

        <section
          aria-labelledby="movement-card-vector-heading"
          style={{
            backgroundColor: '#1a202c',
            border: '1px solid #2d3748',
            padding: '0.6rem 0.85rem',
            borderRadius: '4px',
          }}
        >
          <h4
            id="movement-card-vector-heading"
            style={{ margin: 0, fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.05em', color: '#cbd5e0' }}
          >
            Tactical Movement Vector
          </h4>
          <div style={{ marginTop: '0.2rem', display: 'flex', alignItems: 'center', gap: '0.4rem', flexWrap: 'wrap' }}>
            <span
              data-testid="movement-origin-coords"
              style={{ color: '#feb2b2', fontWeight: 600 }}
            >
              {originCoordLabel}
              {originRegion && <span style={{ color: '#e2e8f0', fontWeight: 'normal' }}>{originRegion}</span>}
            </span>
            <span aria-hidden="true" style={{ color: '#a0aec0' }}>➔</span>
            <span className="sr-only">moving to</span>
            <span
              data-testid="movement-dest-coords"
              style={{ color: '#9ae6b4', fontWeight: 700 }}
            >
              {destCoordLabel}
              {destRegion && <span style={{ color: '#e2e8f0', fontWeight: 'normal' }}>{destRegion}</span>}
            </span>
          </div>
        </section>
      </div>

      {(payload.originAdjacencies || payload.destinationAdjacencies) && (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
            gap: '0.75rem',
          }}
        >
          {payload.originAdjacencies && (
            <section
              aria-labelledby="movement-origin-adj-heading"
              data-testid="movement-origin-adjacencies"
              style={{
                backgroundColor: '#1a202c',
                border: '1px solid #2d3748',
                padding: '0.6rem 0.85rem',
                borderRadius: '4px',
              }}
            >
              <h4
                id="movement-origin-adj-heading"
                style={{ margin: 0, fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.05em', color: '#cbd5e0' }}
              >
                Origin Adjacencies ({originCoordLabel})
              </h4>
              <ul style={{ margin: '0.35rem 0 0 0', paddingLeft: '1.2rem', fontSize: '0.85rem' }}>
                <li style={{ color: originEnemies !== 'None' ? '#feb2b2' : '#a0aec0' }}>
                  <strong style={{ color: '#e2e8f0' }}>Enemies:</strong> {originEnemies}
                </li>
                <li style={{ color: originAllies !== 'None' ? '#9ae6b4' : '#a0aec0' }}>
                  <strong style={{ color: '#e2e8f0' }}>Allies:</strong> {originAllies}
                </li>
                <li style={{ color: originNeutral !== 'None' ? '#faf089' : '#a0aec0' }}>
                  <strong style={{ color: '#e2e8f0' }}>Neutral:</strong> {originNeutral}
                </li>
              </ul>
            </section>
          )}

          {payload.destinationAdjacencies && (
            <section
              aria-labelledby="movement-dest-adj-heading"
              data-testid="movement-dest-adjacencies"
              style={{
                backgroundColor: '#1a202c',
                border: '1px solid #2d3748',
                padding: '0.6rem 0.85rem',
                borderRadius: '4px',
              }}
            >
              <h4
                id="movement-dest-adj-heading"
                style={{ margin: 0, fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.05em', color: '#cbd5e0' }}
              >
                Destination Adjacencies ({destCoordLabel})
              </h4>
              <ul style={{ margin: '0.35rem 0 0 0', paddingLeft: '1.2rem', fontSize: '0.85rem' }}>
                <li style={{ color: destEnemies !== 'None' ? '#feb2b2' : '#a0aec0' }}>
                  <strong style={{ color: '#e2e8f0' }}>Enemies:</strong> {destEnemies}
                </li>
                <li style={{ color: destAllies !== 'None' ? '#9ae6b4' : '#a0aec0' }}>
                  <strong style={{ color: '#e2e8f0' }}>Allies:</strong> {destAllies}
                </li>
                <li style={{ color: destNeutral !== 'None' ? '#faf089' : '#a0aec0' }}>
                  <strong style={{ color: '#e2e8f0' }}>Neutral:</strong> {destNeutral}
                </li>
              </ul>
            </section>
          )}
        </div>
      )}
    </div>
  );
};
