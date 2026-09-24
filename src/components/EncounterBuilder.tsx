import { useState, useEffect, useRef, useCallback } from 'react';
import { MonsterBrowser } from './MonsterBrowser';
import type { Monster, EncounterUnit, Encounter } from '../types';
import { useCampaigns } from '../context/CampaignContext';
import { isInteractiveTarget } from './uiHelpers';

interface EncounterBuilderProps {
  initialEncounter: Encounter | null;
  chapterId?: string | null;
  onClose: () => void;
}

export function EncounterBuilder({ initialEncounter, chapterId, onClose }: EncounterBuilderProps) {
  const { activeCampaign, updateCampaign } = useCampaigns();
  const [encounterName, setEncounterName] = useState(initialEncounter ? initialEncounter.name : 'New Encounter');
  const [dmMapUrl, setDmMapUrl] = useState(initialEncounter?.dmMapUrl || '');
  const [playerMapUrl, setPlayerMapUrl] = useState(initialEncounter?.playerMapUrl || '');
  const [units, setUnits] = useState<EncounterUnit[]>(initialEncounter ? initialEncounter.units : []);
  const [isModalOpen, setIsModalOpen] = useState(false);

  const addMonsterBtnRef = useRef<HTMLButtonElement>(null);
  const selectMonsterHeadingRef = useRef<HTMLHeadingElement>(null);
  const builderHeadingRef = useRef<HTMLHeadingElement>(null);

  const lastFocusedElement = useRef<HTMLElement | null>(null);

  useEffect(() => {
    setTimeout(() => {
      builderHeadingRef.current?.focus();
    }, 0);
  }, []);

  const handleOpenModal = () => {
    lastFocusedElement.current = document.activeElement as HTMLElement;
    setIsModalOpen(true);
  };

  const closeModal = useCallback(() => {
    setIsModalOpen(false);
    setTimeout(() => {
      if (lastFocusedElement.current) {
        lastFocusedElement.current.focus();
        lastFocusedElement.current = null;
      } else {
        addMonsterBtnRef.current?.focus();
      }
    }, 0);
  }, []);

  // Handle global Escape key for modal
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !e.defaultPrevented) {
        if (isModalOpen) {
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
  }, [isModalOpen, closeModal]);

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

  const updateUnitPhase = (instanceId: string, phase: number) => {
    setUnits(prev => prev.map(u => u.instanceId === instanceId ? { ...u, phase } : u));
  };

  const removeUnit = (instanceId: string) => {
    setUnits(units.filter(u => u.instanceId !== instanceId));
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

      <section aria-label="Current Units">
        <h3>Units in Encounter</h3>
        {units.length === 0 ? (
          <p>No units added yet.</p>
        ) : (
          <ul style={{ listStyle: 'none', padding: 0 }}>
            {units.map((unit) => (
              <li key={unit.instanceId} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.5rem', borderBottom: '1px solid #ccc', flexWrap: 'wrap', gap: '0.5rem' }}>
                <span>
                  <strong>{unit.name}</strong> {unit.isPlayer ? '(Player)' : `(CR ${unit.fullData?.cr || 'N/A'})`}
                </span>
                <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
                  <label htmlFor={`unit-phase-${unit.instanceId}`} style={{ fontSize: '0.9rem' }}>
                    Phase:
                  </label>
                  <select
                    id={`unit-phase-${unit.instanceId}`}
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
                  <button type="button" onClick={() => removeUnit(unit.instanceId)} aria-label={`Remove ${unit.name}`}>
                    Remove
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
            <h3 id="select-monster-title" ref={selectMonsterHeadingRef} tabIndex={-1} style={{ outline: 'none' }}>Select Monster</h3>
            <MonsterBrowser onSelect={addMonster} />
            <button type="button" onClick={closeModal} style={{ marginTop: '1rem', width: '100%', padding: '0.75rem' }}>Cancel (Esc)</button>
          </div>
        </div>
      )}
    </div>
  );
}
