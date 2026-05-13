import { useState, useRef, useEffect } from 'react';
import type { Monster } from '../types';
import { getSkillModifier, getSaveModifier, DND_SKILLS, DND_SAVES, formatD20Roll } from '../utils/dnd';

interface QuickRollerProps {
  monster: Monster;
  onRoll: (title: string, result: string) => void;
  triggerId?: string;
}

export function QuickRoller({ monster, onRoll, triggerId }: QuickRollerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [mode, setMode] = useState<'check' | 'save'>('check');
  const openButtonRef = useRef<HTMLButtonElement>(null);
  const modalHeadingRef = useRef<HTMLHeadingElement>(null);

  const buttonId = triggerId || `quick-roller-${monster.id}`;

  useEffect(() => {
    if (isOpen && modalHeadingRef.current) {
      modalHeadingRef.current.focus();
    } else if (!isOpen && openButtonRef.current) {
      openButtonRef.current.focus();
    }
  }, [isOpen]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape' && isOpen) {
      e.preventDefault();
      e.stopPropagation();
      setIsOpen(false);
    }

    // Prevent default behavior for Enter/Space on non-button focused elements (like the heading)
    // to avoid potential page scroll/teleport issues.
    if ((e.key === 'Enter' || e.key === ' ') && !(e.target instanceof HTMLButtonElement || e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement)) {
      e.preventDefault();
    }
  };

  const rollSave = (stat: keyof Monster['stats']) => {
    const mod = getSaveModifier(monster, stat);
    const { visualStr } = formatD20Roll(mod);
    onRoll(`${stat} Save`, visualStr);
    setIsOpen(false);
  };

  const rollSkill = (skill: string) => {
    const mod = getSkillModifier(monster, skill);
    const { visualStr } = formatD20Roll(mod);
    onRoll(`${skill} Check`, visualStr);
    setIsOpen(false);
  };

  const rollStat = (stat: keyof Monster['stats']) => {
    const mod = monster.stats[stat]?.modifier || 0;
    const { visualStr } = formatD20Roll(mod);
    onRoll(`${stat} Check`, visualStr);
    setIsOpen(false);
  };

  const skillsByStat: Record<string, string[]> = {};
  DND_SAVES.forEach(s => skillsByStat[s] = []);
  Object.entries(DND_SKILLS).forEach(([skill, stat]) => {
    if (skillsByStat[stat]) {
      skillsByStat[stat].push(skill);
    }
  });

  return (
    <>
      <button type="button" 
        id={buttonId}
        ref={openButtonRef}
        onClick={() => setIsOpen(true)} 
        style={{ padding: '0.25rem 0.5rem', fontSize: '0.9em', cursor: 'pointer' }}
      >
        Skill Check
      </button>

      {isOpen && (
        <div 
          role="dialog" 
          aria-modal="true" 
          aria-labelledby="quick-roller-title" 
          onKeyDown={handleKeyDown}
          style={{
            position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
            backgroundColor: '#fff', color: '#333', padding: '1.5rem', borderRadius: '8px',
            boxShadow: '0 4px 12px rgba(0,0,0,0.5)', zIndex: 1005, minWidth: '300px',
            maxHeight: '80vh', overflowY: 'auto'
          }}
        >
          <h3 id="quick-roller-title" ref={modalHeadingRef} tabIndex={-1} style={{ outline: 'none', margin: '0 0 1rem 0' }}>
            {mode === 'check' ? 'Skill Checks' : 'Saving Throws'}
          </h3>
          
          <div style={{ marginBottom: '1rem' }}>
            <button 
              type="button"
              onClick={() => setMode(mode === 'check' ? 'save' : 'check')}
              style={{ padding: '0.5rem', width: '100%', fontSize: '1rem', cursor: 'pointer' }}
            >
              Switch to {mode === 'check' ? 'Saves' : 'Checks'}
            </button>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            {DND_SAVES.map(stat => (
              <div key={stat} style={{ border: '1px solid #ccc', padding: '0.5rem', borderRadius: '4px' }}>
                <h4 style={{ margin: '0 0 0.5rem 0' }}>{stat}</h4>
                {mode === 'save' ? (
                  <button 
                    type="button"
                    onClick={() => rollSave(stat)}
                    style={{ padding: '0.25rem 0.5rem', width: '100%', cursor: 'pointer' }}
                  >
                    {stat} Save ({getSaveModifier(monster, stat) >= 0 ? '+' : ''}{getSaveModifier(monster, stat)})
                  </button>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                    <button type="button" onClick={() => rollStat(stat)} style={{ padding: '0.25rem 0.5rem', textAlign: 'left', cursor: 'pointer' }}>
                      {stat} Check ({(monster.stats[stat]?.modifier || 0) >= 0 ? '+' : ''}{monster.stats[stat]?.modifier || 0})
                    </button>
                    {skillsByStat[stat].map(skill => (
                      <button type="button" key={skill} onClick={() => rollSkill(skill)} style={{ padding: '0.25rem 0.5rem', textAlign: 'left', cursor: 'pointer' }}>
                        {skill} ({getSkillModifier(monster, skill) >= 0 ? '+' : ''}{getSkillModifier(monster, skill)})
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>

          <div style={{ marginTop: '1rem', textAlign: 'right' }}>
            <button type="button" onClick={() => setIsOpen(false)} style={{ padding: '0.5rem 1rem', cursor: 'pointer' }}>
              Close (Esc)
            </button>
          </div>
        </div>
      )}
    </>
  );
}
