import { useState, useEffect, useRef, useCallback } from 'react';
import { MonsterDetails } from './MonsterDetails';
import type { Monster, EncounterUnit, Encounter } from '../types';
import { useCampaigns } from '../context/CampaignContext';

interface EncounterBuilderProps {
  initialEncounter: Encounter | null;
  onClose: () => void;
}

export function EncounterBuilder({ initialEncounter, onClose }: EncounterBuilderProps) {
  const { activeCampaign, updateCampaign } = useCampaigns();
  const [monsters, setMonsters] = useState<Monster[]>([]);
  const [encounterName, setEncounterName] = useState(initialEncounter ? initialEncounter.name : 'New Encounter');
  const [units, setUnits] = useState<EncounterUnit[]>(initialEncounter ? initialEncounter.units : []);
  const [loading, setLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [previewMonster, setPreviewMonster] = useState<Monster | null>(null);

  const addMonsterBtnRef = useRef<HTMLButtonElement>(null);
  const modalFirstBtnRef = useRef<HTMLButtonElement>(null);
  const previewHeadingRef = useRef<HTMLHeadingElement>(null);
  const builderHeadingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    fetch(`/data/monsters.json?t=${new Date().getTime()}`)
      .then(res => res.json())
      .then(data => {
        setMonsters(data);
        setLoading(false);
      })
      .catch(err => {
        console.error("Failed to load monsters:", err);
        setLoading(false);
      });
  }, []);

  useEffect(() => {
    if (!loading) {
      setTimeout(() => {
        builderHeadingRef.current?.focus();
      }, 0);
    }
  }, [loading]);

  const closeModal = useCallback(() => {
    setIsModalOpen(false);
    setPreviewMonster(null);
  }, []);

  // Handle global Escape key for modal
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isModalOpen) {
        if (previewMonster) {
          setPreviewMonster(null);
        } else {
          closeModal();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isModalOpen, previewMonster, closeModal]);

  // Handle focus when modal opens/closes
  useEffect(() => {
    if (isModalOpen) {
      if (previewMonster) {
        previewHeadingRef.current?.focus();
      } else {
        modalFirstBtnRef.current?.focus();
      }
    } else {
      addMonsterBtnRef.current?.focus();
    }
  }, [isModalOpen, previewMonster]);

  const addMonster = (monster: Monster) => {
    // Defensive checks for missing data
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

  const addPlayer = () => {
    const newUnit: EncounterUnit = {
      instanceId: crypto.randomUUID(),
      name: `Player ${units.filter(u => u.isPlayer).length + 1}`,
      maxHp: 1,
      currentHp: 1,
      dexMod: 0,
      passivePerception: 10,
      isPlayer: true
    };
    setUnits([...units, newUnit]);
  };

  const removeUnit = (instanceId: string) => {
    setUnits(units.filter(u => u.instanceId !== instanceId));
  };

  const saveEncounter = () => {
    if (!activeCampaign) {
      alert("Please select a Campaign first in the Campaigns tab.");
      return;
    }
    const encounter: Encounter = {
      id: initialEncounter ? initialEncounter.id : crypto.randomUUID(),
      name: encounterName,
      units: units
    };
    
    const existingEncounters = initialEncounter 
      ? activeCampaign.encounters.filter(e => e.id !== initialEncounter.id)
      : activeCampaign.encounters;

    updateCampaign({
      ...activeCampaign,
      encounters: [...existingEncounters, encounter]
    });
    alert(`Encounter "${encounterName}" saved to Campaign "${activeCampaign.name}"!`);
    onClose();
  };

  const handleCancel = () => {
    onClose();
  };

  if (loading) return <p>Loading data...</p>;

  return (
    <div className="encounter-builder">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
        <h2 id="builder-title" ref={builderHeadingRef} tabIndex={-1} style={{ margin: 0, outline: 'none' }}>Encounter Builder</h2>
        <button onClick={handleCancel} style={{ padding: '0.5rem' }}>Back to Campaign</button>
      </div>
      <section aria-labelledby="builder-title">
        <label htmlFor="encounter-name">Encounter Name:</label>
        <input 
          id="encounter-name" 
          value={encounterName} 
          onChange={e => setEncounterName(e.target.value)} 
        />
      </section>

      <section style={{ margin: '1rem 0' }}>
        <button 
          ref={addMonsterBtnRef}
          onClick={() => setIsModalOpen(true)}
        >
          Add Monster...
        </button>
        <button onClick={addPlayer} style={{ marginLeft: '1rem' }}>Add Player Placeholder</button>
      </section>

      {isModalOpen && (
        <div className="modal-overlay" role="dialog" aria-modal="true" aria-labelledby="modal-title" style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, 
          backgroundColor: 'rgba(0,0,0,0.5)', display: 'flex', 
          alignItems: 'center', justifyContent: 'center', zIndex: 1000
        }}>
          <div className="modal-content" style={{
            backgroundColor: 'white', padding: '2rem', borderRadius: '8px', 
            maxWidth: '600px', width: '90%', maxHeight: '80vh', overflowY: 'auto'
          }}>
            {!previewMonster ? (
              <>
                <h3 id="modal-title">Select Monster</h3>
                <ul style={{ listStyle: 'none', padding: 0 }}>
                  {monsters.map((m, index) => (
                    <li key={m.id} style={{ marginBottom: '0.5rem', display: 'flex', gap: '0.5rem' }}>
                      <button 
                        ref={index === 0 ? modalFirstBtnRef : null}
                        onClick={() => addMonster(m)} 
                        style={{ flexGrow: 1, textAlign: 'left' }}
                        aria-label={`Add ${m.name} to encounter`}
                      >
                        Add <strong>{m.name}</strong> (CR: {m.cr})
                      </button>
                      <button 
                        onClick={() => setPreviewMonster(m)}
                        aria-label={`View details for ${m.name}`}
                      >
                        View Details
                      </button>
                    </li>
                  ))}
                </ul>
                <button onClick={closeModal} style={{ marginTop: '1rem' }}>Cancel (Esc)</button>
              </>
            ) : (
              <>
                <h3 id="modal-title" ref={previewHeadingRef} tabIndex={-1} style={{ outline: 'none' }}>
                  {previewMonster.name} Preview
                </h3>
                <MonsterDetails monster={previewMonster} />
                <div style={{ marginTop: '1.5rem', display: 'flex', gap: '1rem' }}>
                  <button 
                    onClick={() => addMonster(previewMonster)} 
                    style={{ flex: 1, padding: '0.75rem', fontWeight: 'bold' }}
                  >
                    Add to Encounter
                  </button>
                  <button 
                    onClick={() => setPreviewMonster(null)} 
                    style={{ flex: 1, padding: '0.75rem' }}
                  >
                    Back to List
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      <section>
        <h3>Current Units ({units.length})</h3>
        {units.length === 0 ? <p>No units added yet.</p> : (
          <ul style={{ listStyle: 'none', padding: 0 }}>
            {units.map(u => (
              <li key={u.instanceId} style={{ borderBottom: '1px solid #eee', padding: '0.5rem 0', display: 'flex', alignItems: 'center' }}>
                <button 
                  onClick={() => {
                    if (u.fullData) {
                      setPreviewMonster(u.fullData);
                      setIsModalOpen(true);
                    }
                  }}
                  disabled={!u.fullData}
                  style={{ background: 'none', border: 'none', padding: 0, color: 'inherit', font: 'inherit', cursor: u.fullData ? 'pointer' : 'default', textAlign: 'left', flexGrow: 1 }}
                  aria-label={u.fullData ? `Preview ${u.name}` : undefined}
                >
                  <strong>{u.name}</strong> {u.isPlayer ? '(Player)' : `- HP Dice: ${u.hpDice}`}
                </button>
                <button 
                  onClick={() => removeUnit(u.instanceId)} 
                  aria-label={`Remove ${u.name}`}
                  style={{ marginLeft: '1rem' }}
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <button 
        onClick={saveEncounter} 
        disabled={units.length === 0}
        style={{ marginTop: '1rem', fontWeight: 'bold' }}
      >
        Save Encounter
      </button>
    </div>
  );
}
