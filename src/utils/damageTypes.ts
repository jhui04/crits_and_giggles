import type { DisclosureSelectOption } from '../components/DisclosureSelect';

/** Sentinel value for "no damage type" (healing has no type at all; damage defaults to this). */
export const UNTYPED_DAMAGE = 'untyped';

/**
 * The 13 D&D 5e damage types plus "Untyped" (the default), for the manual DM
 * damage-entry DisclosureSelect in MonsterOperationsModal. Values are the
 * lowercase strings matched against monster resistances/immunities/
 * vulnerabilities by src/shared/combatHp.ts.
 */
export const DAMAGE_TYPE_OPTIONS: DisclosureSelectOption<string>[] = [
  { value: UNTYPED_DAMAGE, label: 'Untyped' },
  { value: 'acid', label: 'Acid' },
  { value: 'bludgeoning', label: 'Bludgeoning' },
  { value: 'cold', label: 'Cold' },
  { value: 'fire', label: 'Fire' },
  { value: 'force', label: 'Force' },
  { value: 'lightning', label: 'Lightning' },
  { value: 'necrotic', label: 'Necrotic' },
  { value: 'piercing', label: 'Piercing' },
  { value: 'poison', label: 'Poison' },
  { value: 'psychic', label: 'Psychic' },
  { value: 'radiant', label: 'Radiant' },
  { value: 'slashing', label: 'Slashing' },
  { value: 'thunder', label: 'Thunder' },
];
