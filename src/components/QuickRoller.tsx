import { useState } from 'react';
import type { Monster } from '../types';
import { getSkillModifier, getSaveModifier, DND_SKILLS, DND_SAVES, formatD20Roll } from '../utils/dnd';

interface QuickRollerProps {
  monster: Monster;
  onRoll: (title: string, hit: string) => void;
}

export function QuickRoller({ monster, onRoll }: QuickRollerProps) {
  const [selectedRoll, setSelectedRoll] = useState<string>('save-STR');

  const handleRoll = () => {
    let mod = 0;
    let rollName = '';

    if (selectedRoll.startsWith('save-')) {
      const stat = selectedRoll.replace('save-', '') as keyof Monster['stats'];
      mod = getSaveModifier(monster, stat);
      rollName = `${stat} Save`;
    } else if (selectedRoll.startsWith('skill-')) {
      const skill = selectedRoll.replace('skill-', '');
      mod = getSkillModifier(monster, skill);
      rollName = `${skill} Check`;
    }

    const { visualStr } = formatD20Roll(mod);
    onRoll(rollName, visualStr);
  };

  return (
    <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
      <label htmlFor={`quick-roll-${monster.id}`} className="sr-only">Quick Roll for {monster.name}</label>
      <select 
        id={`quick-roll-${monster.id}`}
        value={selectedRoll}
        onChange={e => setSelectedRoll(e.target.value)}
        style={{ padding: '0.25rem', width: '130px' }}
      >
        <optgroup label="Saves">
          {DND_SAVES.map(s => <option key={`save-${s}`} value={`save-${s}`}>{s} Save</option>)}
        </optgroup>
        <optgroup label="Skills">
          {Object.keys(DND_SKILLS).map(s => <option key={`skill-${s}`} value={`skill-${s}`}>{s}</option>)}
        </optgroup>
      </select>
      <button onClick={handleRoll} style={{ padding: '0.25rem 0.5rem', fontSize: '0.9em' }}>Roll</button>
    </div>
  );
}
