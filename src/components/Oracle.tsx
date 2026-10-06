import { useState, useEffect, useRef } from 'react';
import { MonsterBrowser } from './MonsterBrowser';
import { SpellBrowser } from './SpellBrowser';
import { MagicItemBrowser } from './MagicItemBrowser';
import { WorldAssetBrowser } from './WorldAssetBrowser';
import { DisclosureSelect } from './DisclosureSelect';
import type { DisclosureSelectOption } from './DisclosureSelect';

interface OracleProps {
  isOpen: boolean;
  onClose: () => void;
}

type OracleFilterType = 'monster' | 'spell' | 'item' | 'world';

const SEARCH_TYPES: DisclosureSelectOption<OracleFilterType>[] = [
  { value: 'monster', label: 'Monsters' },
  { value: 'spell', label: 'Spells' },
  { value: 'item', label: 'Magic Items' },
  { value: 'world', label: 'World Assets' },
];

export function Oracle({ isOpen, onClose }: OracleProps) {
  const [filterType, setFilterType] = useState<OracleFilterType>('monster');
  // The browser's search field takes focus when the Oracle opens, but not
  // after a Search Type change: focus then stays on the Search Type button.
  const [autoFocusSearch, setAutoFocusSearch] = useState(true);
  const [wasOpen, setWasOpen] = useState(isOpen);
  if (isOpen !== wasOpen) {
    setWasOpen(isOpen);
    if (isOpen) setAutoFocusSearch(true);
  }
  const modalHeadingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    if (isOpen) {
      setTimeout(() => {
        modalHeadingRef.current?.focus();
      }, 0);
    }
  }, [isOpen]);

  const changeFilterType = (type: OracleFilterType) => {
    setAutoFocusSearch(false);
    setFilterType(type);
  };

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
          <DisclosureSelect
            id="oracle-type-filter"
            label="Search Type"
            value={filterType}
            options={SEARCH_TYPES}
            onChange={changeFilterType}
            buttonStyle={{
              width: '100%', padding: '1rem',
              background: '#333', color: 'white',
              border: '1px solid #444', borderRadius: '4px',
              fontWeight: 'bold', fontSize: '1rem'
            }}
          />
        </div>

        <div style={{ background: '#222', padding: '1.5rem', borderRadius: '4px' }}>
          {filterType === 'monster' ? <MonsterBrowser autoFocus={autoFocusSearch} />
            : filterType === 'spell' ? <SpellBrowser autoFocus={autoFocusSearch} />
            : filterType === 'item' ? <MagicItemBrowser autoFocus={autoFocusSearch} />
            : <WorldAssetBrowser autoFocus={autoFocusSearch} />}
        </div>
      </div>
    </div>
  );
}
