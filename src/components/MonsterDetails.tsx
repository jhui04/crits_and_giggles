import { useState, useRef, useEffect } from 'react';
import type { Monster } from '../types';
import { DiceService } from '../services/DiceService';
import { QuickRoller } from './QuickRoller';

interface MonsterDetailsProps {
  monster: Monster;
  currentHp?: number;
  maxHp?: number;
  initiative?: number;
  onAnnounce?: (msg: string) => void;
}

export function MonsterDetails({ monster, currentHp, maxHp, initiative, onAnnounce }: MonsterDetailsProps) {
  const statNames: Record<string, string> = {
    STR: 'Strength',
    DEX: 'Dexterity',
    CON: 'Constitution',
    INT: 'Intelligence',
    WIS: 'Wisdom',
    CHA: 'Charisma'
  };

  const [activeRoll, setActiveRoll] = useState<{ title: string, hit?: string, damage?: string } | null>(null);
  const rollModalRef = useRef<HTMLHeadingElement>(null);
  const lastActiveButtonRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (activeRoll && rollModalRef.current) {
      rollModalRef.current.focus();
    } else if (!activeRoll && lastActiveButtonRef.current) {
      lastActiveButtonRef.current.focus();
      lastActiveButtonRef.current = null;
    }
  }, [activeRoll]);

  const closeRollModal = () => {
    setActiveRoll(null);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape' && activeRoll) {
      e.stopPropagation(); // Prevent closing the main details modal
      closeRollModal();
    }
  };

  const getD20Details = (mod: number) => {
    const result = DiceService.roll(`1d20${mod >= 0 ? '+' : ''}${mod}`);
    const base = result.rolls[0];
    let announceStr = result.total.toString();
    if (base === 1) announceStr = `natural 1 (total ${result.total})`;
    if (base === 20) announceStr = `natural 20 (total ${result.total})`;
    const visualStr = `${result.total}, ${base}${mod >= 0 ? '+' : ''}${mod}`;
    return { announceStr, visualStr };
  };

  const rollSave = (name: string, saveMod: number) => {
    const { announceStr } = getD20Details(saveMod);
    const msg = `${monster.name} rolled a ${name} save: ${announceStr}`;
    if (onAnnounce) onAnnounce(msg);
  };

  const rollSkill = (name: string, mod: number) => {
    const { announceStr } = getD20Details(mod);
    const msg = `${monster.name} rolled ${name}: ${announceStr}`;
    if (onAnnounce) onAnnounce(msg);
  };

  const rollFullAttack = (e: React.MouseEvent<HTMLButtonElement>, actionName: string, bonus?: number, damageDice?: {dice: string, type: string}[]) => {
    lastActiveButtonRef.current = e.currentTarget;
    
    let hitVisual: string | undefined;
    let damageResultString: string | undefined;
    let announceParts = [];

    if (bonus !== undefined) {
      const { announceStr, visualStr } = getD20Details(bonus);
      hitVisual = visualStr;
      announceParts.push(`${announceStr} to hit`);
    }

    if (damageDice && damageDice.length > 0) {
      const results = damageDice.map(d => {
         const res = DiceService.roll(d.dice);
         const rollsSum = res.rolls.reduce((sum, val) => sum + val, 0);
         const modStr = res.modifier !== 0 ? (res.modifier > 0 ? `+${res.modifier}` : `${res.modifier}`) : '';
         return `${res.total} ${d.type}, ${rollsSum}${modStr}`;
      });
      damageResultString = results.join(' and ');
      announceParts.push(`${damageResultString} damage`);
    }

    const msg = `${monster.name} uses ${actionName}: ${announceParts.join(', ')}`;
    if (onAnnounce) onAnnounce(msg);

    setActiveRoll({
      title: actionName,
      hit: hitVisual,
      damage: damageResultString
    });
  };

  return (
    <div className="monster-details" onKeyDown={handleKeyDown}>
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

      <div style={{ marginTop: '1rem', marginBottom: '1rem' }}>
        <strong>Quick Roll:</strong>
        <div style={{ marginTop: '0.5rem' }}>
          <QuickRoller monster={monster} onRoll={(title, hit) => {
             const hitVal = hit.split(',')[0];
             if (onAnnounce) onAnnounce(`${monster.name} rolled ${title}: ${hitVal}`);
             setActiveRoll({ title, hit });
          }} />
        </div>
      </div>

      <div style={{ marginTop: '1rem' }}>
        <h4>Speeds</h4>
        <p>{Object.entries(monster.attributes.speeds)
          .filter(([_, v]) => v !== false)
          .map(([k, v]) => typeof v === 'number' ? `${k}: ${v}ft` : k).join(', ')}</p>
      </div>

      <div style={{ marginTop: '1rem' }}>
        {Object.values(monster.stats).some(s => s.save !== s.modifier) && (
          <div style={{ marginBottom: '0.25rem' }}><strong>Saving Throws:</strong>{' '} 
            <ul style={{ display: 'inline', padding: 0, listStyle: 'none', margin: 0 }}>
            {Object.entries(monster.stats)
              .filter(([_, s]) => s.save !== s.modifier)
              .map(([name, s]) => (
                <li key={name} style={{ display: 'inline', marginRight: '0.5rem' }}>
                  <button onClick={() => rollSave(name, s.save)} style={{ fontSize: '0.9em', padding: '0.1rem 0.3rem' }}>
                    {name} {s.save >= 0 ? '+' : ''}{s.save}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
        {monster.skills && monster.skills.length > 0 && (
          <div style={{ marginBottom: '0.25rem' }}><strong>Skills:</strong>{' '} 
            <ul style={{ display: 'inline', padding: 0, listStyle: 'none', margin: 0 }}>
            {monster.skills.map(s => (
                <li key={s.name} style={{ display: 'inline', marginRight: '0.5rem' }}>
                  <button onClick={() => rollSkill(s.name, s.modifier)} style={{ fontSize: '0.9em', padding: '0.1rem 0.3rem' }}>
                    {s.name} {s.modifier >= 0 ? '+' : ''}{s.modifier}
                  </button>
                </li>
            ))}
            </ul>
          </div>
        )}
        {monster.vulnerabilities && monster.vulnerabilities.length > 0 && (
          <p style={{ marginBottom: '0.25rem' }}><strong>Damage Vulnerabilities:</strong> {monster.vulnerabilities.join(', ')}</p>
        )}
        {monster.resistances && monster.resistances.length > 0 && (
          <p style={{ marginBottom: '0.25rem' }}><strong>Damage Resistances:</strong> {monster.resistances.join(', ')}</p>
        )}
        {monster.immunities?.damage && monster.immunities.damage.length > 0 && (
          <p style={{ marginBottom: '0.25rem' }}><strong>Damage Immunities:</strong> {monster.immunities.damage.join(', ')}</p>
        )}
        {monster.immunities?.condition && monster.immunities.condition.length > 0 && (
          <p style={{ marginBottom: '0.25rem' }}><strong>Condition Immunities:</strong> {monster.immunities.condition.join(', ')}</p>
        )}
        {monster.senses && monster.senses.length > 0 && (
          <p style={{ marginBottom: '0.25rem' }}><strong>Senses:</strong> {monster.senses.map(s => s.name === "Passive Perception" ? `${s.name} ${s.value}` : `${s.name} ${s.value} ft`).join(', ')}</p>
        )}
        {monster.languages && monster.languages.length > 0 && (
          <p style={{ marginBottom: '0.25rem' }}><strong>Languages:</strong> {monster.languages.join(', ')}</p>
        )}
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
            const hasRoll = a.attack_bonus !== undefined || (a.damage && a.damage.length > 0);
            
            const content = (
              <>
                {isSpellcasting ? (
                  <strong style={{ display: 'block', fontSize: '1rem', marginBottom: '0.25rem' }}>{a.name}</strong>
                ) : (
                  <strong>{a.name}:</strong>
                )} {a.content}
              </>
            );

            return (
              <div key={a.name} style={{ marginBottom: '0.75rem' }}>
                {hasRoll ? (
                  <button 
                    onClick={(e) => rollFullAttack(e, a.name, a.attack_bonus, a.damage as any)}
                    style={{
                      background: '#f8f9fa',
                      border: '1px solid #ddd',
                      borderRadius: '6px',
                      padding: '0.5rem',
                      textAlign: 'left',
                      width: '100%',
                      fontFamily: 'inherit',
                      fontSize: 'inherit',
                      cursor: 'pointer',
                      display: 'block'
                    }}
                    title={`Roll ${a.name}`}
                  >
                    {content}
                  </button>
                ) : (
                  <div>{content}</div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {monster.legendary_actions && monster.legendary_actions.length > 0 && (
        <div style={{ marginTop: '1rem' }}>
          <h4>Legendary Actions</h4>
          {monster.legendary_actions.map(a => {
            const hasRoll = a.attack_bonus !== undefined || (a.damage && a.damage.length > 0);
            const content = (
              <>
                <strong>{a.name}:</strong> {a.content}
              </>
            );

            return (
              <div key={a.name} style={{ marginBottom: '0.75rem' }}>
                {hasRoll ? (
                  <button 
                    onClick={(e) => rollFullAttack(e, a.name, a.attack_bonus, a.damage as any)}
                    style={{
                      background: '#f8f9fa',
                      border: '1px solid #ddd',
                      borderRadius: '6px',
                      padding: '0.5rem',
                      textAlign: 'left',
                      width: '100%',
                      fontFamily: 'inherit',
                      fontSize: 'inherit',
                      cursor: 'pointer',
                      display: 'block'
                    }}
                    title={`Roll ${a.name}`}
                  >
                    {content}
                  </button>
                ) : (
                  <div>{content}</div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {monster.reactions && monster.reactions.length > 0 && (
        <div style={{ marginTop: '1rem' }}>
          <h4>Reactions</h4>
          {monster.reactions.map(a => (
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

      {activeRoll && (
        <div role="dialog" aria-modal="true" aria-labelledby="roll-result-title" style={{
          position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
          backgroundColor: '#333', color: 'white', padding: '1.5rem', borderRadius: '8px',
          boxShadow: '0 4px 6px rgba(0,0,0,0.3)', zIndex: 1002, minWidth: '250px', textAlign: 'center'
        }}>
          <h4 id="roll-result-title" ref={rollModalRef} tabIndex={-1} style={{ outline: 'none', margin: '0 0 1rem 0' }}>
            {activeRoll.title}
          </h4>
          
          {activeRoll.hit !== undefined && (
            <p style={{ fontSize: '1.2rem', marginBottom: '0.5rem' }}>
              <strong>Hit:</strong> {activeRoll.hit}
            </p>
          )}
          
          {activeRoll.damage && (
            <p style={{ fontSize: '1.2rem', marginBottom: '1rem' }}>
              <strong>Damage:</strong> {activeRoll.damage}
            </p>
          )}

          <button onClick={closeRollModal} style={{ padding: '0.5rem 1rem', fontSize: '1rem', backgroundColor: '#fff', color: '#333', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>
            Close (Esc)
          </button>
        </div>
      )}
    </div>
  );
}
