import { useState, useEffect, useRef, useCallback } from 'react';
import { MonsterDetails } from './MonsterDetails';

export interface Monster {
  id: string;
  name: string;
  meta: {
    size: string;
    type: string;
    tags: string[];
    alignment: string;
  };
  attributes: {
    ac: { value: number; notes?: string };
    hp: { value: number; dice: string };
    speeds: Record<string, number | boolean>;
    initiative_modifier?: number;
  };
  stats: Record<string, { score: number; modifier: number; save: number }>;
  skills: { name: string; modifier: number }[];
  vulnerabilities: string[];
  resistances: string[];
  immunities: { damage: string[]; condition: string[] };
  senses: { name: string; value: number; notes?: string }[];
  languages: string[];
  cr: string;
  source?: string;
  proficiency_bonus?: number;
  traits: { name: string; content: string; usage?: { times: number; type: string } }[];
  actions: { name: string; content: string; is_attack?: boolean; attack_bonus?: number; damage?: { dice: string; type: string }[] }[];
  legendary_actions: { name: string; content: string; cost?: number }[];
  reactions: { name: string; content: string }[];
}

export interface EncounterUnit {
  instanceId: string;
  monsterId?: string;
  name: string;
  maxHp?: number;
  currentHp?: number;
  hpDice?: string; 
  dexMod: number;
  initiative?: number;
  passivePerception?: number;
  isPlayer?: boolean;
  fullData?: Monster;
}

export interface Encounter {
  id: string;
  name: string;
  units: EncounterUnit[];
}

export function EncounterBuilder() {
  const [monsters, setMonsters] = useState<Monster[]>([]);
  const [encounterName, setEncounterName] = useState('New Encounter');
  const [units, setUnits] = useState<EncounterUnit[]>([]);
  const [loading, setLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [previewMonster, setPreviewMonster] = useState<Monster | null>(null);

  const addMonsterBtnRef = useRef<HTMLButtonElement>(null);
  const modalFirstBtnRef = useRef<HTMLButtonElement>(null);
  const previewHeadingRef = useRef<HTMLHeadingElement>(null);

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
    const encounter: Encounter = {
      id: crypto.randomUUID(),
      name: encounterName,
      units: units
    };
    const saved = JSON.parse(localStorage.getItem('saved_encounters') || '[]');
    localStorage.setItem('saved_encounters', JSON.stringify([...saved, encounter]));
    alert(`Encounter "${encounterName}" saved!`);
  };

  if (loading) return <p>Loading data...</p>;

  return (
    <div className="encounter-builder">
      <section aria-labelledby="builder-title">
        <h2 id="builder-title" className="sr-only">Encounter Builder</h2>
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
