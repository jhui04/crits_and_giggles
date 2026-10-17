import type { WorldAssetConnection } from '../types';

// Known relationship pairs: [forward, inverse]. Both directions are looked up.
const PAIRS: [string, string][] = [
  ['is located in', 'contains'],
  ['is part of', 'includes'],
  ['is a member of', 'has as a member'],
  ['is member of', 'has as a member'],
  ['rules', 'is ruled by'],
  ['created', 'was created by'],
  ['owns', 'is owned by'],
  ['worships', 'is worshipped by'],
  ['lives in', 'is home to'],
  ['hates', 'is hated by'],
  ['loves', 'is loved by'],
  ['fears', 'is feared by'],
  ['serves', 'is served by'],
  ['employs', 'is employed by'],
  ['mentored', 'was mentored by'],
  ['killed', 'was killed by'],
  ['is married to', 'is married to'],
  ['allied with', 'allied with'],
  ['enemy of', 'enemy of'],
  ['is parent of', 'is child of'],
  ['references', 'is referenced by'],
];

const LOOKUP = new Map<string, string>();
for (const [a, b] of PAIRS) {
  LOOKUP.set(a.toLowerCase(), b);
  if (!LOOKUP.has(b.toLowerCase())) LOOKUP.set(b.toLowerCase(), a);
}

export const RELATIONSHIP_SUGGESTIONS = Array.from(new Set(PAIRS.map(([a]) => a)));

export function suggestInverse(relationship: string): string {
  return LOOKUP.get(relationship.trim().toLowerCase()) ?? '';
}

// The label to show from the target's side, or '' when none is known.
export function inverseLabel(conn: WorldAssetConnection): string {
  return conn.inverseRelationship?.trim() || suggestInverse(conn.relationship);
}

// Text for a connection as seen from the target asset, e.g. "is hated by Elminster (NPC)".
export function describeIncoming(sourceName: string, sourceType: string, conn: WorldAssetConnection): string {
  const inverse = inverseLabel(conn);
  return inverse
    ? `${inverse} ${sourceName} (${sourceType})`
    : `${sourceName} (${sourceType}) ${conn.relationship} this asset`;
}
