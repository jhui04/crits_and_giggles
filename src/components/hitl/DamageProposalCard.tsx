import React from 'react';
import type { DamageProposalPayload } from '../../types';

interface DamageProposalCardProps {
  payload: DamageProposalPayload;
}

export const DamageProposalCard: React.FC<DamageProposalCardProps> = ({ payload }) => {
  const targets = payload.targets || [];

  if (targets.length === 0) {
    return (
      <div style={{ color: '#a0aec0', fontSize: '0.9rem', fontStyle: 'italic' }}>
        No combatant targets specified.
      </div>
    );
  }

  return (
    <div className="hitl-damage-card" data-testid="hitl-damage-card" style={{ fontSize: '0.9rem' }}>
      <table
        style={{
          width: '100%',
          borderCollapse: 'collapse',
          color: '#e2e8f0',
        }}
        aria-label="Target Combatants and Projected HP"
      >
        <caption className="sr-only">
          Target combatants, incoming damage or healing actions, current HP, and projected HP after resolution
        </caption>
        <thead>
          <tr style={{ borderBottom: '1px solid #4a5568', textAlign: 'left' }}>
            <th scope="col" style={{ padding: '0.4rem 0.5rem', color: '#cbd5e0' }}>Target</th>
            <th scope="col" style={{ padding: '0.4rem 0.5rem', color: '#cbd5e0' }}>Action</th>
            <th scope="col" style={{ padding: '0.4rem 0.5rem', color: '#cbd5e0' }}>Amount</th>
            <th scope="col" style={{ padding: '0.4rem 0.5rem', color: '#cbd5e0' }}>Current HP</th>
            <th scope="col" style={{ padding: '0.4rem 0.5rem', color: '#cbd5e0' }}>Projected HP</th>
          </tr>
        </thead>
        <tbody>
          {targets.map((t, idx) => {
            const isReduced = t.projectedHp < t.currentHp || t.projectedTempHp < t.currentTempHp;
            const isIncreased = t.projectedHp > t.currentHp || t.projectedTempHp > t.currentTempHp;
            const projectedColor = isReduced ? '#fc8181' : isIncreased ? '#68d391' : '#cbd5e0';

            const actionLabel = t.damageType
              ? `${t.damageType} (${t.actionType})`
              : t.actionType;

            return (
              <tr
                // G-5 made repeat entries for the same combatant in one
                // proposal a supported case (e.g. "temp HP, then damage"),
                // so combatantId alone is not unique across rows.
                key={`${t.combatantId}-${idx}`}
                data-testid={`damage-target-${t.combatantId}`}
                style={{ borderBottom: '1px solid #2d3748' }}
              >
                <th
                  scope="row"
                  data-testid="damage-combatant-name"
                  style={{ padding: '0.4rem 0.5rem', color: '#63b3ed', fontWeight: 600 }}
                >
                  {t.combatantName}
                </th>
                <td
                  data-testid="damage-action-type"
                  style={{ padding: '0.4rem 0.5rem', textTransform: 'capitalize' }}
                >
                  {actionLabel}
                </td>
                <td
                  data-testid="damage-amount"
                  style={{ padding: '0.4rem 0.5rem', fontWeight: 'bold' }}
                >
                  {t.amount}
                </td>
                <td
                  data-testid="damage-current-hp"
                  style={{ padding: '0.4rem 0.5rem' }}
                >
                  {t.currentHp} / {t.maxHp}
                  {t.currentTempHp > 0 ? ` (+${t.currentTempHp} temp)` : ''}
                </td>
                <td
                  data-testid="damage-projected-hp"
                  style={{
                    padding: '0.4rem 0.5rem',
                    fontWeight: 'bold',
                    color: projectedColor,
                  }}
                >
                  {t.projectedHp} / {t.maxHp}
                  {t.projectedTempHp > 0 ? ` (+${t.projectedTempHp} temp)` : ''}
                  {t.effectiveChange ? ` (${t.effectiveChange})` : ''}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
};
