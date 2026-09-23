import React from 'react';
import type { CombatantConfigProposalPayload } from '../../types';

interface CombatantConfigProposalCardProps {
  payload: CombatantConfigProposalPayload;
}

function formatPhaseDisplay(phase: number): string {
  const p = Number(phase) || 1;
  if (p === 1) return 'Phase 1: Initial Wave';
  if (p === 2) return 'Phase 2: Reinforcements';
  return `Phase ${p}: Reinforcements`;
}

function formatMonsterType(c: { monsterType?: string; monsterId?: string; name: string }): string {
  if (c.monsterType) return c.monsterType;
  if (c.monsterId) {
    return c.monsterId.charAt(0).toUpperCase() + c.monsterId.slice(1);
  }
  return 'Custom';
}

export const CombatantConfigProposalCard: React.FC<CombatantConfigProposalCardProps> = ({ payload }) => {
  const combatants = payload.combatants || [];

  return (
    <div
      className="hitl-combatant-config-card"
      data-testid="hitl-combatant-config-card"
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
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: '0.5rem',
          flexWrap: 'wrap',
          gap: '0.5rem',
        }}
      >
        {payload.encounterName && (
          <div style={{ fontWeight: 600, color: '#f8fafc' }}>
            Encounter: <span style={{ color: '#93c5fd' }}>{payload.encounterName}</span>
          </div>
        )}
        <div
          role="status"
          aria-label="Roster Summary"
          style={{
            fontSize: '0.8rem',
            padding: '0.2rem 0.5rem',
            borderRadius: '4px',
            backgroundColor: '#27272a',
            color: '#e4e4e7',
            border: '1px solid #52525b',
          }}
        >
          Proposed Combatants: <strong>{combatants.length}</strong>
        </div>
      </div>

      {payload.scenarioTextSummary && (
        <p
          style={{
            margin: '0 0 0.75rem 0',
            color: '#d4d4d8',
            fontStyle: 'italic',
            fontSize: '0.85rem',
            lineHeight: 1.4,
          }}
        >
          {payload.scenarioTextSummary}
        </p>
      )}

      {combatants.length === 0 ? (
        <div role="status" style={{ color: '#d4d4d8', fontStyle: 'italic', padding: '0.5rem 0' }}>
          No combatants configured.
        </div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table
            style={{
              width: '100%',
              borderCollapse: 'collapse',
              color: '#f8fafc',
              fontSize: '0.85rem',
            }}
            aria-label="Configured Combatants and Phases"
          >
            <thead>
              <tr
                style={{
                  borderBottom: '2px solid #52525b',
                  backgroundColor: '#27272a',
                  textAlign: 'left',
                }}
              >
                <th scope="col" style={{ padding: '0.45rem 0.6rem', color: '#f8fafc', fontWeight: 600 }}>
                  Name
                </th>
                <th scope="col" style={{ padding: '0.45rem 0.6rem', color: '#f8fafc', fontWeight: 600 }}>
                  Monster Type
                </th>
                <th scope="col" style={{ padding: '0.45rem 0.6rem', color: '#f8fafc', fontWeight: 600 }}>
                  Starting Coordinates
                </th>
                <th scope="col" style={{ padding: '0.45rem 0.6rem', color: '#f8fafc', fontWeight: 600 }}>
                  Assigned Phase
                </th>
                <th scope="col" style={{ padding: '0.45rem 0.6rem', color: '#f8fafc', fontWeight: 600 }}>
                  Faction
                </th>
              </tr>
            </thead>
            <tbody>
              {combatants.map((c, idx) => {
                const coordLabel =
                  c.coordinates?.label ||
                  (c.coordinates ? `${c.coordinates.x},${c.coordinates.y}` : '—');
                const regionSuffix = c.coordinates?.regionName ? ` (${c.coordinates.regionName})` : '';
                const isInferredPlacement = !!c.coordinates?.placementInferred;

                return (
                  <tr
                    key={idx}
                    data-testid={`combatant-row-${idx}`}
                    style={{
                      borderBottom: '1px solid #3f3f46',
                      backgroundColor: idx % 2 === 0 ? '#18181b' : '#202024',
                    }}
                  >
                    <th
                      scope="row"
                      data-testid="combatant-name"
                      style={{
                        padding: '0.45rem 0.6rem',
                        color: '#93c5fd',
                        fontWeight: 600,
                        textAlign: 'left',
                      }}
                    >
                      {c.name}
                    </th>
                    <td data-testid="combatant-monster-type" style={{ padding: '0.45rem 0.6rem', color: '#e4e4e7' }}>
                      {formatMonsterType(c)}
                    </td>
                    <td data-testid="combatant-coordinates" style={{ padding: '0.45rem 0.6rem', color: '#e4e4e7' }}>
                      {coordLabel}
                      {regionSuffix}
                      {isInferredPlacement && (
                        <span
                          data-testid="combatant-placement-inferred"
                          style={{
                            display: 'inline-block',
                            marginLeft: '0.4rem',
                            padding: '0.05rem 0.4rem',
                            fontSize: '0.75rem',
                            fontStyle: 'italic',
                            color: '#fcd34d',
                            border: '1px solid #92700f',
                            borderRadius: '3px',
                          }}
                        >
                          default placement, not specified in text
                        </span>
                      )}
                    </td>
                    <td data-testid="combatant-phase" style={{ padding: '0.45rem 0.6rem', color: '#e4e4e7' }}>
                      {formatPhaseDisplay(c.phase)}
                    </td>
                    <td
                      data-testid="combatant-faction"
                      style={{
                        padding: '0.45rem 0.6rem',
                        color: '#e4e4e7',
                        textTransform: 'capitalize',
                      }}
                    >
                      {c.faction || 'enemy'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};
