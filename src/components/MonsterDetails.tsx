import { useState, useRef, useEffect } from 'react';
import type { Monster, Spell, LoreItem } from '../types';
import { DiceService } from '../services/DiceService';
import { diceLogService } from '../services/DiceLogService';
import { QuickRoller } from './QuickRoller';
import { wrapSpells } from '../utils/spellUtils';
import { Markdown } from './Markdown';
import { dataService } from '../services/DataService';
import { isInteractiveTarget, useFocusTrap } from './uiHelpers';

interface MonsterDetailsProps {
  monster: Monster;
  currentHp?: number;
  maxHp?: number;
  initiative?: number;
  onAnnounce?: (msg: string) => void;
  onAssetClick?: (id: string, tagType: string) => void;
}

// Cache for spell names to avoid repeated regex generation
let globalSpellNames: string[] = [];

export function MonsterDetails({ monster, currentHp, maxHp, initiative, onAnnounce, onAssetClick = () => {} }: MonsterDetailsProps) {
  const [spellNames, setSpellNames] = useState<string[]>(globalSpellNames);

  useEffect(() => {
    if (globalSpellNames.length === 0) {
      dataService.getAllSpells()
        .then(spells => {
          const names = spells.map((s: Spell) => s.name);
          globalSpellNames = names;
          setSpellNames(names);
        })
        .catch(err => console.error('Failed to load spells for monster details:', err));
    }
  }, []);

  const statNames: Record<string, string> = {
    STR: 'Strength',
    DEX: 'Dexterity',
    CON: 'Constitution',
    INT: 'Intelligence',
    WIS: 'Wisdom',
    CHA: 'Charisma'
  };

  const [activeRoll, setActiveRoll] = useState<{ title: string, hit?: string, damage?: string, result?: string } | null>(null);
  const rollModalRef = useRef<HTMLHeadingElement>(null);
  const lastActiveButtonRef = useRef<HTMLElement | null>(null);
  const rollDialogRef = useRef<HTMLDivElement>(null);

  useFocusTrap(rollDialogRef, activeRoll !== null);

  useEffect(() => {
    if (activeRoll) {
      const timer = setTimeout(() => {
        rollModalRef.current?.focus();
      }, 50);
      return () => clearTimeout(timer);
    } else if (!activeRoll && lastActiveButtonRef.current) {
      const timer = setTimeout(() => {
        lastActiveButtonRef.current?.focus();
        lastActiveButtonRef.current = null;
      }, 50);
      return () => clearTimeout(timer);
    }
  }, [activeRoll]);

  const closeRollModal = () => {
    setActiveRoll(null);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape' && activeRoll) {
      e.preventDefault();
      e.stopPropagation(); // Prevent closing the main details modal
      if (lastActiveButtonRef.current) {
        lastActiveButtonRef.current.focus();
        lastActiveButtonRef.current = null;
      }
      closeRollModal();
    }
    
    // Prevent default behavior for Enter/Space on non-button focused elements (like the heading)
    // to avoid potential page scroll/teleport issues.
    if ((e.key === 'Enter' || e.key === ' ') && !isInteractiveTarget(e.target)) {
      e.preventDefault();
    }
  };

  const getD20Details = (mod: number, purpose: string) => {
    const formula = `1d20${mod >= 0 ? '+' : ''}${mod}`;
    const result = DiceService.roll(formula);
    const base = result.rolls[0];
    let announceStr = result.total.toString();
    const critStatus = base === 20 ? 'crit' : base === 1 ? 'fumble' : 'normal';
    if (base === 1) announceStr = `natural 1 (total ${result.total})`;
    if (base === 20) announceStr = `natural 20 (total ${result.total})`;
    const visualStr = `${result.total}, ${base}${mod >= 0 ? '+' : ''}${mod}`;

    diceLogService.logRoll({
      source: monster.name,
      purpose,
      formula,
      rolls: result.rolls,
      modifier: mod,
      total: result.total,
      critStatus,
      details: critStatus === 'crit' ? 'Natural 20!' : critStatus === 'fumble' ? 'Natural 1!' : undefined
    });

    return { announceStr, visualStr };
  };

  const rollFullAttack = (e: React.MouseEvent<HTMLButtonElement>, actionName: string, bonus?: number, damageDice?: {dice: string, type: string}[]) => {
    lastActiveButtonRef.current = e.currentTarget;
    
    let hitVisual: string | undefined;
    let damageResultString: string | undefined;
    const announceParts = [];

    if (bonus !== undefined) {
      const { announceStr, visualStr } = getD20Details(bonus, `${actionName} (Attack to hit)`);
      hitVisual = visualStr;
      announceParts.push(`${announceStr} to hit`);
    }

    if (damageDice && damageDice.length > 0) {
      const results = damageDice.map(d => {
         const res = DiceService.roll(d.dice);
         const rollsSum = res.rolls.reduce((sum, val) => sum + val, 0);
         const modStr = res.modifier !== 0 ? (res.modifier > 0 ? `+${res.modifier}` : `${res.modifier}`) : '';

         diceLogService.logRoll({
           source: monster.name,
           purpose: `${actionName} (${d.type} damage)`,
           formula: d.dice,
           rolls: res.rolls,
           modifier: res.modifier,
           total: res.total,
           details: `${d.type} damage`
         });

         return `${res.total} ${d.type}, ${rollsSum}${modStr}`;
      });
      damageResultString = results.join(' and ');
      announceParts.push(`${damageResultString} damage`);
    }

    const msg = `${monster.name} uses ${actionName}${announceParts.length > 0 ? ': ' + announceParts.join(', ') : ''}`;
    if (onAnnounce) onAnnounce(msg);

    setActiveRoll({
      title: actionName,
      hit: hitVisual,
      damage: damageResultString
    });
  };

  const renderLoreContent = (content: LoreItem[]) => {
    return content.map((item, idx) => {
      if (typeof item === 'string') {
        return <div key={idx} style={{ marginBottom: '0.5rem' }}><Markdown content={item} onAssetClick={onAssetClick} /></div>;
      }
      if (item.type === 'list') {
        return (
          <ul key={idx} style={{ marginBottom: '0.5rem', paddingLeft: '1.5rem' }}>
            {item.items.map((listItem, i) => (
              <li key={i}><Markdown content={listItem} onAssetClick={onAssetClick} /></li>
            ))}
          </ul>
        );
      }
      if (item.type === 'table') {
        return (
          <div key={idx} style={{ overflowX: 'auto', marginBottom: '1rem' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', border: '1px solid #ccc' }}>
              <tbody>
                {item.rows.map((row, rIdx) => (
                  <tr key={rIdx} style={{ backgroundColor: rIdx % 2 === 0 ? '#f9f9f9' : 'transparent' }}>
                    {row.map((cell, cIdx) => {
                      const CellTag = rIdx === 0 ? 'th' : 'td';
                      return (
                        <CellTag 
                          key={cIdx} 
                          style={{ 
                            border: '1px solid #ccc', 
                            padding: '0.5rem', 
                            textAlign: 'left',
                            fontWeight: rIdx === 0 ? 'bold' : 'normal'
                          }}
                        >
                          <Markdown content={cell} onAssetClick={onAssetClick} />
                        </CellTag>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      }
      return null;
    });
  };

  const standardLore = (monster.lore_sections || []).filter(s => 
    !s.title.toLowerCase().includes('lair') && 
    !s.title.toLowerCase().includes('regional effects')
  );
  
  const bottomLore = (monster.lore_sections || []).filter(s => 
    s.title.toLowerCase().includes('lair') || 
    s.title.toLowerCase().includes('regional effects')
  );

  return (
    <div className="monster-details" onKeyDown={handleKeyDown} >
      <h3>Quick Stats</h3>
      <div>
        {initiative !== undefined && <p><strong>Initiative:</strong> {initiative}</p>}
        <p><strong>HP:</strong> {currentHp !== undefined ? `${currentHp} / ${maxHp}` : monster.attributes.hp.value} ({monster.attributes.hp.dice})</p>
        <p><strong>AC:</strong> {monster.attributes.ac.value} {monster.attributes.ac.notes ? `(${monster.attributes.ac.notes})` : ''}</p>
        <p><strong>Type:</strong> {monster.meta.size} {monster.meta.type}</p>
      </div>

      {monster.description && (
        <div style={{ marginTop: '1rem' }}>
          <h3>Description</h3>
          <div className="monster-description" style={{ marginBottom: '1rem', fontStyle: 'italic' }}>
            {renderLoreContent(monster.description)}
          </div>
        </div>
      )}

      {standardLore.map((section, idx) => (
        <div key={idx} style={{ marginTop: '1rem' }}>
          <h3>{section.title}</h3>
          <div className="monster-lore-section" style={{ marginBottom: '1rem', fontStyle: 'italic' }}>
            {renderLoreContent(section.content)}
          </div>
        </div>
      ))}

      <h3>Ability Scores</h3>
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
          <QuickRoller monster={monster} onRoll={(title, result) => {
             const resultVal = result.split(',')[0];
             if (onAnnounce) onAnnounce(`${monster.name} rolled ${title}: ${resultVal}`);
             lastActiveButtonRef.current = document.getElementById(`quick-roller-${monster.id}`) as HTMLElement;
             setActiveRoll({ title, result });
          }} />
        </div>
      </div>

      <div style={{ marginTop: '1rem' }}>
        <h3>Speeds</h3>
        <p>{Object.entries(monster.attributes.speeds)
          .filter(([, v]) => v !== false)
          .map(([k, v]) => typeof v === 'number' ? `${k}: ${v}ft` : k).join(', ')}</p>
      </div>

      <div style={{ marginTop: '1rem' }}>
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
          <h3>Traits</h3>
          {monster.traits.map(t => (
            <div key={t.name} style={{ marginBottom: '0.75rem' }}>
              <strong>{t.name}:</strong> {wrapSpells(t.content, spellNames)}
            </div>
          ))}
        </div>
      )}

      {monster.actions && monster.actions.length > 0 && (
        <div style={{ marginTop: '1rem' }}>
          <h3>Actions</h3>
          {monster.actions.map(a => {
            return (
              <div key={a.name} style={{ marginBottom: '0.75rem' }}>
                  <div 
                    style={{
                      background: '#f8f9fa',
                      border: '1px solid #ddd',
                      borderRadius: '6px',
                      padding: '0.5rem',
                      textAlign: 'left',
                      width: '100%',
                      fontFamily: 'inherit',
                      fontSize: 'inherit',
                      display: 'block'
                    }}
                  >
                    <button 
                      type="button"
                      onClick={(e) => rollFullAttack(e, a.name, a.attack_bonus, a.damage)}
                      style={{
                        background: 'none',
                        border: 'none',
                        padding: 0,
                        font: 'inherit',
                        cursor: 'pointer',
                        textAlign: 'left',
                        fontWeight: 'bold',
                        color: 'inherit',
                        display: 'inline'
                      }}
                      aria-label={`${a.name}, roll action`}
                    >
                      {a.name.toLowerCase().includes('spellcasting') ? a.name : `${a.name}:`}
                    </button>
                    {' '}
                    <span>{wrapSpells(a.content, spellNames)}</span>
                  </div>
              </div>
            );
          })}
        </div>
      )}

      {monster.legendary_actions && monster.legendary_actions.length > 0 && (
        <div style={{ marginTop: '1rem' }}>
          <h3>Legendary Actions</h3>
          {monster.legendary_actions.map(a => {
            return (
              <div key={a.name} style={{ marginBottom: '0.75rem' }}>
                  <div 
                    style={{
                      background: '#f8f9fa',
                      border: '1px solid #ddd',
                      borderRadius: '6px',
                      padding: '0.5rem',
                      textAlign: 'left',
                      width: '100%',
                      fontFamily: 'inherit',
                      fontSize: 'inherit',
                      display: 'block'
                    }}
                  >
                    <button 
                      type="button"
                      onClick={(e) => rollFullAttack(e, a.name, a.attack_bonus, a.damage)}
                      style={{
                        background: 'none',
                        border: 'none',
                        padding: 0,
                        font: 'inherit',
                        cursor: 'pointer',
                        textAlign: 'left',
                        fontWeight: 'bold',
                        color: 'inherit',
                        display: 'inline'
                      }}
                      aria-label={`${a.name}, roll legendary action`}
                    >
                      {a.name.toLowerCase().includes('spellcasting') ? a.name : `${a.name}:`}
                    </button>
                    {' '}
                    <span>{wrapSpells(a.content, spellNames)}</span>
                  </div>
              </div>
            );
          })}
        </div>
      )}

      {monster.reactions && monster.reactions.length > 0 && (
        <div style={{ marginTop: '1rem' }}>
          <h3>Reactions</h3>
          {monster.reactions.map(a => (
            <div key={a.name} style={{ marginBottom: '0.75rem' }}>
              <strong>{a.name}:</strong> {a.content}
            </div>
          ))}
        </div>
      )}

      {bottomLore.map((section, idx) => (
        <div key={idx} style={{ marginTop: '1rem' }}>
          <h3>{section.title}</h3>
          <div className="monster-lore-section" style={{ marginBottom: '1rem', fontStyle: 'italic' }}>
            {renderLoreContent(section.content)}
          </div>
        </div>
      ))}

      <p style={{ marginTop: '1.5rem', paddingTop: '1rem', borderTop: '1px solid #ccc' }}>
        <strong>CR:</strong> {monster.cr}
        {monster.source && <span> | <strong>Source:</strong> {monster.source}</span>}
      </p>

      {activeRoll && (
        <div ref={rollDialogRef} role="dialog" aria-modal="true" aria-labelledby="roll-result-title" style={{
          position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
          backgroundColor: '#333', color: 'white', padding: '1.5rem', borderRadius: '8px',
          boxShadow: '0 4px 6px rgba(0,0,0,0.3)', zIndex: 1002, minWidth: '250px', textAlign: 'center'
        }}>
          <h3 id="roll-result-title" ref={rollModalRef} tabIndex={-1} style={{ outline: 'none', margin: '0 0 1rem 0' }}>
            {activeRoll.title}
          </h3>

          {activeRoll.result !== undefined && (
            <p style={{ fontSize: '1.2rem', marginBottom: '0.5rem' }}>
              <strong>Result:</strong> {activeRoll.result}
            </p>
          )}
          
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

          <button type="button" onClick={closeRollModal} style={{ padding: '0.5rem 1rem', fontSize: '1rem', backgroundColor: '#fff', color: '#333', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>
            Close (Esc)
          </button>
        </div>
      )}
    </div>
  );
}
