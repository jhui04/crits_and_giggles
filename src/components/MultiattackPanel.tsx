import { useMemo, useState } from 'react';
import { DisclosureSelect } from './DisclosureSelect';
import { parseMultiattack } from '../utils/multiattack';
import type { MultiattackActionLike, MultiattackOption, MultiattackSegment } from '../utils/multiattack';
import { DiceService } from '../services/DiceService';
import { diceLogService } from '../services/DiceLogService';

/** Result of rolling one attack (to-hit and damage), logged to the dice log by the caller's roller. */
export interface AttackRollResult {
  /** One comma-free sentence, e.g. "Claw: 17 to hit and 8 slashing damage". */
  line: string;
}

interface MultiattackPanelProps {
  /** The Multiattack action itself (name + raw text). */
  multiattack: { name: string; content: string };
  /** Every action of the monster; constituent attacks are resolved against these. */
  actions: MultiattackActionLike[];
  traits?: MultiattackActionLike[];
  unitName: string;
  /** Rolls and dice-logs a single attack. */
  rollAttack: (actionName: string, bonus?: number, damage?: { dice: string; type: string }[]) => AttackRollResult;
  /** Reports a finished multiattack: title and one comma-free summary. */
  onRolled: (title: string, summary: string) => void;
  /** Index used to keep element ids unique when a monster has several Multiattack actions. */
  index: number;
}

function optionName(o: MultiattackOption): string {
  return o.condition ? `${o.condition}: ${o.label}` : o.label;
}

function baseName(name: string): string {
  return name.replace(/\([^)]*\)/g, ' ').replace(/[.:]+\s*$/, '').replace(/\s+/g, ' ').trim();
}

/**
 * Accessible Multiattack roller. Shows the raw Multiattack text, then either
 * one "Roll ..." button (a single option) or a DisclosureSelect to choose the
 * option plus a Roll button. When the text cannot be parsed the raw text is
 * still shown and the plain action button (rendered by the caller) remains.
 */
export function MultiattackPanel({ multiattack, actions, traits = [], unitName, rollAttack, onRolled, index }: MultiattackPanelProps) {
  const parse = useMemo(() => parseMultiattack(multiattack.content, actions, traits), [multiattack.content, actions, traits]);
  const [selected, setSelected] = useState('0');
  const options = parse.options;
  const current = options[Math.min(Number(selected) || 0, options.length - 1)];

  const rollOption = (option: MultiattackOption) => {
    const lines: string[] = [];
    const skipped: string[] = [];
    for (const seg of option.segments as MultiattackSegment[]) {
      if (seg.kind !== 'attack' || !seg.actionName) {
        skipped.push(seg.actionName ?? seg.phrase);
        continue;
      }
      const action = actions.concat(traits).find(a => baseName(a.name) === seg.actionName);
      if (!action) { skipped.push(seg.actionName); continue; }
      let times = seg.count;
      if (seg.countDice) {
        const r = DiceService.roll(seg.countDice);
        times = Math.max(1, r.total);
        diceLogService.logRoll({
          source: unitName,
          purpose: `${multiattack.name} (number of ${seg.actionName} attacks)`,
          formula: seg.countDice,
          rolls: r.rolls,
          modifier: r.modifier,
          total: r.total,
        });
      }
      for (let n = 0; n < times; n++) {
        lines.push(rollAttack(action.name, action.attack_bonus, action.damage).line);
      }
    }
    let summary = lines.join('; ');
    if (skipped.length > 0) summary += `${summary ? '; ' : ''}Not rolled: ${skipped.join(' and ')}`;
    onRolled(`${multiattack.name} (${optionName(option)})`, summary || 'Nothing to roll');
  };

  return (
    <div role="group" aria-label={multiattack.name} style={{ display: 'grid', gap: '0.5rem', border: '1px solid #ccc', borderRadius: '4px', padding: '0.5rem' }}>
      <p style={{ margin: 0 }}><strong>{multiattack.name}:</strong> {multiattack.content}</p>
      {parse.status === 'unparsed' || !current ? (
        <p style={{ margin: 0 }}>This Multiattack could not be broken into separate attacks; roll the individual attacks below.</p>
      ) : (
        <>
          {options.length > 1 && (
            <DisclosureSelect
              id={`multiattack-option-${index}`}
              label={`${multiattack.name} Option`}
              value={String(options.indexOf(current))}
              onChange={setSelected}
              options={options.map((o, i) => ({ value: String(i), label: optionName(o) }))}
            />
          )}
          <button type="button" onClick={() => rollOption(current)}>Roll {optionName(current)}</button>
          {parse.notes.length > 0 && (
            <ul style={{ margin: 0, paddingLeft: '1.25rem' }} aria-label={`${multiattack.name} notes`}>
              {parse.notes.map((n, i) => <li key={i}>{n}</li>)}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
