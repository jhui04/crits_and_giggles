import { useState, useRef, useEffect } from 'react';
import { useWorlds } from '../context/WorldContext';
import type { WorldAsset } from '../types';

interface WorldAssetBrowserProps {
  autoFocus?: boolean;
}

export function WorldAssetBrowser({ autoFocus }: WorldAssetBrowserProps) {
  const { activeWorld } = useWorlds();
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('All');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const searchInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (autoFocus) {
      searchInputRef.current?.focus();
    }
  }, [autoFocus]);

  if (!activeWorld) {
    return (
      <div style={{ textAlign: 'center', padding: '2rem', color: '#ccc' }}>
        <h3>No World Active</h3>
        <p>Please select or create a world first using Switch World (Alt+W).</p>
      </div>
    );
  }

  const handleToggleExpand = (id: string) => {
    setExpandedId(prev => (prev === id ? null : id));
  };

  // Find incoming (reverse) connections to this asset
  const getIncomingConnections = (assetId: string) => {
    const incoming: { sourceAsset: WorldAsset, relationship: string }[] = [];
    activeWorld.assets.forEach(as => {
      as.connections.forEach(conn => {
        if (conn.targetId === assetId) {
          incoming.push({ sourceAsset: as, relationship: conn.relationship });
        }
      });
    });
    return incoming;
  };

  const filteredAssets = activeWorld.assets.filter(as => {
    const matchesSearch = as.name.toLowerCase().includes(search.toLowerCase()) ||
                          as.description.toLowerCase().includes(search.toLowerCase()) ||
                          as.tags.some(t => t.toLowerCase().includes(search.toLowerCase()));
    const matchesType = typeFilter === 'All' || as.type === typeFilter;
    return matchesSearch && matchesType;
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem', color: 'white' }}>
      <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: '200px' }}>
          <label htmlFor="oracle-wa-search" style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 'bold' }}>Search Assets:</label>
          <input
            id="oracle-wa-search"
            ref={searchInputRef}
            type="search"
            placeholder="Search by name, tags, description..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={{
              width: '100%', padding: '0.75rem',
              background: '#333', color: 'white',
              border: '1px solid #444', borderRadius: '4px'
            }}
          />
        </div>
        <div style={{ minWidth: '150px' }}>
          <label htmlFor="oracle-wa-type" style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 'bold' }}>Type:</label>
          <select
            id="oracle-wa-type"
            value={typeFilter}
            onChange={e => setTypeFilter(e.target.value)}
            style={{
              width: '100%', padding: '0.75rem',
              background: '#333', color: 'white',
              border: '1px solid #444', borderRadius: '4px'
            }}
          >
            <option value="All">All Types</option>
            {['NPC', 'Location', 'Item', 'Spell', 'Organization', 'Religion', 'Lore', 'Faction', 'Race', 'Class', 'Background'].map(t => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="sr-only" aria-live="polite">
        Found {filteredAssets.length} of {activeWorld.assets.length} world assets.
      </div>

      {filteredAssets.length === 0 ? (
        <p style={{ color: '#ccc' }}>No world assets match your search.</p>
      ) : (
        <ul aria-label="World assets search results" style={{ listStyle: 'none', padding: 0, display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          {filteredAssets.map(as => {
            const isExpanded = expandedId === as.id;
            const incoming = getIncomingConnections(as.id);

            return (
              <li 
                key={as.id} 
                style={{
                  background: '#2d2d2d',
                  border: '1px solid #444',
                  borderRadius: '4px',
                  padding: '1rem'
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <span style={{
                      fontSize: '0.75rem',
                      fontWeight: 'bold',
                      textTransform: 'uppercase',
                      background: '#444',
                      padding: '0.15rem 0.4rem',
                      borderRadius: '3px',
                      marginRight: '0.5rem'
                    }}>
                      {as.type}
                    </span>
                    <strong style={{ fontSize: '1.1rem' }}>{as.name}</strong>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleToggleExpand(as.id)}
                    aria-expanded={isExpanded}
                    aria-controls={`oracle-wa-details-${as.id}`}
                    style={{
                      padding: '0.4rem 0.8rem',
                      background: '#444',
                      color: 'white',
                      border: 'none',
                      cursor: 'pointer',
                      borderRadius: '4px'
                    }}
                  >
                    {isExpanded ? 'Hide Details' : 'Show Details'}
                  </button>
                </div>

                <div 
                  id={`oracle-wa-details-${as.id}`} 
                  hidden={!isExpanded}
                  style={{
                    marginTop: '1rem',
                    borderTop: '1px solid #444',
                    paddingTop: '1rem',
                    display: isExpanded ? 'block' : 'none'
                  }}
                >
                  <p style={{ whiteSpace: 'pre-wrap', color: '#ddd', marginBottom: '0.5rem' }}>
                    {as.description || 'No description provided.'}
                  </p>

                  {as.tags.length > 0 && (
                    <div style={{ marginBottom: '0.75rem' }}>
                      <strong>Tags: </strong>
                      {as.tags.map((tag, i) => (
                        <span key={i} style={{
                          fontSize: '0.8rem',
                          background: '#1976d2',
                          color: 'white',
                          padding: '0.1rem 0.4rem',
                          borderRadius: '3px',
                          marginRight: '0.3rem'
                        }}>
                          {tag}
                        </span>
                      ))}
                    </div>
                  )}

                  {/* Connections Summary */}
                  <div style={{ background: '#222', padding: '0.75rem', borderRadius: '4px', marginTop: '1rem' }}>
                    <h4 style={{ margin: '0 0 0.5rem 0', borderBottom: '1px solid #333', paddingBottom: '0.25rem' }}>Connections</h4>
                    {as.connections.length === 0 && incoming.length === 0 ? (
                      <p style={{ margin: 0, fontSize: '0.9rem', color: '#aaa' }}>No connections recorded.</p>
                    ) : (
                      <ul aria-label={`Connections for ${as.name}`} style={{ paddingLeft: '1.25rem', margin: 0 }}>
                        {as.connections.map(conn => {
                          const target = activeWorld.assets.find(t => t.id === conn.targetId);
                          return (
                            <li key={conn.id} style={{ fontSize: '0.95rem', color: '#eee', marginBottom: '0.25rem' }}>
                              "{conn.relationship}" → <strong>{target ? `${target.name} (${target.type})` : 'Unknown Asset'}</strong>
                            </li>
                          );
                        })}
                        {incoming.map(({ sourceAsset, relationship }, idx) => (
                          <li key={idx} style={{ fontSize: '0.95rem', color: '#eee', marginBottom: '0.25rem' }}>
                            <strong>{sourceAsset.name} ({sourceAsset.type})</strong> "{relationship}" → this
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
