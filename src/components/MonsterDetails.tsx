import type { Monster } from './EncounterBuilder';

interface MonsterDetailsProps {
  monster: Monster;
  currentHp?: number;
  maxHp?: number;
  initiative?: number;
}

export function MonsterDetails({ monster, currentHp, maxHp, initiative }: MonsterDetailsProps) {
  const statNames: Record<string, string> = {
    STR: 'Strength',
    DEX: 'Dexterity',
    CON: 'Constitution',
    INT: 'Intelligence',
    WIS: 'Wisdom',
    CHA: 'Charisma'
  };

  return (
    <div className="monster-details">
      <h4>Quick Stats</h4>
      <div>
        {initiative !== undefined && <p><strong>Initiative:</strong> {initiative}</p>}
        <p><strong>HP:</strong> {currentHp !== undefined ? `${currentHp} / ${maxHp}` : monster.attributes.hp.value} ({monster.attributes.hp.dice})</p>
        <p><strong>AC:</strong> {monster.attributes.ac.value} {monster.attributes.ac.notes ? `(${monster.attributes.ac.notes})` : ''}</p>
        <p><strong>Type:</strong> {monster.meta.size} {monster.meta.type}</p>
      </div>

      <h4>Ability Scores</h4>
      <div>
        {Object.entries(monster.stats).map(([name, s]) => {
          const fullName = statNames[name] || name;
          return (
            <p 
              key={name} 
              style={{ margin: '0 0 0.5rem 0' }}
            >
              <strong>{fullName}:</strong> {s.score}
              <span className="sr-only">.</span>
              <span aria-hidden="true"> ({s.modifier >= 0 ? '+' : ''}{s.modifier})</span>
              <span className="sr-only"> {s.modifier >= 0 ? '+' : ''}{s.modifier}</span>
            </p>
          );
        })}
      </div>

      <div style={{ marginTop: '1rem' }}>
        <h4>Speeds</h4>
        <p>{Object.entries(monster.attributes.speeds)
          .filter(([_, v]) => v !== false)
          .map(([k, v]) => typeof v === 'number' ? `${k}: ${v}ft` : k).join(', ')}</p>
      </div>

      {monster.traits && monster.traits.length > 0 && (
        <div style={{ marginTop: '1rem' }}>
          <h4>Traits</h4>
          {monster.traits.map(t => (
            <p key={t.name} style={{ marginBottom: '0.75rem' }}>
              <strong>{t.name}:</strong> {t.content}
            </p>
          ))}
        </div>
      )}

      {monster.actions && monster.actions.length > 0 && (
        <div style={{ marginTop: '1rem' }}>
          <h4>Actions</h4>
          {monster.actions.map(a => {
            const isSpellcasting = a.name.toLowerCase().includes('spellcasting');
            return (
              <p key={a.name} style={{ marginBottom: '0.75rem' }}>
                {isSpellcasting ? (
                  <strong style={{ display: 'block', fontSize: '1rem', marginBottom: '0.25rem' }}>{a.name}</strong>
                ) : (
                  <strong>{a.name}:</strong>
                )} {a.content}
              </p>
            );
          })}
        </div>
      )}

      {monster.legendary_actions && monster.legendary_actions.length > 0 && (
        <div style={{ marginTop: '1rem' }}>
          <h4>Legendary Actions</h4>
          {monster.legendary_actions.map(a => (
            <p key={a.name} style={{ marginBottom: '0.75rem' }}>
              <strong>{a.name}:</strong> {a.content}
            </p>
          ))}
        </div>
      )}

      <p style={{ marginTop: '1.5rem', paddingTop: '1rem', borderTop: '1px solid #ccc' }}>
        <strong>CR:</strong> {monster.cr}
        {monster.source && <span> | <strong>Source:</strong> {monster.source}</span>}
      </p>
    </div>
  );
}
