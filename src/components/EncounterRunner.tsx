import { useState, useEffect, useCallback, useRef } from 'react';
import { DiceService } from '../services/DiceService';
import { MonsterDetails } from './MonsterDetails';
import { MonsterOperationsModal } from './MonsterOperationsModal';
import { CombatMap } from './CombatMap';
import { autoDeployUnits } from '../utils/mapUtils';
import type { Encounter, EncounterUnit, EncounterRunningState, Campaign, Position } from '../types';
import { useCampaigns } from '../context/CampaignContext';
import { dataService } from '../services/DataService';

export function EncounterRunner({ targetEncounterId }: { targetEncounterId?: string | null }) {
  const { campaigns, activeCampaign, setActiveCampaignId, updateCampaign } = useCampaigns();
  const [activeEncounter, setActiveEncounter] = useState<Encounter | null>(null);
  const [combatants, setCombatants] = useState<EncounterUnit[]>([]);
  const [turnIndex, setTurnIndex] = useState(0);
  const [round, setRound] = useState(1);
  const [isCombatStarted, setIsCombatStarted] = useState(false);
  const [announcement, setAnnouncement] = useState('');
  const [selectedUnit, setSelectedUnit] = useState<EncounterUnit | null>(null);
  const [activeOperationsUnit, setActiveOperationsUnit] = useState<EncounterUnit | null>(null);
  const [hpMods, setHpMods] = useState<Record<string, string>>({});

  const syncEncounterState = useCallback((
    updatedCombatants: EncounterUnit[],
    combatStarted: boolean = isCombatStarted,
    currentTurn: number = turnIndex,
    currentRound: number = round
  ) => {
    if (!activeCampaign || !activeEncounter) return;

    // Strip fullData to keep serialization small and clean
    const cleanCombatants = updatedCombatants.map(c => {
      const copy = { ...c };
      delete copy.fullData;
      return copy;
    });

    const runningState: EncounterRunningState = {
      isCombatStarted: combatStarted,
      round: currentRound,
      turnIndex: currentTurn,
      combatants: cleanCombatants,
      updatedAt: new Date().toISOString()
    };

    // Immediate synchronous localStorage update for instant page refresh recovery
    try {
      localStorage.setItem(`crits_encounter_${activeEncounter.id}`, JSON.stringify(runningState));
    } catch (e) {
      console.warn('Failed to sync encounter to localStorage:', e);
    }

    const updatedEncounter: Encounter = {
      ...activeEncounter,
      units: activeEncounter.units.map(u => {
        const found = updatedCombatants.find(c => c.instanceId === u.instanceId);
        if (found) {
          return {
            ...u,
            currentHp: found.currentHp,
            maxHp: found.maxHp,
            initiative: found.initiative,
            position: found.position
          };
        }
        return u;
      }),
      runningState
    };

    const updatedCampaign: Campaign = {
      ...activeCampaign,
      encounters: activeCampaign.encounters.map(e => 
        e.id === activeEncounter.id ? updatedEncounter : e
      )
    };

    updateCampaign(updatedCampaign);
    setActiveEncounter(updatedEncounter);
  }, [activeCampaign, activeEncounter, updateCampaign, isCombatStarted, turnIndex, round]);

  const handleClose = () => {
    window.close();
    // Fallback if window.close() is blocked
    setTimeout(() => {
      window.location.href = '/';
    }, 100);
  };
  
  const [activeRoll, setActiveRoll] = useState<{ title: string, hit?: string, damage?: string, unitName?: string } | null>(null);
  const [radarRequestedUnit, setRadarRequestedUnit] = useState<EncounterUnit | null>(null);
  const rollModalRef = useRef<HTMLHeadingElement>(null);

  const unitRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const detailHeadingRef = useRef<HTMLHeadingElement>(null);
  const runnerHeadingRef = useRef<HTMLHeadingElement>(null);
  const lastFocusedUnitId = useRef<string | null>(null);
  const lastActiveRollButtonRef = useRef<HTMLElement | null>(null);
  const lastFocusedOperationsButtonRef = useRef<HTMLButtonElement | null>(null);
  const lastFocusedMapCellRef = useRef<Position | null>(null);

  const loadEncounter = useCallback(async (encounter: Encounter, forceFresh: boolean = false) => {
    setActiveEncounter(encounter);
    
    let savedState: EncounterRunningState | null = forceFresh ? null : (encounter.runningState || null);
    if (!forceFresh) {
      try {
        const local = localStorage.getItem(`crits_encounter_${encounter.id}`);
        if (local) {
          const parsed = JSON.parse(local) as EncounterRunningState;
          if (!savedState || (parsed.updatedAt && (!savedState.updatedAt || parsed.updatedAt >= savedState.updatedAt))) {
            savedState = parsed;
          }
        }
      } catch {
        // ignore parse error
      }
    }

    // If there is saved running state (either active combat or entered setup initiatives)
    if (savedState && savedState.combatants && savedState.combatants.length > 0) {
      const enrichedCombatants = await Promise.all(savedState.combatants.map(async u => {
        const copy = { ...u };
        if (!u.isPlayer && u.monsterId && !u.fullData) {
          copy.fullData = await dataService.getMonsterById(u.monsterId) || undefined;
        }
        return copy;
      }));

      const mapSize = encounter.mapSize || { width: 20, height: 20 };
      const deployedCombatants = autoDeployUnits(enrichedCombatants, mapSize);
      setCombatants(deployedCombatants);
      const started = !!savedState.isCombatStarted;
      setIsCombatStarted(started);
      const tIdx = Math.min(Math.max(0, savedState.turnIndex || 0), Math.max(0, deployedCombatants.length - 1));
      setTurnIndex(tIdx);
      const rVal = savedState.round || 1;
      setRound(rVal);
      setHpMods({});

      if (started && deployedCombatants[tIdx]) {
        setAnnouncement(`Encounter resumed. Round ${rVal}. Current turn: ${deployedCombatants[tIdx].name}.`);
      }
      return;
    }

    // Fresh start from template monsters and campaign players:
    const monsterUnits = await Promise.all(encounter.units
      .filter(u => !u.isPlayer)
      .map(async u => {
        const enriched = { ...u };
        if (u.monsterId && !u.fullData) {
          enriched.fullData = await dataService.getMonsterById(u.monsterId) || undefined;
        }
        return enriched;
      }));
    
    const existingPlayerUnits = encounter.units.filter(u => u.isPlayer);
    const playerUnits: EncounterUnit[] = (activeCampaign?.players || []).map(p => {
      const existing = existingPlayerUnits.find(ep => ep.playerId === p.id || ep.name === p.name);
      return {
        instanceId: existing?.instanceId || `player-${p.id}`,
        playerId: p.id,
        name: p.name,
        dexMod: existing?.dexMod ?? 0,
        isPlayer: true,
        currentHp: existing?.currentHp ?? 1,
        maxHp: existing?.maxHp ?? 1,
        initiative: existing?.initiative,
        passivePerception: existing?.passivePerception ?? 10,
        position: existing?.position
      };
    });

    const mapSize = encounter.mapSize || { width: 20, height: 20 };
    const deployedFresh = autoDeployUnits([...monsterUnits, ...playerUnits], mapSize);
    setCombatants(deployedFresh);
    setIsCombatStarted(false);
    setTurnIndex(0);
    setRound(1);
    setHpMods({});
  }, [activeCampaign]);

  const resetCombat = useCallback(() => {
    if (!activeCampaign || !activeEncounter) return;

    try {
      localStorage.removeItem(`crits_encounter_${activeEncounter.id}`);
    } catch {
      // ignore storage error
    }

    const updatedEncounter: Encounter = {
      ...activeEncounter,
      runningState: null
    };

    const updatedCampaign: Campaign = {
      ...activeCampaign,
      encounters: activeCampaign.encounters.map(e => 
        e.id === activeEncounter.id ? updatedEncounter : e
      )
    };

    updateCampaign(updatedCampaign);
    setActiveEncounter(updatedEncounter);
    loadEncounter(updatedEncounter, true);
    setAnnouncement(`Encounter "${activeEncounter.name}" has been reset to setup.`);
  }, [activeCampaign, activeEncounter, updateCampaign, loadEncounter]);

  const handleResetCombat = () => {
    if (window.confirm(`Are you sure you want to reset "${activeEncounter?.name}"? This will clear active turns, rounds, and rolled HP.`)) {
      resetCombat();
    }
  };

  useEffect(() => {
    // Focus heading on mount or when view changes
    setTimeout(() => {
      runnerHeadingRef.current?.focus();
    }, 0);
  }, [activeEncounter]);

  const lastLoadedId = useRef<string | null>(null);

  useEffect(() => {
    if (targetEncounterId) {
      if (lastLoadedId.current === targetEncounterId) return;
      
      let campaign = activeCampaign;
      if (!campaign || !campaign.encounters.some(e => e.id === targetEncounterId)) {
        const foundCamp = campaigns.find(c => c.encounters.some(e => e.id === targetEncounterId));
        if (foundCamp) {
          campaign = foundCamp;
          setActiveCampaignId(foundCamp.id);
        }
      }

      if (campaign) {
        const encounter = campaign.encounters.find(e => e.id === targetEncounterId);
        if (encounter) {
          lastLoadedId.current = targetEncounterId;
          setTimeout(() => loadEncounter(encounter), 0);
        }
      }
    }
  }, [targetEncounterId, activeCampaign, campaigns, setActiveCampaignId, loadEncounter]);

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
    const nextIndex = (turnIndex + 1) % combatants.length;
    const isNewRound = nextIndex === 0;
    const nextRound = isNewRound ? round + 1 : round;

    setTurnIndex(nextIndex);
    if (isNewRound) {
      setRound(nextRound);
    }

    const current = combatants[nextIndex];
    const following = combatants[(nextIndex + 1) % combatants.length];
    const roundPrefix = isNewRound ? `Round ${nextRound}. ` : '';
    setAnnouncement(`${roundPrefix}Current turn: ${current.name}. Next up: ${following.name}.`);

    syncEncounterState(combatants, true, nextIndex, nextRound);
  }, [isCombatStarted, combatants, turnIndex, round, syncEncounterState]);

  const closeDetails = useCallback(() => {
    setSelectedUnit(null);
  }, []);

  const closeOperations = useCallback(() => {
    setActiveOperationsUnit(null);
  }, []);

  const closeRollModal = useCallback(() => {
    setActiveRoll(null);
    if (activeOperationsUnit) {
      closeOperations();
    }
  }, [activeOperationsUnit, closeOperations]);

  const openOperations = useCallback((e: React.MouseEvent<HTMLButtonElement> | null, unit: EncounterUnit, mapCell?: Position | null) => {
    if (e) {
      lastFocusedOperationsButtonRef.current = e.currentTarget;
    }
    lastFocusedMapCellRef.current = mapCell || null;
    setActiveOperationsUnit(unit);
  }, []);

  // Global Keyboard Listeners
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Escape
      if (e.key === 'Escape' && !e.defaultPrevented) {
        if (activeRoll) {
          e.preventDefault();
          closeRollModal();
        } else if (activeOperationsUnit) {
          e.preventDefault();
          closeOperations();
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

      // Alt + A for Actions Menu (current combatant)
      if (e.altKey && e.key.toLowerCase() === 'a') {
        e.preventDefault();
        const current = combatants[turnIndex];
        if (current && !current.isPlayer) {
          openOperations(null, current);
        }
      }

      // Prevent default behavior for Enter/Space on non-button focused elements (like the heading)
      // to avoid potential page scroll/teleport issues.
      if ((e.key === 'Enter' || e.key === ' ') && !(e.target instanceof HTMLButtonElement || e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement || e.target instanceof HTMLTableCellElement)) {
        e.preventDefault();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [nextTurn, selectedUnit, activeRoll, activeOperationsUnit, activeEncounter, turnIndex, combatants, closeDetails, closeRollModal, closeOperations, openOperations]);

  // Focus management for details modal and operations modal
  useEffect(() => {
    if (selectedUnit) {
      detailHeadingRef.current?.focus();
    } else if (activeOperationsUnit) {
      // Modal handles its own internal focus on mount
    } else if (activeRoll) {
      // Roll modal focus is handled by its own effect.
      // We explicitly skip focus restoration here to avoid snatching focus away from the roll result.
    } else {
      if (lastFocusedMapCellRef.current) {
        const cell = lastFocusedMapCellRef.current;
        lastFocusedMapCellRef.current = null;
        lastActiveRollButtonRef.current = null;
        lastFocusedUnitId.current = null;
        lastFocusedOperationsButtonRef.current = null;
        setTimeout(() => {
          const cellEl = document.querySelector<HTMLTableCellElement>(
            `[data-cell="${cell.x}-${cell.y}"]`
          );
          cellEl?.focus();
        }, 50);
      } else if (lastFocusedUnitId.current) {
        unitRefs.current[lastFocusedUnitId.current]?.focus();
        lastFocusedUnitId.current = null;
      } else if (lastFocusedOperationsButtonRef.current) {
        lastFocusedOperationsButtonRef.current.focus();
        lastFocusedOperationsButtonRef.current = null;
      }
    }
  }, [selectedUnit, activeOperationsUnit, activeRoll]);

  const updateInitiative = (instanceId: string, val: string) => {
    const num = val === '' ? undefined : (parseInt(val, 10) || 0);
    const next = combatants.map(u => u.instanceId === instanceId ? { ...u, initiative: num } : u);
    setCombatants(next);
    syncEncounterState(next, false, 0, 1);
  };

  const startCombat = () => {
    const rolledCombatants = combatants.map(u => {
      const hp = { max: u.maxHp || 1, current: u.currentHp || 1 };
      
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
    setRound(1);
    syncEncounterState(sorted, true, 0, 1);
    setAnnouncement(`Combat started. Round 1. First up is ${sorted[0].name}.`);
  };

  const openUnitDetails = (unit: EncounterUnit, mapCell?: Position | null) => {
    lastFocusedUnitId.current = unit.instanceId;
    lastFocusedMapCellRef.current = mapCell || null;
    setSelectedUnit(unit);
  };

  const handleUpdateUnitPosition = useCallback((instanceId: string, newPos: Position) => {
    setCombatants(prev => {
      const next = prev.map(u => u.instanceId === instanceId ? { ...u, position: newPos } : u);
      syncEncounterState(next);
      return next;
    });
  }, [syncEncounterState]);

  const applyHpMod = (instanceId: string, isDamage: boolean, amount?: number) => {
    const val = amount !== undefined ? amount : parseInt(hpMods[instanceId] || '0', 10);
    if (isNaN(val) || val <= 0) return;
    
    let updatedUnitName = '';
    let updatedNewHp = 0;

    const next = combatants.map(u => {
      if (u.instanceId === instanceId) {
        if (u.isPlayer) return u;
        
        const newHp = isDamage 
          ? Math.max(0, (u.currentHp || 0) - val) 
          : Math.min((u.maxHp || 0), (u.currentHp || 0) + val);
        
        updatedUnitName = u.name;
        updatedNewHp = newHp;
        return { ...u, currentHp: newHp };
      }
      return u;
    });

    if (updatedUnitName) {
      setAnnouncement(`${updatedUnitName} takes ${val} ${isDamage ? 'damage' : 'healing'}. New HP is ${updatedNewHp}.`);
    }

    setCombatants(next);
    syncEncounterState(next, isCombatStarted, turnIndex, round);
    
    if (amount === undefined) {
      setHpMods(prev => ({ ...prev, [instanceId]: '' }));
    }
    
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

  const handleInlineRoll = (e: React.MouseEvent<HTMLElement> | null, unitName: string, title: string, hit: string, damage?: string) => {
    if (e) {
      lastActiveRollButtonRef.current = e.currentTarget as HTMLElement;
    } else {
      lastActiveRollButtonRef.current = document.activeElement as HTMLElement;
    }
    
    // Announce to screen reader using the robust string format
    const hitVal = hit.split(',')[0];
    const damageAnnounce = damage ? `. Damage: ${damage.split(' ')[0]} ${damage.split(' ')[1] || ''}` : '';
    setAnnouncement(`${unitName} rolled ${title}: ${hitVal}${damageAnnounce}`);

    setActiveRoll({
      title,
      hit,
      damage,
      unitName
    });
  };

  if (!activeEncounter) {
    const campaignEncounters = activeCampaign?.encounters || [];
    return (
      <section >
        <h2 ref={runnerHeadingRef} tabIndex={-1} style={{ outline: 'none' }}>Load Encounter</h2>
        {!activeCampaign ? <p>Please select a campaign in Create Mode.</p> :
         campaignEncounters.length === 0 ? <p>No saved encounters found. Go to Create Mode to build one.</p> : (
          <ul style={{ listStyle: 'none', padding: 0 }}>
            {campaignEncounters.map(e => (
              <li key={e.id}>
                <button type="button" onClick={() => loadEncounter(e)}>Load "{e.name}"</button>
              </li>
            ))}
          </ul>
        )}
      </section>
    );
  }

  return (
    <div className="encounter-runner" >
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', flexWrap: 'wrap', gap: '0.5rem' }}>
        <div>
          <h2 ref={runnerHeadingRef} tabIndex={-1} style={{ outline: 'none', margin: 0 }}>Running: {activeEncounter.name}</h2>
          {isCombatStarted && (
            <p style={{ margin: '0.25rem 0 0 0', fontWeight: 'bold' }} aria-label={`Round ${round}`}>Round {round}</p>
          )}
        </div>
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
          {(isCombatStarted || combatants.some(c => c.initiative !== undefined)) && (
            <button type="button" onClick={handleResetCombat}>Reset Encounter</button>
          )}
          <button type="button" onClick={handleClose}>Close Encounter Tab</button>
        </div>
      </header>

      <div aria-live="assertive" className="sr-only">
        {announcement}
      </div>

      {!isCombatStarted ? (
        <section>
          <h3>Initiative Setup</h3>
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
          <h3>Initiative Track</h3>
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
                    <button 
                      type="button" 
                      onClick={(e) => openOperations(e, u)}
                      style={{ padding: '0.25rem 0.5rem', fontSize: '0.9em' }}
                    >
                      Options <span className="sr-only">for {u.name}</span>
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {activeEncounter && isCombatStarted && (
        <CombatMap
          units={combatants}
          mapSize={activeEncounter.mapSize || { width: 20, height: 20 }}
          activeTurnUnitId={isCombatStarted && combatants[turnIndex] ? combatants[turnIndex].instanceId : undefined}
          onUpdateUnitPosition={handleUpdateUnitPosition}
          onOpenOperations={(unit, cell) => openOperations(null, unit, cell)}
          onOpenDetails={(unit, cell) => openUnitDetails(unit, cell)}
          externalRadarUnit={radarRequestedUnit}
          onResetExternalRadarUnit={() => setRadarRequestedUnit(null)}
          dmMapUrl={activeEncounter.dmMapUrl}
          playerMapUrl={activeEncounter.playerMapUrl}
          mapName={activeEncounter.name}
        />
      )}

      {activeOperationsUnit && (
        <MonsterOperationsModal 
          unit={activeOperationsUnit}
          onClose={closeOperations}
          onApplyHpMod={applyHpMod}
          onRoll={(title, hit, damage) => handleInlineRoll(null, activeOperationsUnit.name, title, hit, damage)}
          onAnnounce={setAnnouncement}
          onOpenRadar={(unit) => setRadarRequestedUnit(unit)}
        />
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
