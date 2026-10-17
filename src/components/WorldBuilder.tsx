import { useState, useRef, useEffect } from 'react';
import { useWorlds } from '../context/WorldContext';
import type { WorldAsset, WorldAssetConnection, WorldAssetType, World } from '../types';
import { DisclosureSelect } from './DisclosureSelect';
import { ASSET_TYPES, ASSET_TYPE_FILTER_OPTIONS } from '../utils/assetUtils';
import { RELATIONSHIP_SUGGESTIONS, suggestInverse, inverseLabel, describeIncoming } from '../utils/relationships';

export function WorldBuilder() {
  const { activeWorld, updateWorld } = useWorlds();

  // World Settings Edit State
  const [isEditingWorld, setIsEditingWorld] = useState(false);
  const [worldName, setWorldName] = useState(activeWorld ? activeWorld.name : '');
  const [worldDesc, setWorldDesc] = useState(activeWorld ? activeWorld.description : '');
  const [prevWorldId, setPrevWorldId] = useState(activeWorld?.id);

  if (activeWorld?.id !== prevWorldId) {
    setPrevWorldId(activeWorld?.id);
    setWorldName(activeWorld ? activeWorld.name : '');
    setWorldDesc(activeWorld ? activeWorld.description : '');
  }

  // Asset CRUD State
  const [showAssetForm, setShowAssetForm] = useState(false);
  const [editingAssetId, setEditingAssetId] = useState<string | null>(null);
  const [assetType, setAssetType] = useState<WorldAssetType>('NPC');
  const [assetName, setAssetName] = useState('');
  const [assetDesc, setAssetDesc] = useState('');
  const [assetTagsStr, setAssetTagsStr] = useState('');

  // Asset List Filter/Search State
  const [searchQuery, setSearchQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState<string>('All');
  const [selectedWorldAssetId, setSelectedWorldAssetId] = useState<string | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

  // Connection Add State
  const [connRelationship, setConnRelationship] = useState('');
  const [connInverse, setConnInverse] = useState('');
  const [connInverseTouched, setConnInverseTouched] = useState(false);
  const [connTargetId, setConnTargetId] = useState('');
  const [showRelationModal, setShowRelationModal] = useState(false);
  const [optionsConn, setOptionsConn] = useState<{ sourceId: string; connId: string; label: string; sourceName: string; targetName: string } | null>(null);
  const [optionsDesc, setOptionsDesc] = useState('');
  const [optionsRel, setOptionsRel] = useState('');
  const [optionsInv, setOptionsInv] = useState('');
  const [optionsInvTouched, setOptionsInvTouched] = useState(false);
  const optionsTriggerRef = useRef<HTMLElement | null>(null);
  const optionsModalContentRef = useRef<HTMLDivElement>(null);
  const optionsHeadingRef = useRef<HTMLHeadingElement>(null);
  const connectionsHeadingRef = useRef<HTMLHeadingElement>(null);
  const addRelationBtnRef = useRef<HTMLButtonElement>(null);
  const relationModalContentRef = useRef<HTMLDivElement>(null);
  const relationHeadingRef = useRef<HTMLHeadingElement>(null);

  // Accessibility Announcements
  const [announcement, setAnnouncement] = useState('');

  // Refs for focus management
  const worldNameInputRef = useRef<HTMLInputElement>(null);
  const editWorldBtnRef = useRef<HTMLButtonElement>(null);
  const assetNameInputRef = useRef<HTMLInputElement>(null);
  const addAssetBtnRef = useRef<HTMLButtonElement>(null);
  const listHeadingRef = useRef<HTMLHeadingElement>(null);
  
  // Keep track of which element opened the Asset Form
  const triggerElementRef = useRef<HTMLElement | null>(null);
  const focusTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Refs for world asset details modal accessibility
  const worldAssetTriggerRef = useRef<HTMLElement | null>(null);
  const worldAssetModalContentRef = useRef<HTMLDivElement>(null);
  const worldAssetDetailsHeadingRef = useRef<HTMLHeadingElement>(null);

  // Clear timeout on unmount
  useEffect(() => {
    return () => {
      if (focusTimeoutRef.current) {
        clearTimeout(focusTimeoutRef.current);
      }
    };
  }, []);



  // Focus management when World Edit Form opens
  useEffect(() => {
    if (isEditingWorld) {
      worldNameInputRef.current?.focus();
    }
  }, [isEditingWorld]);

  // Focus management when Asset Form opens
  useEffect(() => {
    if (showAssetForm) {
      const timer = setTimeout(() => {
        assetNameInputRef.current?.focus();
      }, 50);
      return () => clearTimeout(timer);
    }
  }, [showAssetForm]);

  // Focus management when World Asset Details modal opens
  useEffect(() => {
    if (selectedWorldAssetId) {
      worldAssetDetailsHeadingRef.current?.focus();
    }
  }, [selectedWorldAssetId]);

  // Focus trap for World Asset Details modal
  useEffect(() => {
    const handleFocusTrap = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setSelectedWorldAssetId(null);
        setDeleteConfirmId(null);
        setTimeout(() => {
          worldAssetTriggerRef.current?.focus();
        }, 50);
        return;
      }

      if (e.key !== 'Tab' || !worldAssetModalContentRef.current) return;

      const focusableElements = worldAssetModalContentRef.current.querySelectorAll(
        'a[href], button:not([disabled]), textarea, input[type="text"], input[type="radio"], input[type="checkbox"], select'
      );
      if (focusableElements.length === 0) return;
      
      const firstElement = focusableElements[0] as HTMLElement;
      const lastElement = focusableElements[focusableElements.length - 1] as HTMLElement;

      if (e.shiftKey) { // Shift + Tab
        if (document.activeElement === firstElement) {
          lastElement.focus();
          e.preventDefault();
        }
      } else { // Tab
        if (document.activeElement === lastElement) {
          firstElement.focus();
          e.preventDefault();
        }
      }
    };

    if (selectedWorldAssetId && !showRelationModal && !optionsConn) {
      window.addEventListener('keydown', handleFocusTrap);
    }
    return () => window.removeEventListener('keydown', handleFocusTrap);
  }, [selectedWorldAssetId, showRelationModal, optionsConn]);

  // Focus management and focus trap for the Connection Options modal
  useEffect(() => {
    if (!optionsConn) return;
    optionsHeadingRef.current?.focus();

    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        setOptionsConn(null);
        setTimeout(() => optionsTriggerRef.current?.focus(), 50);
        return;
      }
      if (e.key !== 'Tab' || !optionsModalContentRef.current) return;
      const focusable = optionsModalContentRef.current.querySelectorAll<HTMLElement>(
        'h2[tabindex], button:not([disabled]), textarea, input[type="text"]'
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        last.focus();
        e.preventDefault();
      } else if (!e.shiftKey && document.activeElement === last) {
        first.focus();
        e.preventDefault();
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [optionsConn]);

  // Focus management and focus trap for the Add Connection modal
  useEffect(() => {
    if (!showRelationModal) return;
    relationHeadingRef.current?.focus();

    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        setShowRelationModal(false);
        setTimeout(() => addRelationBtnRef.current?.focus(), 50);
        return;
      }
      if (e.key !== 'Tab' || !relationModalContentRef.current) return;
      const focusable = relationModalContentRef.current.querySelectorAll<HTMLElement>(
        'h2[tabindex], button:not([disabled]), input[type="text"], select'
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        last.focus();
        e.preventDefault();
      } else if (!e.shiftKey && document.activeElement === last) {
        first.focus();
        e.preventDefault();
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [showRelationModal]);

  if (!activeWorld) {
    return (
      <div style={{ padding: '2rem', textAlign: 'center' }}>
        <h2>No World Selected</h2>
        <p>Please select or create a world using the Switch World (Alt+W) modal.</p>
      </div>
    );
  }

  // Handle World Info Update
  const handleWorldUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!worldName.trim()) return;

    const updatedWorld: World = {
      ...activeWorld,
      name: worldName.trim(),
      description: worldDesc.trim()
    };
    await updateWorld(updatedWorld);
    setIsEditingWorld(false);
    setAnnouncement('World settings updated successfully.');
    setTimeout(() => editWorldBtnRef.current?.focus(), 50);
  };

  // Handle Asset Create / Update
  const handleAssetSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!assetName.trim()) return;

    const tags = assetTagsStr
      .split(',')
      .map(t => t.trim())
      .filter(t => t.length > 0);

    let updatedAssets = [...activeWorld.assets];

    if (editingAssetId) {
      // Edit existing
      updatedAssets = updatedAssets.map(as => {
        if (as.id === editingAssetId) {
          return {
            ...as,
            type: assetType,
            name: assetName.trim(),
            description: assetDesc.trim(),
            tags
          };
        }
        return as;
      });
      setAnnouncement(`World asset ${assetName} updated.`);
    } else {
      // Create new
      let nextId = 1;
      if (activeWorld.assets && activeWorld.assets.length > 0) {
        const ids = activeWorld.assets
          .map(as => parseInt(as.id, 10))
          .filter(id => !isNaN(id));
        if (ids.length > 0) {
          nextId = Math.max(...ids) + 1;
        }
      }
      const newAsset: WorldAsset = {
        id: nextId.toString(),
        type: assetType,
        name: assetName.trim(),
        description: assetDesc.trim(),
        tags,
        connections: []
      };
      updatedAssets.push(newAsset);
      setAnnouncement(`World asset ${assetName} created.`);
    }

    const updatedWorld: World = {
      ...activeWorld,
      assets: updatedAssets
    };

    const idToFocus = editingAssetId;
    await updateWorld(updatedWorld);
    resetAssetForm();

    // Focus restoration
    if (focusTimeoutRef.current) {
      clearTimeout(focusTimeoutRef.current);
    }
    focusTimeoutRef.current = setTimeout(() => {
      if (idToFocus) {
        const newEditBtn = document.querySelector(`[data-edit-id="${idToFocus}"]`) as HTMLButtonElement | null;
        if (newEditBtn) {
          newEditBtn.focus();
          focusTimeoutRef.current = null;
          return;
        }
      }
      if (triggerElementRef.current && document.body.contains(triggerElementRef.current)) {
        triggerElementRef.current.focus();
        triggerElementRef.current = null;
      } else {
        addAssetBtnRef.current?.focus();
      }
      focusTimeoutRef.current = null;
    }, 100);
  };

  const resetAssetForm = () => {
    setShowAssetForm(false);
    setEditingAssetId(null);
    setAssetType('NPC');
    setAssetName('');
    setAssetDesc('');
    setAssetTagsStr('');
  };

  const handleCancel = () => {
    const idToFocus = editingAssetId;
    resetAssetForm();
    if (focusTimeoutRef.current) {
      clearTimeout(focusTimeoutRef.current);
    }
    focusTimeoutRef.current = setTimeout(() => {
      if (idToFocus) {
        const newEditBtn = document.querySelector(`[data-edit-id="${idToFocus}"]`) as HTMLButtonElement | null;
        if (newEditBtn) {
          newEditBtn.focus();
          focusTimeoutRef.current = null;
          return;
        }
      }
      if (triggerElementRef.current && document.body.contains(triggerElementRef.current)) {
        triggerElementRef.current.focus();
        triggerElementRef.current = null;
      } else {
        addAssetBtnRef.current?.focus();
      }
      focusTimeoutRef.current = null;
    }, 100);
  };

  const openAddAssetForm = (e: React.MouseEvent<HTMLButtonElement>) => {
    if (focusTimeoutRef.current) {
      clearTimeout(focusTimeoutRef.current);
      focusTimeoutRef.current = null;
    }
    triggerElementRef.current = e.currentTarget;
    resetAssetForm();
    setShowAssetForm(true);
  };

  const openEditAssetForm = (asset: WorldAsset, triggerSource?: React.MouseEvent<HTMLButtonElement> | HTMLElement) => {
    if (focusTimeoutRef.current) {
      clearTimeout(focusTimeoutRef.current);
      focusTimeoutRef.current = null;
    }
    if (triggerSource) {
      if ('currentTarget' in triggerSource) {
        triggerElementRef.current = triggerSource.currentTarget;
      } else {
        triggerElementRef.current = triggerSource as HTMLElement;
      }
    }
    setEditingAssetId(asset.id);
    setAssetType(asset.type);
    setAssetName(asset.name);
    setAssetDesc(asset.description);
    setAssetTagsStr(asset.tags.join(', '));
    setShowAssetForm(true);
  };

  // Handle Asset Delete
  const handleAssetDelete = async (id: string, name: string) => {
    // Check if asset has connections
    const targetAsset = activeWorld.assets.find(a => a.id === id);
    const incomingCount = activeWorld.assets.reduce((acc, a) => 
      acc + a.connections.filter(c => c.targetId === id).length, 0
    );
    const outgoingCount = targetAsset?.connections.length || 0;
    const totalConnections = incomingCount + outgoingCount;

    if (deleteConfirmId !== id) {
      setDeleteConfirmId(id);
      let warning = `Delete "${name}"? Click delete again to confirm.`;
      if (totalConnections > 0) {
        warning = `This asset has ${totalConnections} connections that will be removed. Delete "${name}"? Click again to confirm.`;
      }
      setAnnouncement(warning);
      return;
    }

    // Actual deletion: remove asset, and remove any connections referencing this asset
    const updatedAssets = activeWorld.assets
      .filter(as => as.id !== id)
      .map(as => ({
        ...as,
        connections: as.connections.filter(c => c.targetId !== id)
      }));

    const updatedWorld: World = {
      ...activeWorld,
      assets: updatedAssets
    };

    await updateWorld(updatedWorld);
    setDeleteConfirmId(null);
    setAnnouncement(`Asset "${name}" deleted.`);
    setSelectedWorldAssetId(null);

    // Restore focus to list heading
    setTimeout(() => {
      listHeadingRef.current?.focus();
    }, 50);
  };

  const selectedWorldAsset = activeWorld.assets.find(a => a.id === selectedWorldAssetId) || null;

  const closeWorldAssetDetails = () => {
    setShowRelationModal(false);
    setOptionsConn(null);
    setSelectedWorldAssetId(null);
    setDeleteConfirmId(null);
    setTimeout(() => {
      worldAssetTriggerRef.current?.focus();
    }, 50);
  };

  const handleEditFromModal = () => {
    const asset = selectedWorldAsset;
    if (!asset) return;
    setSelectedWorldAssetId(null);
    openEditAssetForm(asset, worldAssetTriggerRef.current || undefined);
  };

  // Connections CRUD inside expanded asset details
  const handleAddConnection = async (e: React.FormEvent, sourceId: string) => {
    e.preventDefault();
    if (!connRelationship.trim() || !connTargetId) return;

    const targetAsset = activeWorld.assets.find(a => a.id === connTargetId);
    if (!targetAsset) return;

    const currentAsset = activeWorld.assets.find(as => as.id === sourceId);
    let nextConnId = 1;
    if (currentAsset && currentAsset.connections && currentAsset.connections.length > 0) {
      const ids = currentAsset.connections
        .map(c => parseInt(c.id, 10))
        .filter(id => !isNaN(id));
      if (ids.length > 0) {
        nextConnId = Math.max(...ids) + 1;
      }
    }

    const newConnection: WorldAssetConnection = {
      id: nextConnId.toString(),
      targetId: connTargetId,
      relationship: connRelationship.trim(),
      inverseRelationship: connInverse.trim()
    };

    const updatedAssets = activeWorld.assets.map(as => {
      if (as.id === sourceId) {
        // Prevent duplicate connections to same target with same relationship
        const duplicate = as.connections.some(c => c.targetId === connTargetId && c.relationship === connRelationship.trim());
        if (duplicate) return as;

        return {
          ...as,
          connections: [...as.connections, newConnection]
        };
      }
      return as;
    });

    const updatedWorld: World = {
      ...activeWorld,
      assets: updatedAssets
    };

    await updateWorld(updatedWorld);
    setAnnouncement(`Added connection: ${connRelationship} ${targetAsset.name}.`);
    setConnRelationship('');
    setConnInverse('');
    setConnInverseTouched(false);
    setConnTargetId('');
    setShowRelationModal(false);
    setTimeout(() => addRelationBtnRef.current?.focus(), 50);
  };

  const openRelationModal = () => {
    setConnRelationship('');
    setConnInverse('');
    setConnInverseTouched(false);
    setConnTargetId('');
    setShowRelationModal(true);
  };

  const closeRelationModal = () => {
    setShowRelationModal(false);
    setTimeout(() => addRelationBtnRef.current?.focus(), 50);
  };

  const openConnectionOptions = (
    e: React.MouseEvent<HTMLButtonElement>,
    sourceId: string,
    conn: WorldAssetConnection,
    label: string,
    sourceName: string,
    targetName: string
  ) => {
    optionsTriggerRef.current = e.currentTarget;
    setOptionsDesc(conn.description || '');
    setOptionsRel(conn.relationship);
    setOptionsInv(inverseLabel(conn));
    setOptionsInvTouched(true);
    setOptionsConn({ sourceId, connId: conn.id, label, sourceName, targetName });
  };

  const closeConnectionOptions = () => {
    setOptionsConn(null);
    setTimeout(() => optionsTriggerRef.current?.focus(), 50);
  };

  const handleSaveConnectionOptions = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!optionsConn || !optionsRel.trim()) return;
    const updatedAssets = activeWorld.assets.map(as =>
      as.id === optionsConn.sourceId
        ? { ...as, connections: as.connections.map(c => c.id === optionsConn.connId ? { ...c, relationship: optionsRel.trim(), inverseRelationship: optionsInv.trim(), description: optionsDesc.trim() } : c) }
        : as
    );
    await updateWorld({ ...activeWorld, assets: updatedAssets });
    setAnnouncement(`Saved connection: ${optionsRel.trim()}.`);
    closeConnectionOptions();
  };

  const handleRemoveFromOptions = async () => {
    if (!optionsConn) return;
    await handleRemoveConnection(optionsConn.sourceId, optionsConn.connId, optionsConn.label);
    setOptionsConn(null);
    setTimeout(() => connectionsHeadingRef.current?.focus(), 50);
  };

  const handleRemoveConnection = async (sourceId: string, connId: string, targetName: string) => {
    const updatedAssets = activeWorld.assets.map(as => {
      if (as.id === sourceId) {
        return {
          ...as,
          connections: as.connections.filter(c => c.id !== connId)
        };
      }
      return as;
    });

    const updatedWorld: World = {
      ...activeWorld,
      assets: updatedAssets
    };

    await updateWorld(updatedWorld);
    setAnnouncement(`Removed connection to ${targetName}.`);
  };

  // Find incoming (reverse) connections to this asset
  const getIncomingConnections = (assetId: string) => {
    const incoming: { sourceAsset: WorldAsset, connection: WorldAssetConnection }[] = [];
    activeWorld.assets.forEach(as => {
      as.connections.forEach(conn => {
        if (conn.targetId === assetId) {
          incoming.push({ sourceAsset: as, connection: conn });
        }
      });
    });
    return incoming;
  };

  // Filtering Assets
  const filteredAssets = activeWorld.assets.filter(as => {
    const matchesSearch = as.name.toLowerCase().includes(searchQuery.toLowerCase()) || 
                          as.description.toLowerCase().includes(searchQuery.toLowerCase()) ||
                          as.tags.some(t => t.toLowerCase().includes(searchQuery.toLowerCase()));
    const matchesType = typeFilter === 'All' || as.type === typeFilter;
    return matchesSearch && matchesType;
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      {/* Hidden Live Region for Screen Readers */}
      <div className="sr-only" role="status" aria-live="polite">
        {announcement}
      </div>

      {/* World General Information & Inline Editing */}
      <div style={{ padding: '1rem', border: '1px solid #ccc', borderRadius: '4px' }}>
        {!isEditingWorld ? (
          <>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <h2 id="world-info-title" tabIndex={-1} style={{ margin: 0, outline: 'none', fontSize: '1.5rem' }}>{activeWorld.name}</h2>
              <button 
                type="button" 
                ref={editWorldBtnRef}
                onClick={() => setIsEditingWorld(true)}
                style={{ padding: '0.5rem 1rem' }}
              >
                Edit World Settings
              </button>
            </div>
            <p style={{ marginTop: '0.5rem', whiteSpace: 'pre-wrap' }}>
              {activeWorld.description || 'No description provided.'}
            </p>
          </>
        ) : (
          <form onSubmit={handleWorldUpdate}>
            <h2 id="world-info-title" style={{ marginTop: 0 }}>Edit World Settings</h2>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <div>
                <label htmlFor="edit-world-name">World Name:</label>
                <input 
                  id="edit-world-name" 
                  ref={worldNameInputRef}
                  type="text" 
                  required
                  value={worldName} 
                  onChange={e => setWorldName(e.target.value)} 
                  style={{ width: '100%', padding: '0.5rem' }}
                />
              </div>
              <div>
                <label htmlFor="edit-world-desc">World Description:</label>
                <textarea 
                  id="edit-world-desc" 
                  value={worldDesc} 
                  onChange={e => setWorldDesc(e.target.value)} 
                  style={{ width: '100%', padding: '0.5rem', minHeight: '100px' }}
                />
              </div>
              <div style={{ display: 'flex', gap: '1rem' }}>
                <button type="submit" style={{ padding: '0.5rem 1rem', background: '#1976d2', color: 'white', fontWeight: 'bold' }}>Save Changes</button>
                <button type="button" onClick={() => setIsEditingWorld(false)} style={{ padding: '0.5rem 1rem', background: '#eee' }}>Cancel</button>
              </div>
            </div>
          </form>
        )}
      </div>

      {/* World Asset CRUD Form (Modal style or Inline overlay style) */}
      {showAssetForm && (
        <div 
          role="dialog" 
          aria-modal="true" 
          aria-labelledby="asset-form-title"
          style={{
            border: '2px solid #1976d2',
            padding: '1.5rem',
            borderRadius: '4px',
            backgroundColor: '#f5f9ff',
            marginBottom: '1rem'
          }}
        >
          <h3 id="asset-form-title">{editingAssetId ? 'Edit World Asset' : 'Add World Asset'}</h3>
          <form onSubmit={handleAssetSubmit}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
                <div style={{ flex: 1, minWidth: '200px' }}>
                  <label htmlFor="asset-form-type">Asset Type:</label>
                  <select 
                    id="asset-form-type" 
                    value={assetType} 
                    onChange={e => setAssetType(e.target.value as WorldAssetType)}
                    style={{ width: '100%', padding: '0.5rem' }}
                  >
                    {ASSET_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
                <div style={{ flex: 2, minWidth: '250px' }}>
                  <label htmlFor="asset-form-name">Asset Name:</label>
                  <input 
                    id="asset-form-name" 
                    ref={assetNameInputRef}
                    type="text" 
                    required
                    value={assetName} 
                    onChange={e => setAssetName(e.target.value)}
                    style={{ width: '100%', padding: '0.5rem' }}
                  />
                </div>
              </div>
              <div>
                <label htmlFor="asset-form-desc">Description:</label>
                <textarea 
                  id="asset-form-desc" 
                  value={assetDesc} 
                  onChange={e => setAssetDesc(e.target.value)}
                  style={{ width: '100%', padding: '0.5rem', minHeight: '100px' }}
                />
              </div>
              <div>
                <label htmlFor="asset-form-tags">Tags (comma-separated):</label>
                <input 
                  id="asset-form-tags" 
                  type="text" 
                  placeholder="e.g. capital, friendly, levels 1-5"
                  value={assetTagsStr} 
                  onChange={e => setAssetTagsStr(e.target.value)}
                  style={{ width: '100%', padding: '0.5rem' }}
                />
              </div>
              <div style={{ display: 'flex', gap: '1rem' }}>
                <button type="submit" style={{ padding: '0.5rem 1rem', background: '#1976d2', color: 'white', fontWeight: 'bold' }}>
                  {editingAssetId ? 'Update Asset' : 'Create Asset'}
                </button>
                <button type="button" onClick={handleCancel} style={{ padding: '0.5rem 1rem', background: '#eee' }}>
                  Cancel
                </button>
              </div>
            </div>
          </form>
        </div>
      )}

      {/* Assets Management Section */}
      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', flexWrap: 'wrap', gap: '1rem' }}>
          <h3 id="assets-heading" ref={listHeadingRef} tabIndex={-1} style={{ margin: 0, outline: 'none' }}>
            World Assets
          </h3>
          {!showAssetForm && (
            <button 
              type="button" 
              ref={addAssetBtnRef}
              onClick={openAddAssetForm}
              style={{ padding: '0.5rem 1rem', fontWeight: 'bold' }}
            >
              + Add World Asset
            </button>
          )}
        </div>

        {/* Filter and Search Controls */}
        <div style={{ display: 'flex', gap: '1rem', marginBottom: '1.5rem', flexWrap: 'wrap', backgroundColor: '#f9f9f9', padding: '1rem', borderRadius: '4px' }}>
          <div style={{ flex: 1, minWidth: '200px' }}>
            <label htmlFor="filter-search">Search assets:</label>
            <input 
              id="filter-search"
              type="search" 
              placeholder="Search by name, description, tags..." 
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              style={{ width: '100%', padding: '0.5rem' }}
            />
          </div>
          <div style={{ minWidth: '200px', alignSelf: 'flex-end' }}>
            <DisclosureSelect
              id="filter-type"
              label="Filter by Type"
              value={typeFilter}
              options={ASSET_TYPE_FILTER_OPTIONS}
              onChange={setTypeFilter}
              buttonStyle={{ width: '100%', padding: '0.5rem' }}
            />
          </div>
        </div>

        {/* Result size announce for SRs */}
        <div className="sr-only" aria-live="polite">
          Showing {filteredAssets.length} of {activeWorld.assets.length} world assets.
        </div>

        {/* Asset List */}
        {filteredAssets.length === 0 ? (
          <p>No world assets found matching the criteria.</p>
        ) : (
          <ul aria-label="World assets list" style={{ listStyle: 'none', padding: 0, display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            {filteredAssets.map(as => (
              <li 
                key={as.id} 
                style={{ 
                  border: '1px solid #ddd', 
                  borderRadius: '4px', 
                  backgroundColor: 'white'
                }}
              >
                <button
                  type="button"
                  data-asset-id={as.id}
                  onClick={(e) => {
                    worldAssetTriggerRef.current = e.currentTarget;
                    setSelectedWorldAssetId(as.id);
                  }}
                  style={{ 
                    width: '100%', 
                    textAlign: 'left', 
                    padding: '1rem', 
                    background: 'none', 
                    border: 'none', 
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.5rem',
                    font: 'inherit'
                  }}
                  aria-haspopup="dialog"
                >
                  <span style={{ 
                    fontSize: '0.8rem', 
                    fontWeight: 'bold', 
                    textTransform: 'uppercase', 
                    backgroundColor: '#eee', 
                    padding: '0.2rem 0.5rem', 
                    borderRadius: '4px',
                    marginRight: '0.5rem'
                  }}>
                    {as.type}
                  </span>
                  <strong>{as.name}</strong>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* World Asset Details Modal */}
      {selectedWorldAsset && (
        <div 
          className="modal-overlay" 
          role="dialog" 
          aria-modal="true" 
          aria-labelledby="world-asset-details-title"
          style={{
            position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, 
            backgroundColor: 'rgba(0,0,0,0.5)', display: 'flex', 
            alignItems: 'center', justifyContent: 'center', zIndex: 2000
          }}
        >
          <div 
            className="modal-content" 
            ref={worldAssetModalContentRef}
            style={{
              backgroundColor: 'white', padding: '2rem', borderRadius: '8px', 
              maxWidth: '600px', width: '90%', maxHeight: '80vh', overflowY: 'auto',
              boxShadow: '0 4px 6px rgba(0,0,0,0.1)'
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
              <h2 
                id="world-asset-details-title" 
                ref={worldAssetDetailsHeadingRef}
                tabIndex={-1} 
                style={{ outline: 'none', margin: 0 }}
              >
                {selectedWorldAsset.name}
              </h2>
              <button 
                type="button" 
                onClick={closeWorldAssetDetails}
                style={{ padding: '0.4rem 0.8rem' }}
              >
                Close (Esc)
              </button>
            </div>

            <p style={{ margin: '0.5rem 0' }}>
              <strong>Type:</strong>{' '}
              <span style={{ 
                fontSize: '0.85rem', 
                fontWeight: 'bold', 
                textTransform: 'uppercase', 
                backgroundColor: '#eee', 
                padding: '0.2rem 0.5rem', 
                borderRadius: '4px'
              }}>
                {selectedWorldAsset.type}
              </span>
            </p>

            <p style={{ whiteSpace: 'pre-wrap', marginBottom: '0.5rem' }}>
              <strong>Description:</strong> {selectedWorldAsset.description || 'No description.'}
            </p>

            {selectedWorldAsset.tags.length > 0 && (
              <p style={{ margin: '0.5rem 0' }}>
                <strong>Tags:</strong>{' '}
                {selectedWorldAsset.tags.map((t, idx) => (
                  <span 
                    key={idx} 
                    style={{ 
                      fontSize: '0.85rem', 
                      backgroundColor: '#e3f2fd', 
                      color: '#0d47a1', 
                      padding: '0.1rem 0.4rem', 
                      borderRadius: '4px',
                      marginRight: '0.4rem'
                    }}
                  >
                    {t}
                  </span>
                ))}
              </p>
            )}

            {/* Connections Section */}
            <div style={{ marginTop: '1.5rem', backgroundColor: '#fcfcfc', padding: '0.75rem', borderRadius: '4px', border: '1px solid #eaeaea' }}>
              <h3 id="modal-connections-heading" ref={connectionsHeadingRef} tabIndex={-1} style={{ outline: 'none', margin: '0 0 0.5rem 0', fontSize: '1.1rem' }}>Connections</h3>
              
              {selectedWorldAsset.connections.length === 0 && getIncomingConnections(selectedWorldAsset.id).length === 0 ? (
                <p style={{ fontSize: '0.9rem', color: '#666' }}>No connections yet.</p>
              ) : (
                <ul aria-label={`Connections for ${selectedWorldAsset.name}`} style={{ paddingLeft: '1.25rem', margin: '0.5rem 0 1rem 0', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                  {/* Outgoing Connections */}
                  {selectedWorldAsset.connections.map(conn => {
                    const target = activeWorld.assets.find(t => t.id === conn.targetId);
                    return (
                      <li key={conn.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '1rem' }}>
                        <span>
                          {conn.relationship} <strong>{target ? `${target.name} (${target.type})` : 'Unknown Asset'}</strong>
                          {conn.description && <span style={{ display: 'block', fontSize: '0.9rem', color: '#444' }}>{conn.description}</span>}
                        </span>
                        <button
                          type="button"
                          onClick={(e) => openConnectionOptions(e, selectedWorldAsset.id, conn, `${conn.relationship} ${target?.name || 'Unknown'}`, selectedWorldAsset.name, target?.name || 'Unknown')}
                          style={{ padding: '0.2rem 0.5rem', fontSize: '0.8rem', background: '#f5f5f5' }}
                          aria-label={`Options for ${conn.relationship} ${target?.name || 'Unknown'}`}
                        >
                          Options
                        </button>
                      </li>
                    );
                  })}

                  {/* Incoming Connections */}
                  {getIncomingConnections(selectedWorldAsset.id).map(({ sourceAsset, connection }) => (
                    <li key={`in-${connection.id}`} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '1rem' }}>
                      <span>
                        {describeIncoming(sourceAsset.name, sourceAsset.type, connection)}
                        {connection.description && <span style={{ display: 'block', fontSize: '0.9rem', color: '#444' }}>{connection.description}</span>}
                      </span>
                      <button
                        type="button"
                        onClick={(e) => openConnectionOptions(e, sourceAsset.id, connection, describeIncoming(sourceAsset.name, sourceAsset.type, connection), sourceAsset.name, selectedWorldAsset.name)}
                        style={{ padding: '0.2rem 0.5rem', fontSize: '0.8rem', background: '#f5f5f5' }}
                        aria-label={`Options for ${describeIncoming(sourceAsset.name, sourceAsset.type, connection)}`}
                      >
                        Options
                      </button>
                    </li>
                  ))}
                </ul>
              )}

              <div style={{ borderTop: '1px dashed #ddd', paddingTop: '0.75rem' }}>
                <button
                  type="button"
                  ref={addRelationBtnRef}
                  onClick={openRelationModal}
                  style={{ padding: '0.4rem 0.8rem', fontSize: '0.9rem', fontWeight: 'bold' }}
                >
                  Add Connection
                </button>
              </div>
            </div>

            {/* Edit / Delete Buttons */}
            <div style={{ display: 'flex', gap: '1rem', marginTop: '2rem', borderTop: '1px solid #eee', paddingTop: '1.5rem' }}>
              <button 
                type="button" 
                onClick={handleEditFromModal}
                style={{ padding: '0.5rem 1rem', flex: 1 }}
              >
                Edit Asset
              </button>
              <button 
                type="button" 
                onClick={() => handleAssetDelete(selectedWorldAsset.id, selectedWorldAsset.name)}
                style={{ 
                  padding: '0.5rem 1rem', 
                  flex: 1,
                  background: deleteConfirmId === selectedWorldAsset.id ? '#c62828' : '#d32f2f', 
                  color: 'white',
                  border: 'none',
                  fontWeight: deleteConfirmId === selectedWorldAsset.id ? 'bold' : 'normal'
                }}
              >
                {deleteConfirmId === selectedWorldAsset.id ? 'Confirm Delete' : 'Delete Asset'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Connection Options Modal */}
      {selectedWorldAsset && optionsConn && (
        <div
          className="modal-overlay"
          role="dialog"
          aria-modal="true"
          aria-labelledby="connection-options-title"
          style={{
            position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
            backgroundColor: 'rgba(0,0,0,0.5)', display: 'flex',
            alignItems: 'center', justifyContent: 'center', zIndex: 2100
          }}
        >
          <div
            className="modal-content"
            ref={optionsModalContentRef}
            style={{
              backgroundColor: 'white', padding: '1.5rem', borderRadius: '8px',
              maxWidth: '500px', width: '90%', maxHeight: '80vh', overflowY: 'auto',
              boxShadow: '0 4px 6px rgba(0,0,0,0.1)'
            }}
          >
            <h2 id="connection-options-title" ref={optionsHeadingRef} tabIndex={-1} style={{ outline: 'none', margin: '0 0 1rem 0', fontSize: '1.25rem' }}>
              Options for {optionsConn.label}
            </h2>
            <form onSubmit={handleSaveConnectionOptions}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '0.75rem' }}>
                <strong>{optionsConn.sourceName}</strong>
                <input
                  id="connection-options-rel"
                  type="text"
                  list="relationship-suggestions"
                  required
                  aria-label={`Relationship: ${optionsConn.sourceName} to ${optionsConn.targetName}`}
                  value={optionsRel}
                  onChange={e => {
                    setOptionsRel(e.target.value);
                    if (!optionsInvTouched) setOptionsInv(suggestInverse(e.target.value));
                  }}
                  style={{ flex: '1 1 8rem', padding: '0.4rem', fontSize: '0.9rem' }}
                />
                <datalist id="relationship-suggestions">
                  {RELATIONSHIP_SUGGESTIONS.map(v => <option key={v} value={v} />)}
                </datalist>
                <strong>{optionsConn.targetName}</strong>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '0.75rem' }}>
                <strong>{optionsConn.targetName}</strong>
                <input
                  id="connection-options-inv"
                  type="text"
                  placeholder="e.g. is hated by"
                  aria-label={`Reverse relationship: ${optionsConn.targetName} to ${optionsConn.sourceName}`}
                  value={optionsInv}
                  onChange={e => { setOptionsInv(e.target.value); setOptionsInvTouched(true); }}
                  style={{ flex: '1 1 8rem', padding: '0.4rem', fontSize: '0.9rem' }}
                />
                <strong>{optionsConn.sourceName}</strong>
              </div>
              <label htmlFor="connection-options-desc" style={{ fontSize: '0.85rem' }}>Connection Description:</label>
              <textarea
                id="connection-options-desc"
                value={optionsDesc}
                onChange={e => setOptionsDesc(e.target.value)}
                rows={4}
                style={{ width: '100%', padding: '0.4rem', fontSize: '0.9rem', marginBottom: '0.75rem' }}
              />
              <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                <button type="submit" style={{ padding: '0.4rem 0.8rem', fontWeight: 'bold' }}>Save</button>
                <button type="button" onClick={closeConnectionOptions} style={{ padding: '0.4rem 0.8rem' }}>Cancel</button>
                <button type="button" onClick={handleRemoveFromOptions} style={{ padding: '0.4rem 0.8rem', marginLeft: 'auto' }}>Delete Connection</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Add Connection Modal */}
      {selectedWorldAsset && showRelationModal && (
        <div
          className="modal-overlay"
          role="dialog"
          aria-modal="true"
          aria-labelledby="add-relation-title"
          style={{
            position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
            backgroundColor: 'rgba(0,0,0,0.5)', display: 'flex',
            alignItems: 'center', justifyContent: 'center', zIndex: 2100
          }}
        >
          <div
            className="modal-content"
            ref={relationModalContentRef}
            style={{
              backgroundColor: 'white', padding: '1.5rem', borderRadius: '8px',
              maxWidth: '500px', width: '90%', maxHeight: '80vh', overflowY: 'auto',
              boxShadow: '0 4px 6px rgba(0,0,0,0.1)'
            }}
          >
            <h2 id="add-relation-title" ref={relationHeadingRef} tabIndex={-1} style={{ outline: 'none', margin: '0 0 1rem 0', fontSize: '1.25rem' }}>
              Add Connection for {selectedWorldAsset.name}
            </h2>
            <form onSubmit={(e) => handleAddConnection(e, selectedWorldAsset.id)} style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', alignItems: 'flex-end' }}>
                <div style={{ flex: 2, minWidth: '180px' }}>
                  <label htmlFor={`conn-rel-${selectedWorldAsset.id}`} style={{ fontSize: '0.85rem' }}>Relationship:</label>
                  <input 
                    id={`conn-rel-${selectedWorldAsset.id}`}
                    type="text" 
                    list="relationship-suggestions"
                    placeholder="e.g. is located in, rules, allied with"
                    required
                    value={connRelationship}
                    onChange={e => {
                      setConnRelationship(e.target.value);
                      if (!connInverseTouched) setConnInverse(suggestInverse(e.target.value));
                    }}
                    style={{ width: '100%', padding: '0.4rem', fontSize: '0.9rem' }}
                  />
                  <datalist id="relationship-suggestions">
                    {RELATIONSHIP_SUGGESTIONS.map(v => <option key={v} value={v} />)}
                  </datalist>
                </div>
                <div style={{ flex: 2, minWidth: '180px' }}>
                  <label htmlFor={`conn-inv-${selectedWorldAsset.id}`} style={{ fontSize: '0.85rem' }}>Reverse relationship (optional):</label>
                  <input
                    id={`conn-inv-${selectedWorldAsset.id}`}
                    type="text"
                    placeholder="e.g. is hated by"
                    value={connInverse}
                    onChange={e => { setConnInverse(e.target.value); setConnInverseTouched(true); }}
                    style={{ width: '100%', padding: '0.4rem', fontSize: '0.9rem' }}
                  />
                </div>
                <div style={{ flex: 2, minWidth: '180px' }}>
                  <label htmlFor={`conn-target-${selectedWorldAsset.id}`} style={{ fontSize: '0.85rem' }}>Target Asset:</label>
                  <select 
                    id={`conn-target-${selectedWorldAsset.id}`}
                    required
                    value={connTargetId}
                    onChange={e => setConnTargetId(e.target.value)}
                    style={{ width: '100%', padding: '0.4rem', fontSize: '0.9rem' }}
                  >
                    <option value="">-- Select Target --</option>
                    {/* Group assets by type in dropdown */}
                    {ASSET_TYPES.map(type => {
                      const options = activeWorld.assets.filter(a => a.id !== selectedWorldAsset.id && a.type === type);
                      if (options.length === 0) return null;
                      return (
                        <optgroup key={type} label={type}>
                          {options.map(o => (
                            <option key={o.id} value={o.id}>{o.name}</option>
                          ))}
                        </optgroup>
                      );
                    })}
                  </select>
                </div>
                <button type="submit" style={{ padding: '0.4rem 0.8rem', fontSize: '0.9rem', fontWeight: 'bold' }}>
                  Add Connection
                </button>
                <button type="button" onClick={closeRelationModal} style={{ padding: '0.4rem 0.8rem', fontSize: '0.9rem' }}>
                  Cancel
                </button>
              </form>
          </div>
        </div>
      )}
    </div>
  );
}
