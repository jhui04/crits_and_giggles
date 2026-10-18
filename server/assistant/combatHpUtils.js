/**
 * Thin re-export. The actual logic lives in src/shared/combatHp.ts so the
 * client (manual DM damage entry) and the server (the apply_combat_damage
 * HITL write tool) share one implementation instead of maintaining two
 * copies that can silently drift apart — see src/utils/combatHpUtils.test.ts
 * for the history of why that matters (the G-15 damage-type substring bug
 * had to be fixed by hand in both copies before this module existed).
 */
export {
  matchesDamageType,
  hasDamageResistance,
  hasDamageImmunity,
  hasDamageVulnerability,
  projectHpApplication,
} from '../../src/shared/combatHp.ts';
