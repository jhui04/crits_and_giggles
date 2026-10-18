import { useRef, useState, useEffect } from 'react';
import type { EncounterUnit } from '../types';
import { SRD_CONDITIONS, normalizeConditions, addCondition, removeCondition, formatConditions } from '../utils/conditions';
import type { ActiveCondition } from '../utils/conditions';
import { useFocusTrap } from './uiHelpers';

interface ConditionsModalProps {
  unit: EncounterUnit;
  /**
   * Whether `unit` is the combatant whose turn is currently active. A timed
   * condition newly applied this save is flagged `skipNextTick` when true,
   * so "N rounds" means N full rounds starting from this creature's *next*
   * turn rather than ticking down the instant Next Turn is pressed for the
   * turn still in progress. See the ActiveCondition doc comment in
   * src/utils/conditions.ts.
   */
  isCurrentActor: boolean;
  onClose: () => void;
  onSave: (instanceId: string, conditions: ActiveCondition[], announcement: string) => void;
}

/**
 * Lets the DM set which SRD conditions (plus custom ones) currently apply to
 * a combatant, and for how many rounds. Design choice: rather than a
 * duration input per checkbox (31 tab stops for 15 conditions), there is ONE
 * shared "Duration in rounds" field that is applied to whichever conditions
 * are newly checked in this save (leave blank for indefinite). This keeps
 * the common case — "apply Poisoned for 2 rounds" — to a handful of tab
 * stops instead of one per condition. A condition the unit already had
 * before this modal opened keeps its own existing duration untouched, even
 * if it's still checked and the DM fills in a different shared duration this
 * time — that field only ever applies to conditions being added right now.
 * A DM who wants, say, Poisoned for 1 round AND an indefinite Prone on the
 * same unit applies them in two short save actions (Prone first with the
 * duration field blank, then reopen and add Poisoned with "1"), rather than
 * one save silently giving both the same duration.
 */
export function ConditionsModal({ unit, isCurrentActor, onClose, onSave }: ConditionsModalProps) {
  const existing = normalizeConditions(unit.conditions);
  const [checked, setChecked] = useState<Set<string>>(new Set(existing.map(c => c.name)));
  // One shared "Duration in rounds" value, applied to every condition checked on save that
  // doesn't already carry its own duration from before this modal opened. See the module
  // doc comment above for why a per-checkbox duration field was rejected.
  const [sharedDuration, setSharedDuration] = useState<string>('');
  const [customName, setCustomName] = useState('');

  const headingRef = useRef<HTMLHeadingElement>(null);
  const modalContentRef = useRef<HTMLDivElement>(null);
  useFocusTrap(modalContentRef, true);

  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  // Includes any custom condition the DM has added this session (via addCustom, which
  // adds straight to `checked`) so it immediately gets a visible checkbox of its own.
  const allNames = Array.from(new Set([...SRD_CONDITIONS, ...existing.map(c => c.name), ...checked]));

  const toggle = (name: string) => {
    setChecked(prev => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  const addCustom = () => {
    const trimmed = customName.trim();
    if (!trimmed) return;
    setChecked(prev => new Set(prev).add(trimmed));
    setCustomName('');
  };

  const existingByName = new Map(existing.map(c => [c.name.toLowerCase(), c.roundsRemaining]));

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    const sharedRounds = sharedDuration !== '' ? parseInt(sharedDuration, 10) : undefined;
    const validSharedRounds = sharedRounds !== undefined && Number.isFinite(sharedRounds) && sharedRounds > 0 ? sharedRounds : undefined;

    let next: ActiveCondition[] = [];
    for (const name of checked) {
      const key = name.toLowerCase();
      // A condition that was already applied before this modal opened keeps its own
      // duration untouched. The shared duration field only applies to conditions
      // being newly checked in this save.
      const isNewlyTimed = !existingByName.has(key) && validSharedRounds !== undefined;
      const rounds = existingByName.has(key) ? existingByName.get(key) : validSharedRounds;
      // Only a condition newly given a duration THIS save needs the skip flag; a
      // pre-existing duration was already correctly timed when it was first applied.
      next = addCondition(next, name, rounds, isNewlyTimed && isCurrentActor);
    }
    for (const name of allNames) {
      if (!checked.has(name)) next = removeCondition(next, name);
    }

    const formatted = formatConditions(next);
    const announcement = formatted
      ? `${unit.name} is now ${formatted}.`
      : `${unit.name} has no conditions.`;
    onSave(unit.instanceId, next, announcement);
  };

  return (
    <div
      className="conditions-modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="conditions-modal-title"
      style={{
        position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
        backgroundColor: 'rgba(0,0,0,0.5)', display: 'flex',
        alignItems: 'center', justifyContent: 'center', zIndex: 1150
      }}
    >
      <div
        ref={modalContentRef}
        style={{ backgroundColor: 'white', padding: '1.5rem', borderRadius: '8px', maxWidth: '420px', width: '90%', maxHeight: '90vh', overflowY: 'auto' }}
      >
        <h3 id="conditions-modal-title" ref={headingRef} tabIndex={-1} style={{ outline: 'none', marginTop: 0 }}>
          Conditions for {unit.name}
        </h3>

        <form onSubmit={handleSave}>
          <fieldset style={{ border: '1px solid #ccc', borderRadius: '4px', padding: '0.75rem', marginBottom: '1rem' }}>
            <legend>Active Conditions</legend>
            <div style={{ display: 'grid', gap: '0.4rem' }}>
              {allNames.map(name => (
                <label key={name} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <input
                    type="checkbox"
                    checked={checked.has(name)}
                    onChange={() => toggle(name)}
                  />
                  {name}
                </label>
              ))}
            </div>
          </fieldset>

          <div style={{ marginBottom: '1rem' }}>
            <label htmlFor="conditions-shared-duration">
              Duration in rounds (ends at the end of the creature's turn; applied to any checked condition above without its own duration; leave blank for indefinite):
            </label>
            <input
              id="conditions-shared-duration"
              type="number"
              min={1}
              value={sharedDuration}
              onChange={e => setSharedDuration(e.target.value)}
              style={{ width: '100%', padding: '0.4rem', marginTop: '0.25rem' }}
            />
          </div>

          <div style={{ marginBottom: '1rem', display: 'flex', gap: '0.5rem', alignItems: 'flex-end' }}>
            <div style={{ flex: 1 }}>
              <label htmlFor="conditions-custom-name">Custom condition</label>
              <input
                id="conditions-custom-name"
                type="text"
                value={customName}
                onChange={e => setCustomName(e.target.value)}
                style={{ width: '100%', padding: '0.4rem', marginTop: '0.25rem' }}
              />
            </div>
            <button type="button" onClick={addCustom}>Add</button>
          </div>

          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button type="submit" style={{ flex: 1 }}>Save</button>
            <button type="button" onClick={onClose} style={{ flex: 1 }}>Cancel (Esc)</button>
          </div>
        </form>
      </div>
    </div>
  );
}
