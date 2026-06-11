import { useState, useRef, useEffect } from 'react';
import type { EncounterUnit } from '../types';
import { DiceService } from '../services/DiceService';
import { getSaveModifier, getSkillModifier, DND_SKILLS_BY_ABILITY } from '../utils/dnd';

interface MonsterOperationsModalProps {
  unit: EncounterUnit;
  onClose: () => void;
  onApplyHpMod: (instanceId: string, isDamage: boolean, amount: number) => void;
  onRoll: (title: string, hit: string, damage?: string) => void;
  onAnnounce: (msg: string) => void;
}

type ViewMode = 'MAIN' | 'DAMAGE' | 'HEAL' | 'ACTIONS' | 'SKILLS' | 'SAVES';

export function MonsterOperationsModal({ unit, onClose, onApplyHpMod, onRoll, onAnnounce }: MonsterOperationsModalProps) {
  const [view, setView] = useState<ViewMode>('MAIN');
  const [hpAmount, setHpAmount] = useState<string>('');
  const headingRef = useRef<HTMLHeadingElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const firstButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    // Focus heading on open
    if (unit.fullData) {
      headingRef.current?.focus();
    }
  }, [unit.fullData]);

  useEffect(() => {
    // Focus first interactive element when view changes
    if (view === 'DAMAGE' || view === 'HEAL') {
      inputRef.current?.focus();
    } else if (view !== 'MAIN') {
      firstButtonRef.current?.focus();
    }
  }, [view]);

  const monster = unit.fullData;
  if (!monster) return null;

  const handleApplyHp = (isDamage: boolean) => {
    const val = parseInt(hpAmount, 10);
    if (!isNaN(val) && val > 0) {
      onApplyHpMod(unit.instanceId, isDamage, val);
      onClose();
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

  const rollAction = (actionName: string, bonus?: number, damageDice?: {dice: string, type: string}[]) => {
    let hitVisual: string | undefined;
    let damageResultString: string | undefined;
    const announceParts = [];

    if (bonus !== undefined) {
      const { announceStr, visualStr } = getD20Details(bonus);
      hitVisual = visualStr;
      announceParts.push(`${announceStr} to hit`);
    }

    if (damageDice && damageDice.length > 0) {
      const results = damageDice.map(d => {
         const res = DiceService.roll(d.dice);
         return `${res.total} ${d.type}`;
      });
      damageResultString = results.join(' and ');
      announceParts.push(`${damageResultString} damage`);
    }

    const msg = `${unit.name} uses ${actionName}${announceParts.length > 0 ? ': ' + announceParts.join(', ') : ''}`;
    onAnnounce(msg);
    onRoll(actionName, hitVisual || 'Rolled', damageResultString);
  };

  const rollSimple = (title: string, mod: number) => {
    const { announceStr, visualStr } = getD20Details(mod);
    onAnnounce(`${unit.name} rolled ${title}: ${announceStr}`);
    onRoll(title, visualStr);
  };

  const renderMain = () => (
    <div style={{ display: 'grid', gap: '0.75rem' }}>
      <button type="button" onClick={() => setView('DAMAGE')}>Damage</button>
      <button type="button" onClick={() => setView('HEAL')}>Heal</button>
      <button type="button" onClick={() => setView('ACTIONS')}>Actions</button>
      <button type="button" onClick={() => setView('SKILLS')}>Skill Checks</button>
      <button type="button" onClick={() => setView('SAVES')}>Saving Throws</button>
    </div>
  );

  const renderHpInput = (isDamage: boolean) => (
    <form onSubmit={(e) => { e.preventDefault(); handleApplyHp(isDamage); }}>
      <label htmlFor="hp-amount">{isDamage ? 'Damage' : 'Heal'} Amount:</label>
      <input 
        id="hp-amount"
        ref={inputRef}
        type="number" 
        value={hpAmount} 
        onChange={e => setHpAmount(e.target.value)} 
        style={{ width: '100%', padding: '0.5rem', margin: '0.5rem 0' }}
      />
      <div style={{ display: 'flex', gap: '0.5rem' }}>
        <button type="submit" style={{ flex: 1 }}>Apply</button>
        <button type="button" onClick={() => setView('MAIN')} style={{ flex: 1 }}>Back</button>
      </div>
    </form>
  );

  const renderActions = () => (
    <div style={{ display: 'grid', gap: '0.5rem' }}>
      {monster.actions.map((a, i) => (
        <button 
          key={a.name} 
          ref={i === 0 ? firstButtonRef : null}
          type="button" 
          onClick={() => rollAction(a.name, a.attack_bonus, a.damage)}
        >
          {a.name}
        </button>
      ))}
      <button type="button" onClick={() => setView('MAIN')} style={{ marginTop: '0.5rem' }}>Back</button>
    </div>
  );

  const renderSkills = () => {
    return (
      <div style={{ display: 'grid', gap: '0.75rem', maxHeight: '60vh', overflowY: 'auto', paddingRight: '0.5rem' }}>
        {Object.entries(DND_SKILLS_BY_ABILITY).map(([ability, skills], groupIdx) => (
          <div key={ability} style={{ border: '1px solid #eee', padding: '0.5rem', borderRadius: '4px' }}>
            <h4 style={{ margin: '0 0 0.5rem 0', fontSize: '0.9rem', color: '#666' }}>{ability} Skills</h4>
            <div style={{ display: 'grid', gap: '0.25rem' }}>
              {skills.map((skill, skillIdx) => {
                const mod = getSkillModifier(monster, skill);
                return (
                  <button 
                    key={skill} 
                    ref={groupIdx === 0 && skillIdx === 0 ? firstButtonRef : null}
                    type="button" 
                    onClick={() => rollSimple(`${skill} Check`, mod)}
                    style={{ textAlign: 'left', padding: '0.4rem 0.6rem' }}
                  >
                    {skill} ({mod >= 0 ? '+' : ''}{mod})
                  </button>
                );
              })}
            </div>
          </div>
        ))}
        <button type="button" onClick={() => setView('MAIN')} style={{ marginTop: '0.5rem' }}>Back</button>
      </div>
    );
  };

  const renderSaves = () => (
    <div style={{ display: 'grid', gap: '0.5rem', gridTemplateColumns: '1fr 1fr' }}>
      {Object.entries(monster.stats).map(([key], i) => {
        const mod = getSaveModifier(monster, key);
        return (
          <button 
            key={key} 
            ref={i === 0 ? firstButtonRef : null}
            type="button" 
            onClick={() => rollSimple(`${key} Save`, mod)}
          >
            {key}: {mod >= 0 ? '+' : ''}{mod}
          </button>
        );
      })}
      <button type="button" onClick={() => setView('MAIN')} style={{ gridColumn: 'span 2', marginTop: '0.5rem' }}>Back</button>
    </div>
  );

  return (
    <div 
      className="monster-operations-modal" 
      role="dialog" 
      aria-modal="true" 
      aria-labelledby="ops-modal-title"
      style={{
        position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, 
        backgroundColor: 'rgba(0,0,0,0.5)', display: 'flex', 
        alignItems: 'center', justifyContent: 'center', zIndex: 1100
      }}
    >
      <div style={{ backgroundColor: 'white', padding: '1.5rem', borderRadius: '8px', maxWidth: '400px', width: '90%' }}>
        <h3 id="ops-modal-title" ref={headingRef} tabIndex={-1} style={{ outline: 'none', marginTop: 0 }}>
          {unit.name} Actions
        </h3>

        {view === 'MAIN' && renderMain()}
        {view === 'DAMAGE' && renderHpInput(true)}
        {view === 'HEAL' && renderHpInput(false)}
        {view === 'ACTIONS' && renderActions()}
        {view === 'SKILLS' && renderSkills()}
        {view === 'SAVES' && renderSaves()}

        <button 
          type="button" 
          onClick={onClose} 
          style={{ width: '100%', marginTop: '1rem', padding: '0.5rem', border: '1px solid #ccc' }}
        >
          Close (Esc)
        </button>
      </div>
    </div>
  );
}
