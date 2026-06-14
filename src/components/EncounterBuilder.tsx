import { useState, useEffect, useRef, useCallback } from 'react';
import { MonsterBrowser } from './MonsterBrowser';
import type { Monster, EncounterUnit, Encounter } from '../types';
import { useCampaigns } from '../context/CampaignContext';

interface EncounterBuilderProps {
  initialEncounter: Encounter | null;
  chapterId?: string | null;
  onClose: () => void;
}

export function EncounterBuilder({ initialEncounter, chapterId, onClose }: EncounterBuilderProps) {
  const { activeCampaign, updateCampaign } = useCampaigns();
  const [encounterName, setEncounterName] = useState(initialEncounter ? initialEncounter.name : 'New Encounter');
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
      const target = e.target as HTMLElement;
      const isInteractive = ['BUTTON', 'INPUT', 'TEXTAREA', 'SELECT', 'A'].includes(target.tagName) ||
                          target.hasAttribute('onclick') ||
                          target.getAttribute('role') === 'button';

      if ((e.key === 'Enter' || e.key === ' ') && !isInteractive) {
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
      fullData: monster
    };
    setUnits([...units, newUnit]);
    closeModal();
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

    const encounter: Encounter = {
      id: initialEncounter ? initialEncounter.id : crypto.randomUUID(),
      name: encounterName,
      units: strippedUnits,
      chapterIds: initialEncounter ? initialEncounter.chapterIds : (chapterId ? [chapterId] : [])
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
              <li key={unit.instanceId} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.5rem', borderBottom: '1px solid #ccc' }}>
                <span>
                  <strong>{unit.name}</strong> {unit.isPlayer ? '(Player)' : `(CR ${unit.fullData?.cr})`}
                </span>
                <button type="button" onClick={() => removeUnit(unit.instanceId)} aria-label={`Remove ${unit.name}`}>
                  Remove
                </button>
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
