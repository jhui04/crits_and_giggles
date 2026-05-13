import React, { useState, useEffect, useRef, useMemo } from 'react';
import type { Monster, Spell } from '../types';
import { MonsterDetails } from './MonsterDetails';
import { SpellDetail } from './SpellBrowser';

interface OracleProps {
  isOpen: boolean;
  onClose: () => void;
}

type SearchResult = 
  | { type: 'monster'; data: Monster }
  | { type: 'spell'; data: Spell };

export function Oracle({ isOpen, onClose }: OracleProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [filterType, setFilterType] = useState<'all' | 'monster' | 'spell'>('all');
  const [monsters, setMonsters] = useState<Monster[]>([]);
  const [spells, setSpells] = useState<Spell[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedDetail, setSelectedDetail] = useState<SearchResult | null>(null);

  const inputRef = useRef<HTMLInputElement>(null);
  const resultsRef = useRef<HTMLDivElement>(null);
  const modalHeadingRef = useRef<HTMLHeadingElement>(null);
  const detailHeadingRef = useRef<HTMLHeadingElement>(null);
  const lastActiveButtonRef = useRef<HTMLElement | null>(null);

  // Load data only once when the Oracle is first opened or on mount
  useEffect(() => {
    if (isOpen && monsters.length === 0 && spells.length === 0) {
      setIsLoading(true);
      Promise.all([
        fetch('/data/monsters.json').then(res => res.json()),
        fetch('/data/spells.json').then(res => res.json())
      ])
        .then(([monsterData, spellData]) => {
          setMonsters(monsterData.monsters || monsterData);
          setSpells(spellData.spells || spellData);
          setIsLoading(false);
        })
        .catch(err => {
          console.error('Failed to load Oracle data:', err);
          setError('Failed to load search data.');
          setIsLoading(false);
        });
    }
  }, [isOpen, monsters.length, spells.length]);

  // Focus management for the main Oracle modal
  useEffect(() => {
    if (isOpen && !selectedDetail) {
      setTimeout(() => {
        if (lastActiveButtonRef.current) {
          lastActiveButtonRef.current.focus();
        } else {
          modalHeadingRef.current?.focus();
        }
      }, 50);
    }
  }, [isOpen, selectedDetail]);

  const filteredResults = useMemo(() => {
    const query = searchQuery.toLowerCase();
    let monsterResults: SearchResult[] = [];
    let spellResults: SearchResult[] = [];

    if (filterType === 'all' || filterType === 'monster') {
      const uniqueMonsters = new Map<string, Monster>();
      monsters.forEach(m => {
        if (!uniqueMonsters.has(m.name)) {
          uniqueMonsters.set(m.name, m);
        }
      });

      monsterResults = Array.from(uniqueMonsters.values())
        .filter(m => query === '' || m.name.toLowerCase().includes(query))
        .map(m => ({ type: 'monster', data: m }));
    }

    if (filterType === 'all' || filterType === 'spell') {
      const uniqueSpells = new Map<string, Spell>();
      spells.forEach(s => {
        if (!uniqueSpells.has(s.name)) {
          uniqueSpells.set(s.name, s);
        }
      });

      spellResults = Array.from(uniqueSpells.values())
        .filter(s => query === '' || s.name.toLowerCase().includes(query))
        .map(s => ({ type: 'spell', data: s }));
    }

    return [...monsterResults, ...spellResults]
      .sort((a, b) => a.data.name.localeCompare(b.data.name))
      .slice(0, 50);
  }, [searchQuery, monsters, spells, filterType]);

  const resultCountMessage = useMemo(() => {
    if (isLoading) return 'Loading data...';
    if (searchQuery.length > 0 && searchQuery.length < 2) return 'Type at least 2 characters to search.';
    return `${filteredResults.length} result${filteredResults.length === 1 ? '' : 's'} found.`;
  }, [filteredResults.length, isLoading, searchQuery]);

  const handleOpenDetail = (result: SearchResult, e: React.MouseEvent) => {
    lastActiveButtonRef.current = e.currentTarget as HTMLElement;
    setSelectedDetail(result);
  };

  const handleCloseDetail = () => {
    setSelectedDetail(null);
  };
const handleKeyDown = (e: React.KeyboardEvent) => {
  if (e.key === 'Escape') {
    if (selectedDetail) {
      e.stopPropagation();
      if (lastActiveButtonRef.current) {
        lastActiveButtonRef.current.focus();
        lastActiveButtonRef.current = null;
      }
      handleCloseDetail();
    } else {
      onClose();
    }
  }
};

// Focus management for the detail modal
useEffect(() => {
  if (selectedDetail) {
    setTimeout(() => {
      if (detailHeadingRef.current) {
        detailHeadingRef.current.focus();
      }
    }, 100);
  }
}, [selectedDetail]);  if (!isOpen) return null;

  return (
    <div 
      className="oracle-overlay" 
      role="dialog" 
      aria-modal="true" 
      aria-labelledby="oracle-title"
      onKeyDown={handleKeyDown}
      style={{
        position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
        backgroundColor: 'rgba(0,0,0,0.8)', zIndex: 3000,
        display: 'flex', justifyContent: 'center', alignItems: 'flex-start',
        paddingTop: '5vh'
      }}
    >
      <div 
        className="oracle-content"
        style={{
          backgroundColor: '#222', color: '#eee', padding: '2rem',
          borderRadius: '8px', width: '90%', maxWidth: '800px',
          maxHeight: '90vh', overflowY: 'auto', border: '1px solid #444'
        }}
      >
        <h2 id="oracle-title" ref={modalHeadingRef} tabIndex={-1} style={{ outline: 'none' }}>
          The Oracle (Search)
        </h2>
        
        <div style={{ marginBottom: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <div>
            <label id="search-label" htmlFor="oracle-search" aria-hidden="true" style={{ display: 'block', marginBottom: '0.5rem' }}>
              Search for Monsters or Spells
            </label>
            <input 
              id="oracle-search"
              ref={inputRef}
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="e.g. Fireball or Goblin"
              aria-labelledby="search-label"
              style={{
                width: '100%', padding: '0.75rem', fontSize: '1.2rem',
                backgroundColor: '#333', color: '#fff', border: '1px solid #666',
                borderRadius: '4px'
              }}
              autoComplete="off"
            />
          </div>
          
          <div aria-live="polite" className="sr-only">
            {resultCountMessage}
          </div>

          <div>
            <label id="filter-label" htmlFor="oracle-filter" style={{ display: 'block', marginBottom: '0.5rem' }}>
              Filter by Type
            </label>
            <select 
              id="oracle-filter"
              value={filterType}
              onChange={(e) => setFilterType(e.target.value as any)}
              aria-labelledby="filter-label"
              style={{
                width: '100%', padding: '0.5rem', fontSize: '1rem',
                backgroundColor: '#333', color: '#fff', border: '1px solid #666',
                borderRadius: '4px'
              }}
            >
              <option value="all">All Results</option>
              <option value="monster">Monsters Only</option>
              <option value="spell">Spells Only</option>
            </select>
          </div>
        </div>

        {isLoading && <p>Loading Oracle data...</p>}
        {error && <p style={{ color: '#ff6666' }}>{error}</p>}

        <div ref={resultsRef}>
          {filteredResults.length > 0 ? (
            <ul style={{ listStyle: 'none', padding: 0 }}>
              {filteredResults.map((result, idx) => (
                <li key={idx} style={{ marginBottom: '0.5rem' }}>
                  <button
                    id={result.type === 'spell' && result.data.name === 'Aid' ? 'aid-result-btn' : undefined}
                    type="button"
                    onClick={(e) => handleOpenDetail(result, e)}
                    style={{
                      width: '100%', textAlign: 'left', padding: '1rem',
                      backgroundColor: '#333', color: '#eee', border: '1px solid #444',
                      borderRadius: '4px', cursor: 'pointer', display: 'flex', 
                      justifyContent: 'space-between', alignItems: 'center'
                    }}
                    aria-label={`${result.data.name} (${result.type}), view details`}
                  >
                    <div>
                      <span style={{ fontSize: '0.8rem', color: '#aaa', marginRight: '0.5rem' }}>[{result.type.toUpperCase()}]</span>
                      <strong>{result.data.name}</strong>
                    </div>
                    <span style={{ fontSize: '0.9rem', color: '#ccc' }}>
                      {result.type === 'monster' ? `CR ${result.data.cr}` : `Level ${result.data.level === 0 ? 'Cantrip' : result.data.level}`}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            !isLoading && <p>No results found.</p>
          )}
        </div>

        <div style={{ marginTop: '2rem', textAlign: 'right' }}>
          <button 
            type="button" 
            onClick={onClose}
            style={{ padding: '0.5rem 1rem', cursor: 'pointer' }}
          >
            Close Oracle (Esc)
          </button>
        </div>
      </div>

      {selectedDetail && (
        <div 
          className="modal-overlay" 
          role="dialog" 
          aria-modal="true" 
          aria-labelledby="detail-title"
          style={{
            position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
            backgroundColor: 'rgba(0,0,0,0.85)', zIndex: 4000,
            display: 'flex', justifyContent: 'center', alignItems: 'center'
          }}
        >
          <div 
            className="modal-content"
            style={{
              backgroundColor: '#fff', color: '#333', padding: '2rem',
              borderRadius: '8px', width: '90%', maxWidth: '700px',
              maxHeight: '90vh', overflowY: 'auto'
            }}
          >
            <h3 id="detail-title" ref={detailHeadingRef} tabIndex={-1} style={{ outline: 'none', marginTop: 0 }}>
              {selectedDetail.data.name}
            </h3>
            
            {selectedDetail.type === 'monster' ? (
              <MonsterDetails monster={selectedDetail.data} />
            ) : (
              <SpellDetail spell={selectedDetail.data} />
            )}

            <button 
              type="button" 
              onClick={handleCloseDetail}
              style={{ marginTop: '2rem', width: '100%', padding: '0.75rem', cursor: 'pointer', fontWeight: 'bold' }}
            >
              Close Details (Esc)
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
