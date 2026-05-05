import { useState, useEffect, useCallback, useRef } from 'react';
import { DiceService } from '../services/DiceService';
import { MonsterDetails } from './MonsterDetails';
import type { Encounter, EncounterUnit } from './EncounterBuilder';

export function EncounterRunner() {
  const [savedEncounters, setSavedEncounters] = useState<Encounter[]>([]);
  const [activeEncounter, setActiveEncounter] = useState<Encounter | null>(null);
  const [combatants, setCombatants] = useState<EncounterUnit[]>([]);
  const [turnIndex, setTurnIndex] = useState(0);
  const [isCombatStarted, setIsCombatStarted] = useState(false);
  const [announcement, setAnnouncement] = useState('');
  const [selectedUnit, setSelectedUnit] = useState<EncounterUnit | null>(null);

  const unitRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const detailHeadingRef = useRef<HTMLHeadingElement>(null);
  const lastFocusedUnitId = useRef<string | null>(null);

  useEffect(() => {
    const saved = JSON.parse(localStorage.getItem('saved_encounters') || '[]');
    setSavedEncounters(saved);
  }, []);

  const nextTurn = useCallback(() => {
    if (!isCombatStarted || combatants.length === 0) return;
    setTurnIndex((prev) => {
      const nextIndex = (prev + 1) % combatants.length;
      const current = combatants[nextIndex];
      const following = combatants[(nextIndex + 1) % combatants.length];
      setAnnouncement(`Current turn: ${current.name}. Next up: ${following.name}.`);
      return nextIndex;
    });
  }, [isCombatStarted, combatants]);

  const closeDetails = useCallback(() => {
    setSelectedUnit(null);
  }, []);

  // Global Keyboard Listeners
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Alt + N for Next Turn
      if (e.altKey && e.key.toLowerCase() === 'n') {
        e.preventDefault();
        nextTurn();
      }
      // Escape to close details
      if (e.key === 'Escape' && selectedUnit) {
        e.preventDefault();
        closeDetails();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [nextTurn, selectedUnit, closeDetails]);

  // Focus management for details modal
  useEffect(() => {
    if (selectedUnit) {
      detailHeadingRef.current?.focus();
    } else if (lastFocusedUnitId.current) {
      unitRefs.current[lastFocusedUnitId.current]?.focus();
      lastFocusedUnitId.current = null;
    }
  }, [selectedUnit]);

  const loadEncounter = (encounter: Encounter) => {
    setActiveEncounter(encounter);
    setCombatants(encounter.units.map(u => ({ ...u })));
    setIsCombatStarted(false);
    setTurnIndex(0);
  };

  const updateInitiative = (instanceId: string, val: string) => {
    const num = parseInt(val, 10) || 0;
    setCombatants(prev => prev.map(u => u.instanceId === instanceId ? { ...u, initiative: num } : u));
  };

  const startCombat = () => {
    const rolledCombatants = combatants.map(u => {
      let hp = { max: u.maxHp || 1, current: u.currentHp || 1 };
      
      if (!u.isPlayer && u.hpDice) {
        const roll = DiceService.roll(u.hpDice).total;
        hp.max = roll;
        hp.current = roll;
      }

      return {
        ...u,
        maxHp: hp.max,
        currentHp: hp.current,
        initiative: u.initiative !== undefined ? u.initiative : (u.isPlayer ? 0 : DiceService.rollSimple(20, u.dexMod))
      };
    });

    const sorted = [...rolledCombatants].sort((a, b) => (b.initiative || 0) - (a.initiative || 0));
    setCombatants(sorted);
    setIsCombatStarted(true);
    setTurnIndex(0);
    setAnnouncement(`Combat started. First up is ${sorted[0].name}.`);
  };

  const openUnitDetails = (unit: EncounterUnit) => {
    lastFocusedUnitId.current = unit.instanceId;
    setSelectedUnit(unit);
  };

  if (!activeEncounter) {
    return (
      <section>
        <h3>Load Encounter</h3>
        {savedEncounters.length === 0 ? <p>No saved encounters found. Go to Create Mode to build one.</p> : (
          <ul style={{ listStyle: 'none', padding: 0 }}>
            {savedEncounters.map(e => (
              <li key={e.id}>
                <button onClick={() => loadEncounter(e)}>Load "{e.name}"</button>
              </li>
            ))}
          </ul>
        )}
      </section>
    );
  }

  return (
    <div className="encounter-runner">
      <header>
        <h3>Running: {activeEncounter.name}</h3>
        <button onClick={() => setActiveEncounter(null)}>Close Encounter</button>
      </header>

      <div aria-live="assertive" className="sr-only">
        {announcement}
      </div>

      {!isCombatStarted ? (
        <section>
          <h4>Initiative Setup</h4>
          <p>Enter player initiatives and click Start. Monsters will auto-roll health and initiative.</p>
          <ul style={{ listStyle: 'none', padding: 0 }}>
            {combatants.map(u => (
              <li key={u.instanceId} style={{ marginBottom: '0.5rem' }}>
                <label htmlFor={`init-${u.instanceId}`} style={{ marginRight: '1rem' }}>{u.name}:</label>
                <input 
                  id={`init-${u.instanceId}`}
                  type="number" 
                  value={u.initiative ?? ''} 
                  onChange={(e) => updateInitiative(u.instanceId, e.target.value)}
                  placeholder={u.isPlayer ? "Required" : "Auto"}
                />
              </li>
            ))}
          </ul>
          <button onClick={startCombat} style={{ marginTop: '1rem' }}>Start Combat</button>
        </section>
      ) : (
        <section>
          <h4>Initiative Track</h4>
          <p>Use <strong>Arrow Keys</strong> to navigate. <strong>Enter</strong> for details. <strong>Alt + N</strong> for next turn.</p>
          <button onClick={nextTurn} style={{ marginBottom: '1rem' }}>Next Turn (Alt+N)</button>
          
          <ul style={{ listStyle: 'none', padding: 0 }} role="list">
            {combatants.map((u, i) => (
              <li key={u.instanceId} style={{ marginBottom: '0.5rem' }}>
                <button
                  ref={(el) => { unitRefs.current[u.instanceId] = el; }}
                  onClick={() => openUnitDetails(u)}
                  style={{ 
                    width: '100%',
                    textAlign: 'left',
                    padding: '1rem', 
                    border: i === turnIndex ? '3px solid #000' : '1px solid #eee',
                    backgroundColor: i === turnIndex ? '#f0f8ff' : 'white',
                    display: 'block'
                  }}
                  aria-current={i === turnIndex ? 'step' : undefined}
                >
                  <span className="sr-only">{i === turnIndex ? "Current Turn" : ""}</span>
                  <strong>{u.initiative}</strong> - {u.name} {u.isPlayer ? '(Player)' : `(HP: ${u.currentHp}/${u.maxHp})`}
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {selectedUnit && (
        <div className="unit-details-modal" role="dialog" aria-modal="true" aria-labelledby="unit-detail-title" style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, 
          backgroundColor: 'rgba(0,0,0,0.5)', display: 'flex', 
          alignItems: 'center', justifyContent: 'center', zIndex: 1001
        }}>
          <div style={{ backgroundColor: 'white', padding: '2rem', borderRadius: '8px', maxWidth: '600px', width: '90%', maxHeight: '90vh', overflowY: 'auto' }}>
            <h3 id="unit-detail-title" ref={detailHeadingRef} tabIndex={-1} style={{ outline: 'none' }}>
              {selectedUnit.name} Details
            </h3>
            
            {selectedUnit.isPlayer ? (
              <section aria-labelledby="unit-detail-title">
                <p><strong>Initiative:</strong> {selectedUnit.initiative}</p>
                <p><strong>Passive Perception:</strong> {selectedUnit.passivePerception}</p>
              </section>
            ) : selectedUnit.fullData ? (
              <MonsterDetails 
                monster={selectedUnit.fullData} 
                currentHp={selectedUnit.currentHp} 
                maxHp={selectedUnit.maxHp} 
                initiative={selectedUnit.initiative} 
              />
            ) : null}

            <button onClick={closeDetails} style={{ marginTop: '1.5rem', width: '100%', padding: '0.5rem' }}>
              Close Details (Esc)
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
