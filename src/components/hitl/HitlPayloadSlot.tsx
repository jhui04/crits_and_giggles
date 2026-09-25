import React from 'react';
import type {
  ConfirmationProposal,
  MovementProposalPayload,
  DamageProposalPayload,
  CombatantConfigProposalPayload,
  MapPatchProposalPayload,
} from '../../types';
import { MovementProposalCard } from './MovementProposalCard';
import { DamageProposalCard } from './DamageProposalCard';
import { CombatantConfigProposalCard } from './CombatantConfigProposalCard';
import { MapPatchProposalCard } from './MapPatchProposalCard';
import { GenericProposalCard } from './GenericProposalCard';

interface HitlPayloadSlotProps {
  proposal: ConfirmationProposal;
}

export const HitlPayloadSlot: React.FC<HitlPayloadSlotProps> = ({ proposal }) => {
  switch (proposal.payloadType) {
    case 'movement':
      return <MovementProposalCard payload={proposal.payload as MovementProposalPayload} />;
    case 'damage':
      return <DamageProposalCard payload={proposal.payload as DamageProposalPayload} />;
    case 'combatant_config':
      return <CombatantConfigProposalCard payload={proposal.payload as CombatantConfigProposalPayload} />;
    case 'map_patch':
      return <MapPatchProposalCard payload={proposal.payload as MapPatchProposalPayload} />;
    case 'generic':
    default:
      return <GenericProposalCard payload={proposal.payload as Record<string, unknown>} description={proposal.description} />;
  }
};
