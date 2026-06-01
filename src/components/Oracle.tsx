import { useState, useEffect, useRef } from 'react';
import { MonsterBrowser } from './MonsterBrowser';
import { SpellBrowser } from './SpellBrowser';

interface OracleProps {
  isOpen: boolean;
  onClose: () => void;
}

export function Oracle({ isOpen, onClose }: OracleProps) {
  const [filterType, setFilterType] = useState<'monster' | 'spell'>('monster');
  const modalHeadingRef = useRef<HTMLHeadingElement>(null);
  const lastActiveButtonRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (isOpen) {
      setTimeout(() => {
        if (lastActiveButtonRef.current) {
          lastActiveButtonRef.current.focus();
        } else {
          modalHeadingRef.current?.focus();
        }
      }, 50);
    }
  }, [isOpen]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      onClose();
    }
  };

  if (!isOpen) return null;

  return (
    <div 
      className="oracle-overlay" 
      role="dialog" 
      aria-modal="true" 
      aria-labelledby="oracle-title"
      onKeyDown={handleKeyDown}
      style={{
        position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
        backgroundColor: 'rgba(0,0,0,0.85)', zIndex: 3000,
        display: 'flex', justifyContent: 'center', alignItems: 'flex-start',
        paddingTop: '5vh'
      }}
    >
      <div className="oracle-content dark-theme" style={{
        backgroundColor: '#1a1a1a', color: 'white', padding: '2rem', borderRadius: '8px',
        maxWidth: '1000px', width: '95%', maxHeight: '90vh', overflowY: 'auto',
        border: '2px solid #444', boxShadow: '0 0 20px rgba(0,0,0,0.5)'
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
          <h2 id="oracle-title" ref={modalHeadingRef} tabIndex={-1} style={{ margin: 0, outline: 'none' }}>The Oracle</h2>
          <button type="button" onClick={onClose} style={{ padding: '0.5rem 1rem', background: '#444', color: 'white', border: 'none', cursor: 'pointer' }}>Close (Esc)</button>
        </div>

        <div style={{ marginBottom: '2rem' }}>
          <label htmlFor="oracle-type-filter" style={{ display: 'block', fontWeight: 'bold', marginBottom: '0.5rem' }}>Search Type:</label>
          <select 
            id="oracle-type-filter"
            value={filterType}
            onChange={(e) => setFilterType(e.target.value as 'monster' | 'spell')}
            style={{ 
              width: '100%', padding: '1rem', 
              background: '#333', color: 'white', 
              border: '1px solid #444', borderRadius: '4px', 
              fontWeight: 'bold', fontSize: '1rem' 
            }}
          >
            <option value="monster">Monsters</option>
            <option value="spell">Spells</option>
          </select>
        </div>

        {filterType === 'monster' ? (
          <div style={{ background: '#222', padding: '1.5rem', borderRadius: '4px' }}>
            <MonsterBrowser onSelect={undefined} autoFocus />
          </div>
        ) : (
          <div style={{ background: '#222', padding: '1.5rem', borderRadius: '4px' }}>
            <SpellBrowser />
          </div>
        )}
      </div>
    </div>
  );
}
