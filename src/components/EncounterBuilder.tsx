import { useState, useEffect, useRef } from 'react';

export interface Monster {
  id: string;
  name: string;
  hp_dice: string;
  dex_mod: number;
  ac: number;
}

export interface EncounterUnit {
  instanceId: string;
  monsterId?: string;
  name: string;
  maxHp?: number;
  currentHp?: number;
  hpDice?: string; // Notation for rolling later
  dexMod: number;
  initiative?: number;
  passivePerception?: number;
  isPlayer?: boolean;
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

  const addMonsterBtnRef = useRef<HTMLButtonElement>(null);
  const modalFirstBtnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    fetch('/data/monsters.json')
      .then(res => res.json())
      .then(data => {
        setMonsters(data);
        setLoading(false);
      });
  }, []);

  // Handle focus when modal opens/closes
  useEffect(() => {
    if (isModalOpen) {
      modalFirstBtnRef.current?.focus();
    } else {
      addMonsterBtnRef.current?.focus();
    }
  }, [isModalOpen]);

  const addMonster = (monster: Monster) => {
    const newUnit: EncounterUnit = {
      instanceId: crypto.randomUUID(),
      monsterId: monster.id,
      name: `${monster.name} ${units.filter(u => u.monsterId === monster.id).length + 1}`,
      hpDice: monster.hp_dice,
      dexMod: monster.dex_mod,
      isPlayer: false
    };
    setUnits([...units, newUnit]);
    setIsModalOpen(false);
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
      <section>
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
            maxWidth: '400px', width: '90%'
          }}>
            <h3 id="modal-title">Select Monster</h3>
            <ul style={{ listStyle: 'none', padding: 0 }}>
              {monsters.map((m, index) => (
                <li key={m.id} style={{ marginBottom: '0.5rem' }}>
                  <button 
                    ref={index === 0 ? modalFirstBtnRef : null}
                    onClick={() => addMonster(m)} 
                    style={{ width: '100%', textAlign: 'left' }}
                  >
                    {m.name} (HD: {m.hp_dice})
                  </button>
                </li>
              ))}
            </ul>
            <button onClick={() => setIsModalOpen(false)} style={{ marginTop: '1rem' }}>Cancel</button>
          </div>
        </div>
      )}

      <section>
        <h3>Current Units ({units.length})</h3>
        {units.length === 0 ? <p>No units added yet.</p> : (
          <ul style={{ listStyle: 'none', padding: 0 }}>
            {units.map(u => (
              <li key={u.instanceId} style={{ borderBottom: '1px solid #eee', padding: '0.5rem 0' }}>
                <strong>{u.name}</strong> {u.isPlayer ? '(Player)' : `- HP: ${u.hpDice || 'Fixed'}`}
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
