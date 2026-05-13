import { useState, useEffect, useRef, useMemo } from 'react';
import type { Spell } from '../types';
import { DiceService } from '../services/DiceService';

export function SpellBrowser() {
  const [spells, setSpells] = useState<Spell[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [levelFilter, setLevelFilter] = useState<string>('all');
  const [schoolFilter, setSchoolFilter] = useState<string>('all');
  const [selectedSpell, setSelectedSpell] = useState<Spell | null>(null);

  const searchInputRef = useRef<HTMLInputElement>(null);
  const listHeadingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    fetch('/data/spells.json')
      .then(res => res.json())
      .then(data => {
        setSpells(data.spells || data);
        setIsLoading(false);
      })
      .catch(err => {
        console.error('Failed to load spells:', err);
        setError('Failed to load spells.');
        setIsLoading(false);
      });
  }, []);

  const filteredSpells = useMemo(() => {
    return spells.filter(s => {
      const matchesSearch = s.name.toLowerCase().includes(searchQuery.toLowerCase());
      const matchesLevel = levelFilter === 'all' || s.level.toString() === levelFilter;
      const matchesSchool = schoolFilter === 'all' || s.school === schoolFilter;
      return matchesSearch && matchesLevel && matchesSchool;
    }).sort((a, b) => a.name.localeCompare(b.name));
  }, [spells, searchQuery, levelFilter, schoolFilter]);

  const schools = useMemo(() => {
    const s = new Set(spells.map(spell => spell.school));
    return Array.from(s).sort();
  }, [spells]);

  const handleSelectSpell = (spell: Spell) => {
    setSelectedSpell(spell);
    // Announcement for screen readers
    // We could use a live region for this if needed
  };

  if (isLoading) return <p aria-live="polite">Loading spells...</p>;
  if (error) return <p style={{ color: 'red' }}>{error}</p>;

  return (
    <section aria-labelledby="spell-browser-title">
      <h2 id="spell-browser-title" className="sr-only">Spell Browser</h2>
      
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1rem', marginBottom: '1.5rem', backgroundColor: '#f4f4f4', padding: '1rem', borderRadius: '8px' }}>
        <div style={{ flex: '1 1 300px' }}>
          <label htmlFor="spell-search" style={{ display: 'block', fontWeight: 'bold', marginBottom: '0.25rem' }}>Search Spells</label>
          <input 
            id="spell-search"
            ref={searchInputRef}
            type="text"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder="e.g. Fireball"
            style={{ width: '100%', padding: '0.5rem' }}
          />
        </div>
        <div>
          <label htmlFor="level-filter" style={{ display: 'block', fontWeight: 'bold', marginBottom: '0.25rem' }}>Level</label>
          <select id="level-filter" value={levelFilter} onChange={e => setLevelFilter(e.target.value)} style={{ padding: '0.5rem' }}>
            <option value="all">All Levels</option>
            {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map(l => (
              <option key={l} value={l.toString()}>{l === 0 ? 'Cantrip' : `Level ${l}`}</option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="school-filter" style={{ display: 'block', fontWeight: 'bold', marginBottom: '0.25rem' }}>School</label>
          <select id="school-filter" value={schoolFilter} onChange={e => setSchoolFilter(e.target.value)} style={{ padding: '0.5rem' }}>
            <option value="all">All Schools</option>
            {schools.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
      </div>

      <div style={{ display: 'flex', gap: '2rem', flexWrap: 'wrap' }}>
        <div style={{ flex: '1 1 300px', maxHeight: '600px', overflowY: 'auto', border: '1px solid #ccc', borderRadius: '4px' }}>
          <h3 ref={listHeadingRef} tabIndex={-1} style={{ padding: '0.5rem', margin: 0, backgroundColor: '#eee', borderBottom: '1px solid #ccc' }}>
            Results ({filteredSpells.length})
          </h3>
          <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
            {filteredSpells.map(s => (
              <li key={s.id}>
                <button 
                  type="button"
                  onClick={() => handleSelectSpell(s)}
                  style={{
                    width: '100%', textAlign: 'left', padding: '0.75rem', 
                    border: 'none', borderBottom: '1px solid #eee',
                    backgroundColor: selectedSpell?.id === s.id ? '#e0f0ff' : 'transparent',
                    cursor: 'pointer', fontWeight: selectedSpell?.id === s.id ? 'bold' : 'normal'
                  }}
                  aria-current={selectedSpell?.id === s.id ? 'true' : undefined}
                >
                  {s.name} <span style={{ fontSize: '0.85rem', color: '#666' }}>({s.level === 0 ? 'Cantrip' : `Lvl ${s.level}`})</span>
                </button>
              </li>
            ))}
            {filteredSpells.length === 0 && <li style={{ padding: '1rem' }}>No spells match your filters.</li>}
          </ul>
        </div>

        <div style={{ flex: '2 1 400px' }}>
          {selectedSpell ? (
            <SpellDetail spell={selectedSpell} />
          ) : (
            <div style={{ padding: '2rem', textAlign: 'center', border: '2px dashed #ccc', borderRadius: '8px', color: '#666' }}>
              Select a spell to view details.
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

export function SpellDetail({ spell, onAnnounce }: { spell: Spell, onAnnounce?: (msg: string) => void }) {
  const [activeRoll, setActiveRoll] = useState<{ title: string, result: string } | null>(null);
  const rollModalRef = useRef<HTMLHeadingElement>(null);
  const detailHeadingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    if (detailHeadingRef.current) {
      detailHeadingRef.current.focus();
    }
  }, [spell.id]);

  useEffect(() => {
    if (activeRoll && rollModalRef.current) {
      rollModalRef.current.focus();
    }
  }, [activeRoll]);

  const handleRoll = (title: string, diceNotation: string) => {
    // Basic extraction of dice part: "1d6 Acid" -> "1d6"
    const diceMatch = diceNotation.match(/(\d+d\d+([+-]\d+)?)/i);
    if (diceMatch) {
      const res = DiceService.roll(diceMatch[1]);
      const resultStr = `${res.total} (${res.notation})`;
      setActiveRoll({ title, result: resultStr });
      if (onAnnounce) onAnnounce(`${spell.name} ${title} roll: ${res.total}`);
    }
  };

  return (
    <div style={{ padding: '1.5rem', border: '1px solid #ccc', borderRadius: '8px', backgroundColor: '#fff' }}>
      <h3 ref={detailHeadingRef} tabIndex={-1} style={{ marginTop: 0, borderBottom: '2px solid #333', paddingBottom: '0.5rem', outline: 'none' }}>
        {spell.name}
      </h3>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '1rem', marginBottom: '1.5rem', fontSize: '0.9rem' }}>
        <div><strong>Level:</strong> {spell.level === 0 ? 'Cantrip' : spell.level}</div>
        <div><strong>School:</strong> {spell.school}</div>
        <div><strong>Casting Time:</strong> {spell.casting_time}</div>
        <div><strong>Range:</strong> {spell.range}</div>
        <div><strong>Duration:</strong> {spell.duration}{spell.concentration_required ? ' (Concentration)' : ''}</div>
        <div><strong>Components:</strong> {spell.components}</div>
      </div>

      <div style={{ marginBottom: '1.5rem' }}>
        {spell.damage && (
          <div style={{ marginBottom: '1rem', padding: '0.75rem', backgroundColor: '#fff8f0', border: '1px solid #f0d0b0', borderRadius: '4px' }}>
            <strong>Damage/Effect:</strong> {spell.damage}
            <button 
              type="button" 
              onClick={() => handleRoll('Damage', spell.damage!)}
              style={{ marginLeft: '1rem', padding: '0.25rem 0.75rem', cursor: 'pointer' }}
            >
              Roll Damage
            </button>
          </div>
        )}
        {spell.saving_throw && (
          <p><strong>Saving Throw:</strong> {spell.saving_throw}</p>
        )}
      </div>

      <div style={{ lineHeight: '1.6' }}>
        <h4 style={{ marginBottom: '0.5rem' }}>Description</h4>
        <p style={{ whiteSpace: 'pre-wrap' }}>{spell.description}</p>
        
        {spell.higher_level_description && (
          <div style={{ marginTop: '1rem', padding: '0.5rem', backgroundColor: '#f9f9f9', borderLeft: '4px solid #ccc' }}>
            <strong>At Higher Levels:</strong>
            <p>{spell.higher_level_description}</p>
          </div>
        )}
      </div>

      <p style={{ marginTop: '2rem', fontSize: '0.8rem', color: '#666', borderTop: '1px solid #eee', paddingTop: '0.5rem' }}>
        <strong>Source:</strong> {spell.source}
      </p>

      {activeRoll && (
        <div role="dialog" aria-modal="true" aria-labelledby="spell-roll-title" style={{
          position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
          backgroundColor: '#333', color: 'white', padding: '1.5rem', borderRadius: '8px',
          boxShadow: '0 4px 6px rgba(0,0,0,0.3)', zIndex: 1005, minWidth: '250px', textAlign: 'center'
        }}>
          <h4 id="spell-roll-title" ref={rollModalRef} tabIndex={-1} style={{ outline: 'none', margin: '0 0 1rem 0' }}>
            {activeRoll.title} Result
          </h4>
          <p style={{ fontSize: '1.5rem', fontWeight: 'bold' }}>{activeRoll.result}</p>
          <button type="button" onClick={() => setActiveRoll(null)} style={{ marginTop: '1rem', padding: '0.5rem 1rem', cursor: 'pointer' }}>
            Close (Esc)
          </button>
        </div>
      )}
    </div>
  );
}
