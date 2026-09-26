import { useState, useEffect, useRef, useCallback } from 'react';
import { MonsterBrowser } from './MonsterBrowser';
import { MonsterDetails } from './MonsterDetails';
import { dataService } from '../services/DataService';
import type { Monster, EncounterUnit, Encounter } from '../types';
import { useCampaigns } from '../context/CampaignContext';
import { isInteractiveTarget } from './uiHelpers';
import { useAssistantScreen } from '../context/AssistantScreenContext';

interface EncounterBuilderProps {
  initialEncounter: Encounter | null;
  chapterId?: string | null;
  onClose: () => void;
}

export function EncounterBuilder({ initialEncounter, chapterId, onClose }: EncounterBuilderProps) {
  const { activeCampaign, updateCampaign } = useCampaigns();
  useAssistantScreen('create.encounter_builder');
  const [encounterName, setEncounterName] = useState(initialEncounter ? initialEncounter.name : 'New Encounter');
  const [dmMapUrl, setDmMapUrl] = useState(initialEncounter?.dmMapUrl || '');
  const [playerMapUrl, setPlayerMapUrl] = useState(initialEncounter?.playerMapUrl || '');
  const [units, setUnits] = useState<EncounterUnit[]>(initialEncounter ? initialEncounter.units : []);
  // Which unit the monster picker is linking; null means "add a new monster".
  const [linkingInstanceId, setLinkingInstanceId] = useState<string | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [statsInstanceId, setStatsInstanceId] = useState<string | null>(null);
  const [optionsInstanceId, setOptionsInstanceId] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState('');

  const addMonsterBtnRef = useRef<HTMLButtonElement>(null);
  const selectMonsterHeadingRef = useRef<HTMLHeadingElement>(null);
  const statsHeadingRef = useRef<HTMLHeadingElement>(null);
  const optionsHeadingRef = useRef<HTMLHeadingElement>(null);
  const builderHeadingRef = useRef<HTMLHeadingElement>(null);

  const lastFocusedElement = useRef<HTMLElement | null>(null);

  useEffect(() => {
    setTimeout(() => {
      builderHeadingRef.current?.focus();
    }, 0);
  }, []);

  // Saved encounters store units without fullData, so load each unit's stat block
  // here. Units with no monsterId are matched by name (ignoring a trailing instance
  // number); anything that still has no match gets a manual "Link" button.
  useEffect(() => {
    let isMounted = true;
    (async () => {
      const all = await dataService.getAllMonsters();
      const byName = new Map<string, Monster>();
      for (const m of all) byName.set(m.name.toLowerCase(), m);
      const resolve = (u: EncounterUnit): { monsterId?: string; fullData?: Monster } => {
        if (u.isPlayer || u.playerId || u.fullData) return {};
        if (u.monsterId) {
          const found = dataService.getMonsterByIdSync(u.monsterId);
          return found ? { monsterId: u.monsterId, fullData: found } : {};
        }
        const key = u.name.trim().toLowerCase().replace(/\s+\d+$/, '');
        const match = byName.get(key) || byName.get(u.name.trim().toLowerCase());
        return match ? { monsterId: match.id, fullData: match } : {};
      };
      if (!isMounted) return;
      setUnits(prev => prev.map(u => {
        const r = resolve(u);
        return r.fullData ? { ...u, ...r } : u;
      }));
    })();
    return () => { isMounted = false; };
  }, []);

  const handleOpenModal = () => {
    lastFocusedElement.current = document.activeElement as HTMLElement;
    setLinkingInstanceId(null);
    setIsModalOpen(true);
  };

  const handleOpenStats = (instanceId: string) => {
    lastFocusedElement.current = document.activeElement as HTMLElement;
    setStatsInstanceId(instanceId);
  };

  const closeModal = useCallback(() => {
    setIsModalOpen(false);
    setLinkingInstanceId(null);
    setTimeout(() => {
      if (lastFocusedElement.current) {
        lastFocusedElement.current.focus();
        lastFocusedElement.current = null;
      } else {
        addMonsterBtnRef.current?.focus();
      }
    }, 0);
  }, []);

  const handleOpenOptions = (instanceId: string) => {
    lastFocusedElement.current = document.activeElement as HTMLElement;
    setOptionsInstanceId(instanceId);
  };

  const closeOptions = useCallback(() => {
    setOptionsInstanceId(null);
    setTimeout(() => {
      lastFocusedElement.current?.focus();
      lastFocusedElement.current = null;
    }, 0);
  }, []);

  // The picker closes back to the Options button, so keep lastFocusedElement as is.
  const linkFromOptions = (instanceId: string) => {
    setOptionsInstanceId(null);
    setLinkingInstanceId(instanceId);
    setIsModalOpen(true);
  };

  const renameUnit = (instanceId: string, name: string) => {
    setUnits(prev => prev.map(u => u.instanceId === instanceId ? { ...u, name } : u));
  };

  const removeFromOptions = (unit: EncounterUnit) => {
    setOptionsInstanceId(null);
    lastFocusedElement.current = null;
    setUnits(prev => prev.filter(u => u.instanceId !== unit.instanceId));
    setStatusMessage(`${unit.name} removed.`);
    setTimeout(() => addMonsterBtnRef.current?.focus(), 0);
  };

  const closeStats = useCallback(() => {
    setStatsInstanceId(null);
    setTimeout(() => {
      lastFocusedElement.current?.focus();
      lastFocusedElement.current = null;
    }, 0);
  }, []);

  useEffect(() => {
    if (statsInstanceId) {
      setTimeout(() => statsHeadingRef.current?.focus(), 50);
    }
  }, [statsInstanceId]);

  // Handle global Escape key for modal
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !e.defaultPrevented) {
        if (statsInstanceId) {
          e.preventDefault();
          closeStats();
        } else if (optionsInstanceId) {
          e.preventDefault();
          closeOptions();
        } else if (isModalOpen) {
          e.preventDefault();
          closeModal();
        }
      }

      // Prevent default behavior for Enter and Space on non-interactive elements
      if ((e.key === 'Enter' || e.key === ' ') && !isInteractiveTarget(e.target)) {
        e.preventDefault();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isModalOpen, closeModal, statsInstanceId, closeStats, optionsInstanceId, closeOptions]);

  useEffect(() => {
    if (optionsInstanceId) {
      setTimeout(() => optionsHeadingRef.current?.focus(), 50);
    }
  }, [optionsInstanceId]);

  // Handle focus when modal opens
  useEffect(() => {
    if (isModalOpen) {
      setTimeout(() => {
        selectMonsterHeadingRef.current?.focus();
      }, 50);
    }
  }, [isModalOpen]);

  const addMonster = (monster: Monster) => {
    const pp = monster.senses?.find(s => s.name === "Passive Perception")?.value || 10;
    const dex = monster.stats?.DEX?.modifier ?? 0;
    const hpDice = monster.attributes?.hp?.dice || "1d1";

    const newUnit: EncounterUnit = {
      instanceId: crypto.randomUUID(),
      monsterId: monster.id,
      name: `${monster.name} ${units.filter(u => u.monsterId === monster.id).length + 1}`,
      hpDice: hpDice,
      dexMod: dex,
      passivePerception: pp,
      isPlayer: false,
      fullData: monster,
      phase: 1
    };
    setUnits([...units, newUnit]);
    closeModal();
  };

  const linkMonster = (monster: Monster) => {
    const targetId = linkingInstanceId;
    if (!targetId) return addMonster(monster);
    const target = units.find(u => u.instanceId === targetId);
    setUnits(prev => prev.map(u => u.instanceId === targetId ? {
      ...u,
      monsterId: monster.id,
      fullData: monster,
      hpDice: monster.attributes?.hp?.dice || u.hpDice,
      maxHp: u.maxHp ?? monster.attributes?.hp?.value,
      dexMod: monster.stats?.DEX?.modifier ?? u.dexMod,
      passivePerception: monster.senses?.find(s => s.name === "Passive Perception")?.value ?? u.passivePerception,
    } : u));
    setStatusMessage(`${target?.name ?? 'Unit'} linked to ${monster.name}.`);
    closeModal();
  };

  const updateUnitPhase =(instanceId: string, phase: number) => {
    setUnits(prev => prev.map(u => u.instanceId === instanceId ? { ...u, phase } : u));
  };

  const saveEncounter = async () => {
    if (!activeCampaign) {
      alert("Please select a Campaign first in the Campaigns tab.");
      return;
    }
    
    // Strip fullData before saving to backend (Plan 3 compliance)
    const strippedUnits = units.map(u => {
      const unitCopy = { ...u };
      delete unitCopy.fullData;
      return unitCopy;
    });

    let encounterId: string;
    if (initialEncounter) {
      encounterId = initialEncounter.id;
    } else {
      let nextId = 1;
      if (activeCampaign.encounters && activeCampaign.encounters.length > 0) {
        const ids = activeCampaign.encounters
          .map(e => parseInt(e.id, 10))
          .filter(id => !isNaN(id));
        if (ids.length > 0) {
          nextId = Math.max(...ids) + 1;
        }
      }
      encounterId = nextId.toString();
    }

    const encounter: Encounter = {
      id: encounterId,
      name: encounterName,
      units: strippedUnits,
      chapterIds: initialEncounter ? initialEncounter.chapterIds : (chapterId ? [chapterId] : []),
      runningState: initialEncounter ? initialEncounter.runningState : null,
      dmMapUrl: dmMapUrl.trim() || undefined,
      playerMapUrl: playerMapUrl.trim() || undefined,
      mapSize: initialEncounter?.mapSize || { width: 20, height: 20 }
    };
    
    const existingEncounters = initialEncounter 
      ? activeCampaign.encounters.filter(e => e.id !== initialEncounter.id)
      : activeCampaign.encounters;

    await updateCampaign({
      ...activeCampaign,
      encounters: [...existingEncounters, encounter]
    });
    alert(`Encounter "${encounterName}" saved to Campaign "${activeCampaign.name}"!`);
    onClose();
  };

  const handleCancel = () => {
    onClose();
  };

  return (
    <div className="encounter-builder" >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
        <h2 id="builder-title" ref={builderHeadingRef} tabIndex={-1} style={{ margin: 0, outline: 'none' }}>Encounter Builder</h2>
        <button type="button" onClick={handleCancel} style={{ padding: '0.5rem' }}>Back to Campaign</button>
      </div>
      <section aria-labelledby="builder-title">
        <label htmlFor="encounter-name">Encounter Name:</label>
        <input
          id="encounter-name"
          value={encounterName}
          onChange={e => setEncounterName(e.target.value)}
          style={{ width: '100%', padding: '0.5rem', marginBottom: '1rem' }}
        />
        <label htmlFor="encounter-dm-map">DM Map URL (optional):</label>
        <input
          id="encounter-dm-map"
          value={dmMapUrl}
          onChange={e => setDmMapUrl(e.target.value)}
          placeholder="/maps/5.1-palma-flora.png"
          style={{ width: '100%', padding: '0.5rem', marginBottom: '1rem' }}
        />
        <label htmlFor="encounter-player-map">Player Map URL (optional):</label>
        <input
          id="encounter-player-map"
          value={playerMapUrl}
          onChange={e => setPlayerMapUrl(e.target.value)}
          placeholder="/maps/5.1-palma-flora-player.png"
          style={{ width: '100%', padding: '0.5rem', marginBottom: '1rem' }}
        />
      </section>

      <section style={{ margin: '1rem 0' }}>
        <button type="button"
          ref={addMonsterBtnRef}
          onClick={handleOpenModal}
          style={{ padding: '0.75rem 1.5rem', fontWeight: 'bold' }}
        >
          Add Monster...
        </button>
      </section>

      <div role="status" aria-live="polite" className="sr-only">{statusMessage}</div>

      <section aria-label="Current Units">
        <h3>Units in Encounter</h3>
        {units.length === 0 ? (
          <p>No units added yet.</p>
        ) : (
          <ul style={{ listStyle: 'none', padding: 0 }}>
            {units.map((unit) => (
              <li key={unit.instanceId} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.5rem', borderBottom: '1px solid #ccc', flexWrap: 'wrap', gap: '0.5rem' }}>
                {(() => {
                  const detail = unit.isPlayer
                    ? '(Player)'
                    : unit.fullData
                      ? `(CR ${unit.fullData.cr}, ${unit.fullData.name})`
                      : '(Not linked to a monster)';
                  return unit.fullData && !unit.isPlayer ? (
                    <button type="button" onClick={() => handleOpenStats(unit.instanceId)}
                      aria-label={`${unit.name} ${detail}. View stats`}
                      style={{ background: 'none', border: 'none', padding: 0, font: 'inherit', color: 'inherit', textAlign: 'left', cursor: 'pointer' }}>
                      <strong>{unit.name}</strong> {detail}
                    </button>
                  ) : (
                    <span><strong>{unit.name}</strong> {detail}</span>
                  );
                })()}
                <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
                  <select
                    value={unit.phase ?? 1}
                    onChange={(e) => updateUnitPhase(unit.instanceId, parseInt(e.target.value, 10))}
                    aria-label={`Phase for ${unit.name}`}
                    style={{ padding: '0.25rem 0.5rem' }}
                  >
                    <option value={1}>Phase 1</option>
                    <option value={2}>Phase 2</option>
                    <option value={3}>Phase 3</option>
                    <option value={4}>Phase 4</option>
                    <option value={5}>Phase 5</option>
                  </select>
                  <button type="button" onClick={() => handleOpenOptions(unit.instanceId)} aria-label={`Options for ${unit.name}`}>
                    Options
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <footer style={{ marginTop: '2rem', borderTop: '2px solid #ccc', paddingTop: '1rem' }}>
        <button type="button" onClick={saveEncounter} style={{ padding: '1rem 2rem', backgroundColor: '#2e7d32', color: 'white', fontWeight: 'bold', width: '100%' }}>
          Save Encounter
        </button>
      </footer>

      {isModalOpen && (
        <div className="modal-overlay" role="dialog" aria-modal="true" aria-labelledby="select-monster-title" style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          backgroundColor: 'rgba(0,0,0,0.5)', display: 'flex',
          alignItems: 'center', justifyContent: 'center', zIndex: 1000
        }}>
          <div className="modal-content" style={{
            backgroundColor: 'white', padding: '2rem', borderRadius: '8px',
            maxWidth: '900px', width: '95%', maxHeight: '90vh', overflowY: 'auto'
          }}>
            <h3 id="select-monster-title" ref={selectMonsterHeadingRef} tabIndex={-1} style={{ outline: 'none' }}>
              {linkingInstanceId
                ? `Link ${units.find(u => u.instanceId === linkingInstanceId)?.name ?? 'Unit'} to Monster`
                : 'Select Monster'}
            </h3>
            <MonsterBrowser
              onSelect={linkMonster}
              ctaLabel={linkingInstanceId ? 'Link to Unit' : 'Add to Encounter'}
            />
            <button type="button" onClick={closeModal} style={{ marginTop: '1rem', width: '100%', padding: '0.75rem' }}>Cancel (Esc)</button>
          </div>
        </div>
      )}

      {optionsInstanceId && (() => {
        const optUnit = units.find(u => u.instanceId === optionsInstanceId);
        if (!optUnit) return null;
        return (
          <div className="modal-overlay" role="dialog" aria-modal="true" aria-labelledby="unit-options-title" style={{
            position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
            backgroundColor: 'rgba(0,0,0,0.5)', display: 'flex',
            alignItems: 'center', justifyContent: 'center', zIndex: 1000
          }}>
            <div className="modal-content" style={{
              backgroundColor: 'white', color: 'black', padding: '2rem', borderRadius: '8px',
              maxWidth: '500px', width: '95%', maxHeight: '90vh', overflowY: 'auto'
            }}>
              <h3 id="unit-options-title" ref={optionsHeadingRef} tabIndex={-1} style={{ outline: 'none' }}>
                Options for {optUnit.name}
              </h3>
              <label htmlFor="unit-options-name">Unit name</label>
              <input
                id="unit-options-name"
                value={optUnit.name}
                onChange={e => renameUnit(optUnit.instanceId, e.target.value)}
                style={{ width: '100%', padding: '0.5rem', marginBottom: '1rem' }}
              />
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                {!optUnit.isPlayer && (
                  <button type="button" onClick={() => linkFromOptions(optUnit.instanceId)} style={{ padding: '0.75rem' }}>
                    {optUnit.fullData ? `Change linked monster (currently ${optUnit.fullData.name})` : 'Link to a monster'}
                  </button>
                )}
                <button type="button" onClick={() => removeFromOptions(optUnit)} style={{ padding: '0.75rem' }}>
                  Remove unit
                </button>
                <button type="button" onClick={closeOptions} style={{ padding: '0.75rem' }}>Done (Esc)</button>
              </div>
            </div>
          </div>
        );
      })()}

      {statsInstanceId && (() => {
        const statUnit = units.find(u => u.instanceId === statsInstanceId);
        if (!statUnit?.fullData) return null;
        return (
          <div className="modal-overlay" role="dialog" aria-modal="true" aria-labelledby="unit-stats-title" style={{
            position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
            backgroundColor: 'rgba(0,0,0,0.5)', display: 'flex',
            alignItems: 'center', justifyContent: 'center', zIndex: 1000
          }}>
            <div className="modal-content" style={{
              backgroundColor: 'white', color: 'black', padding: '2rem', borderRadius: '8px',
              maxWidth: '800px', width: '95%', maxHeight: '90vh', overflowY: 'auto'
            }}>
              <h3 id="unit-stats-title" ref={statsHeadingRef} tabIndex={-1} style={{ outline: 'none' }}>
                {statUnit.name} Stats ({statUnit.fullData.name})
              </h3>
              <MonsterDetails monster={statUnit.fullData} />
              <button type="button" onClick={closeStats} style={{ marginTop: '1rem', width: '100%', padding: '0.75rem' }}>Close (Esc)</button>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
