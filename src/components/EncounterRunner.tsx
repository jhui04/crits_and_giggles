import { useState, useEffect, useCallback, useRef } from 'react';
import { DiceService } from '../services/DiceService';
import { MonsterDetails } from './MonsterDetails';
import { QuickRoller } from './QuickRoller';
import type { Encounter, EncounterUnit } from '../types';
import { useCampaigns } from '../context/CampaignContext';

export function EncounterRunner({ targetEncounterId }: { targetEncounterId?: string | null }) {
  const { activeCampaign } = useCampaigns();
  const [activeEncounter, setActiveEncounter] = useState<Encounter | null>(null);
  const [combatants, setCombatants] = useState<EncounterUnit[]>([]);
  const [turnIndex, setTurnIndex] = useState(0);
  const [isCombatStarted, setIsCombatStarted] = useState(false);
  const [announcement, setAnnouncement] = useState('');
  const [selectedUnit, setSelectedUnit] = useState<EncounterUnit | null>(null);
  const [hpMods, setHpMods] = useState<Record<string, string>>({});
  
  const [activeRoll, setActiveRoll] = useState<{ title: string, hit?: string, damage?: string, unitName?: string } | null>(null);
  const rollModalRef = useRef<HTMLHeadingElement>(null);

  const unitRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const detailHeadingRef = useRef<HTMLHeadingElement>(null);
  const runnerHeadingRef = useRef<HTMLHeadingElement>(null);
  const lastFocusedUnitId = useRef<string | null>(null);
  const lastActiveRollButtonRef = useRef<HTMLElement | null>(null);

  const loadEncounter = useCallback((encounter: Encounter) => {
    setActiveEncounter(encounter);
    setCombatants(encounter.units.map(u => ({ ...u })));
    setIsCombatStarted(false);
    setTurnIndex(0);
    setHpMods({});
  }, []);

  useEffect(() => {
    if (activeEncounter) {
      setTimeout(() => {
        runnerHeadingRef.current?.focus();
      }, 0);
    }
  }, [activeEncounter]);

  useEffect(() => {
    if (targetEncounterId && activeCampaign) {
      const encounter = activeCampaign.encounters.find(e => e.id === targetEncounterId);
      if (encounter) {
        loadEncounter(encounter);
      }
    }
  }, [targetEncounterId, activeCampaign, loadEncounter]);

  useEffect(() => {
    if (activeRoll && rollModalRef.current) {
      rollModalRef.current.focus();
    } else if (!activeRoll && lastActiveRollButtonRef.current) {
      lastActiveRollButtonRef.current.focus();
      lastActiveRollButtonRef.current = null;
    }
  }, [activeRoll]);

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

  const closeRollModal = useCallback(() => {
    setActiveRoll(null);
  }, []);

  // Global Keyboard Listeners
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Escape
      if (e.key === 'Escape' && !e.defaultPrevented) {
        if (activeRoll) {
          e.preventDefault();
          closeRollModal();
        } else if (selectedUnit) {
          e.preventDefault();
          closeDetails();
        }
      }
      
      // Alt + N for Next Turn
      if (e.altKey && e.key.toLowerCase() === 'n') {
        e.preventDefault();
        nextTurn();
      }

      // Prevent default behavior for Enter/Space on non-button focused elements (like the heading)
      // to avoid potential page scroll/teleport issues.
      if ((e.key === 'Enter' || e.key === ' ') && !(e.target instanceof HTMLButtonElement || e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement)) {
        e.preventDefault();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [nextTurn, selectedUnit, activeRoll, closeDetails, closeRollModal]);

  // Focus management for details modal
  useEffect(() => {
    if (selectedUnit) {
      detailHeadingRef.current?.focus();
    } else if (lastFocusedUnitId.current) {
      unitRefs.current[lastFocusedUnitId.current]?.focus();
      lastFocusedUnitId.current = null;
    }
  }, [selectedUnit]);

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

  const applyHpMod = (instanceId: string, isDamage: boolean) => {
    const val = parseInt(hpMods[instanceId] || '0', 10);
    if (!val || isNaN(val)) return;
    
    setCombatants(prev => prev.map(u => {
      if (u.instanceId === instanceId) {
        if (u.isPlayer) return u;
        
        const newHp = isDamage 
          ? Math.max(0, (u.currentHp || 0) - val) 
          : Math.min((u.maxHp || 0), (u.currentHp || 0) + val);
        
        setAnnouncement(`${u.name} takes ${val} ${isDamage ? 'damage' : 'healing'}. New HP is ${newHp}.`);
        return { ...u, currentHp: newHp };
      }
      return u;
    }));
    
    setHpMods(prev => ({ ...prev, [instanceId]: '' }));
    
    // Update selectedUnit if it's currently open so modal updates live
    if (selectedUnit && selectedUnit.instanceId === instanceId) {
      setSelectedUnit(prev => {
        if (!prev) return prev;
        const newHp = isDamage 
          ? Math.max(0, (prev.currentHp || 0) - val) 
          : Math.min((prev.maxHp || 0), (prev.currentHp || 0) + val);
        return { ...prev, currentHp: newHp };
      });
    }
  };

  const handleInlineRoll = (e: React.MouseEvent<HTMLElement> | null, unitName: string, title: string, hit: string) => {
    if (e) {
      lastActiveRollButtonRef.current = e.currentTarget as HTMLElement;
    } else {
      lastActiveRollButtonRef.current = document.activeElement as HTMLElement;
    }
    
    // Announce to screen reader using the robust string format
    const hitVal = hit.split(',')[0];
    setAnnouncement(`${unitName} rolled ${title}: ${hitVal}`);

    setActiveRoll({
      title,
      hit,
      unitName
    });
  };

  if (!activeEncounter) {
    const campaignEncounters = activeCampaign?.encounters || [];
    return (
      <section>
        <h3 ref={runnerHeadingRef} tabIndex={-1} style={{ outline: 'none' }}>Load Encounter</h3>
        {!activeCampaign ? <p>Please select a campaign in Create Mode.</p> :
         campaignEncounters.length === 0 ? <p>No saved encounters found. Go to Create Mode to build one.</p> : (
          <ul style={{ listStyle: 'none', padding: 0 }}>
            {campaignEncounters.map(e => (
              <li key={e.id}>
                <button type="button" data-fuzzer-category="encounter-load" onClick={() => loadEncounter(e)}>Load "{e.name}"</button>
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
        <h3 ref={runnerHeadingRef} tabIndex={-1} style={{ outline: 'none' }}>Running: {activeEncounter.name}</h3>
        <button type="button" onClick={() => setActiveEncounter(null)}>Close Encounter</button>
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
          <button type="button" onClick={startCombat} style={{ marginTop: '1rem' }}>Start Combat</button>
        </section>
      ) : (
        <section>
          <h4>Initiative Track</h4>
          <p>Use <strong>Tab</strong> to navigate. <strong>Enter</strong> for details. <strong>Alt + N</strong> for next turn.</p>
          <button type="button" onClick={nextTurn} style={{ marginBottom: '1rem' }}>Next Turn (Alt+N)</button>
          
          <ul style={{ listStyle: 'none', padding: 0 }} role="list">
            {combatants.map((u, i) => (
              <li key={u.instanceId} style={{ marginBottom: '1rem', border: i === turnIndex ? '3px solid #000' : '1px solid #eee', padding: '0.5rem', backgroundColor: i === turnIndex ? '#f0f8ff' : 'white' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                  <button
                    type="button"
                    ref={(el) => { unitRefs.current[u.instanceId] = el; }}
                    onClick={() => openUnitDetails(u)}
                    style={{ flexGrow: 1, textAlign: 'left', background: 'transparent', border: 'none', padding: '0.5rem', fontSize: '1.1rem', fontWeight: 'bold' }}
                    aria-current={i === turnIndex ? 'step' : undefined}
                  >
                    <span className="sr-only">{i === turnIndex ? "Current Turn" : ""}</span>
                    {u.initiative} - {u.name} {u.isPlayer ? '(Player)' : `(HP: ${u.currentHp}/${u.maxHp})`}
                  </button>
                </div>
                {!u.isPlayer && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', alignItems: 'center', padding: '0 0.5rem' }}>
                    <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                      <label htmlFor={`hpmod-${u.instanceId}`} className="sr-only">HP Modifier for {u.name}</label>
                      <input 
                        id={`hpmod-${u.instanceId}`}
                        type="number"
                        placeholder="Amount"
                        value={hpMods[u.instanceId] || ''}
                        onChange={e => setHpMods(prev => ({...prev, [u.instanceId]: e.target.value}))}
                        style={{ width: '80px', padding: '0.25rem' }}
                      />
                      <button type="button" onClick={() => applyHpMod(u.instanceId, true)} style={{ padding: '0.25rem 0.5rem', fontSize: '0.9em' }}>Damage</button>
                      <button type="button" onClick={() => applyHpMod(u.instanceId, false)} style={{ padding: '0.25rem 0.5rem', fontSize: '0.9em' }}>Heal</button>
                    </div>
                    {u.fullData && (
                      <QuickRoller 
                        monster={u.fullData} 
                        triggerId={`quick-roller-${u.instanceId}`}
                        onRoll={(title, hit) => handleInlineRoll(null, u.name, title, hit)} 
                      />
                    )}
                  </div>
                )}
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
                onAnnounce={setAnnouncement}
              />
            ) : null}

            <button type="button" onClick={closeDetails} style={{ marginTop: '1.5rem', width: '100%', padding: '0.5rem' }}>
              Close Details (Esc)
            </button>
          </div>
        </div>
      )}

      {activeRoll && (
        <div role="dialog" aria-modal="true" aria-labelledby="encounter-roll-result-title" style={{
          position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
          backgroundColor: '#333', color: 'white', padding: '1.5rem', borderRadius: '8px',
          boxShadow: '0 4px 6px rgba(0,0,0,0.3)', zIndex: 1002, minWidth: '250px', textAlign: 'center'
        }}>
          <h4 id="encounter-roll-result-title" ref={rollModalRef} tabIndex={-1} style={{ outline: 'none', margin: '0 0 1rem 0' }}>
            {activeRoll.unitName} - {activeRoll.title}
          </h4>
          
          <p style={{ fontSize: '1.2rem', marginBottom: '1rem' }}>
            <strong>Result:</strong> {activeRoll.hit}
          </p>

          <button type="button" onClick={closeRollModal} style={{ padding: '0.5rem 1rem', fontSize: '1rem', backgroundColor: '#fff', color: '#333', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>
            Close (Esc)
          </button>
        </div>
      )}
    </div>
  );
}
