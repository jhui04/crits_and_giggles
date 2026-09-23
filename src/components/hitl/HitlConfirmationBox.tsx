import React, { useEffect, useRef } from 'react';
import type { ConfirmationProposal } from '../../types';
import { HitlPayloadSlot } from './HitlPayloadSlot';

export interface HitlConfirmationBoxProps {
  proposal: ConfirmationProposal;
  onApprove: (proposalId: string) => void;
  onDeny: (proposalId: string) => void;
  isProcessing?: boolean;
  /** 1-based position of `proposal` in the pending queue. */
  queuePosition?: number;
  /** Total number of proposals currently pending for this campaign. */
  queueTotal?: number;
}

function formatToolTitle(toolName: string): string {
  if (!toolName) return 'Action';
  return toolName
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

export const HitlConfirmationBox: React.FC<HitlConfirmationBoxProps> = ({
  proposal,
  onApprove,
  onDeny,
  isProcessing = false,
  queuePosition,
  queueTotal,
}) => {
  const hasQueue = !!queueTotal && queueTotal > 1;
  const headingRef = useRef<HTMLHeadingElement>(null);
  const approveBtnRef = useRef<HTMLButtonElement>(null);
  const denyBtnRef = useRef<HTMLButtonElement>(null);

  // Focus landing upon proposal arrival (screen reader announcement and navigation)
  useEffect(() => {
    if (headingRef.current) {
      headingRef.current.focus();
    } else if (approveBtnRef.current) {
      approveBtnRef.current.focus();
    }
    const timer = setTimeout(() => {
      if (headingRef.current) {
        headingRef.current.focus();
      } else if (approveBtnRef.current) {
        approveBtnRef.current.focus();
      }
    }, 0);
    return () => clearTimeout(timer);
  }, [proposal.proposalId]);

  const kbdStyle: React.CSSProperties = {
    display: 'inline-block',
    padding: '0.1rem 0.35rem',
    fontSize: '0.75rem',
    fontFamily: 'monospace',
    lineHeight: '1.2',
    color: '#edf2f7',
    backgroundColor: '#2d3748',
    border: '1px solid #4a5568',
    borderRadius: '3px',
    boxShadow: '0 1px 1px rgba(0,0,0,0.2)',
  };

  return (
    <section
      id="hitl-confirmation-box"
      data-testid="hitl-confirmation-box"
      role="region"
      aria-labelledby="hitl-proposal-title"
      aria-describedby="hitl-proposal-desc"
      className="hitl-confirmation-box"
      style={{
        backgroundColor: '#1b222d',
        border: '2px solid #e6a23c',
        borderRadius: '6px',
        padding: '0.85rem 1rem',
        marginBottom: '0.75rem',
        flexShrink: 0,
        maxHeight: '40vh',
        overflowY: 'auto',
        boxShadow: '0 4px 14px rgba(0, 0, 0, 0.6)',
      }}
    >
      {/* Header Bar */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          borderBottom: '1px solid #2d3748',
          paddingBottom: '0.5rem',
          marginBottom: '0.65rem',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <span aria-hidden="true" style={{ fontSize: '1.1rem', color: '#e6a23c' }}>
            ⚠️
          </span>
          <h3
            id="hitl-proposal-title"
            ref={headingRef}
            tabIndex={-1}
            style={{
              margin: 0,
              fontSize: '1.1rem',
              fontWeight: 700,
              color: '#ffffff',
              outline: 'none',
            }}
          >
            Action Confirmation Required: {formatToolTitle(proposal.toolName)}
            {hasQueue ? ` (Action ${queuePosition} of ${queueTotal})` : ''}
          </h3>
        </div>

        <span
          className="hitl-badge"
          style={{
            backgroundColor: '#8a5300',
            color: '#fff',
            fontSize: '0.75rem',
            fontWeight: 'bold',
            padding: '0.2rem 0.5rem',
            borderRadius: '4px',
            textTransform: 'uppercase',
            letterSpacing: '0.05em',
          }}
        >
          Pending DM Approval{hasQueue ? ` (${queuePosition}/${queueTotal})` : ''}
        </span>
      </div>

      {/* Proposal Description */}
      <p
        id="hitl-proposal-desc"
        style={{
          margin: '0 0 0.75rem 0',
          color: '#e2e8f0',
          fontSize: '0.95rem',
          lineHeight: 1.4,
        }}
      >
        {proposal.description}
      </p>

      {/* Custom Presentation Payload */}
      <div
        className="hitl-payload-container"
        style={{
          backgroundColor: '#141820',
          borderRadius: '4px',
          padding: '0.75rem',
          marginBottom: '0.85rem',
          border: '1px solid #2d3748',
        }}
      >
        <HitlPayloadSlot proposal={proposal} />
      </div>

      {/* Standardized Action Controls */}
      <div
        className="hitl-actions"
        role="group"
        aria-label="Proposal Decision Actions"
        style={{
          display: 'flex',
          justifyContent: 'flex-end',
          alignItems: 'center',
          gap: '0.75rem',
          borderTop: '1px solid #2d3748',
          paddingTop: '0.65rem',
        }}
      >
        <span
          style={{
            fontSize: '0.8rem',
            color: '#cbd5e0',
            marginRight: 'auto',
          }}
        >
          Shortcuts: <kbd style={kbdStyle}>Alt+Y</kbd> Approve | <kbd style={kbdStyle}>Alt+N</kbd> Deny
        </span>

        {/* Deny Button */}
        <button
          type="button"
          id="hitl-deny-btn"
          ref={denyBtnRef}
          aria-keyshortcuts="Alt+N"
          aria-label={`Deny action: ${proposal.description} (Alt+N)`}
          disabled={isProcessing}
          onClick={() => onDeny(proposal.proposalId)}
          style={{
            backgroundColor: '#822727',
            color: '#ffffff',
            border: '1px solid #e53e3e',
            borderRadius: '4px',
            padding: '0.45rem 1rem',
            fontWeight: 600,
            fontSize: '0.95rem',
            cursor: isProcessing ? 'not-allowed' : 'pointer',
            opacity: isProcessing ? 0.6 : 1,
          }}
        >
          {isProcessing ? 'Processing...' : 'Deny (Alt+N)'}
        </button>

        {/* Approve Button */}
        <button
          type="button"
          id="hitl-approve-btn"
          ref={approveBtnRef}
          aria-keyshortcuts="Alt+Y"
          aria-label={`Approve action: ${proposal.description} (Alt+Y)`}
          disabled={isProcessing}
          onClick={() => onApprove(proposal.proposalId)}
          style={{
            backgroundColor: '#1b6b32',
            color: '#ffffff',
            border: '1px solid #38a169',
            borderRadius: '4px',
            padding: '0.45rem 1.25rem',
            fontWeight: 700,
            fontSize: '0.95rem',
            cursor: isProcessing ? 'not-allowed' : 'pointer',
            opacity: isProcessing ? 0.6 : 1,
          }}
        >
          {isProcessing ? 'Processing...' : 'Approve (Alt+Y)'}
        </button>
      </div>
    </section>
  );
};
