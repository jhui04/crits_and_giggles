import React from 'react';

interface GenericProposalCardProps {
  payload: Record<string, unknown>;
  description?: string;
}

export const GenericProposalCard: React.FC<GenericProposalCardProps> = ({ payload }) => {
  if (!payload || typeof payload !== 'object' || Object.keys(payload).length === 0) {
    return (
      <div style={{ color: '#a0aec0', fontSize: '0.9rem', fontStyle: 'italic' }}>
        No additional parameters provided for this action.
      </div>
    );
  }

  const entries = Object.entries(payload);

  return (
    <div className="hitl-generic-payload" style={{ fontSize: '0.9rem' }}>
      <table
        style={{
          width: '100%',
          borderCollapse: 'collapse',
          color: '#e2e8f0',
        }}
        aria-label="Action Parameters"
      >
        <thead>
          <tr style={{ borderBottom: '1px solid #4a5568', textAlign: 'left' }}>
            <th scope="col" style={{ padding: '0.35rem 0.5rem', color: '#cbd5e0' }}>
              Parameter
            </th>
            <th scope="col" style={{ padding: '0.35rem 0.5rem', color: '#cbd5e0' }}>
              Value
            </th>
          </tr>
        </thead>
        <tbody>
          {entries.map(([key, value]) => (
            <tr key={key} style={{ borderBottom: '1px solid #2d3748' }}>
              <th
                scope="row"
                style={{
                  padding: '0.35rem 0.5rem',
                  fontFamily: 'monospace',
                  color: '#90cdf4',
                  fontWeight: 'normal',
                }}
              >
                {key}
              </th>
              <td style={{ padding: '0.35rem 0.5rem', fontFamily: 'monospace' }}>
                {typeof value === 'object' ? JSON.stringify(value) : String(value)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};
