import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { useCampaigns } from '../context/CampaignContext';
import { useWorlds } from '../context/WorldContext';
import { EncounterBuilder } from './EncounterBuilder';
import { Markdown } from './Markdown';
import type { AssetType, Asset, Chapter, Encounter, PlayerCharacter } from '../types';
import { MonsterDetails } from './MonsterDetails';
import { SpellDetail } from './SpellBrowser';
import { MagicItemDetail } from './MagicItemBrowser';
import { dataService } from '../services/DataService';
import { AssetInsertionModal } from './AssetInsertionModal';
import { DisclosureSelect } from './DisclosureSelect';
import { CampaignPicker } from './CampaignPicker';
import { WorldBuilder } from './WorldBuilder';
import { parseMentionedAssets, stripMentionTags } from '../utils/assetUtils';
import { isInteractiveTarget, useFocusRestore, useFocusTrap } from './uiHelpers';
import { useAssistantScreen } from '../context/AssistantScreenContext';
import type { AssistantScreenId } from '../utils/assistantScreens';

interface CampaignBuilderProps {
  isCampaignSettingsOpen: boolean;
  onCloseCampaignSettings: () => void;
  onAddCampaign: () => void;
  isNewCampaignOpen: boolean;
}

export function CampaignBuilder({ isCampaignSettingsOpen, onCloseCampaignSettings, onAddCampaign, isNewCampaignOpen }: CampaignBuilderProps) {
  const { activeCampaign, updateCampaign, deleteCampaign, activeChapterId, setActiveChapterId } = useCampaigns();
  const { worlds, activeWorld, updateWorld, createWorld, deleteWorld } = useWorlds();

  // World Association State
  const [showWorldLinkModal, setShowWorldLinkModal] = useState(false);
  const [isCreatingNewWorld, setIsCreatingNewWorld] = useState(false);
  const [newWorldName, setNewWorldName] = useState('');
  const [newWorldDesc, setNewWorldDesc] = useState('');

  // Player State
  const [showPlayerForm, setShowPlayerForm] = useState(false);
  const [editingPlayerId, setEditingPlayerId] = useState<string | null>(null);
  const [playerName, setPlayerName] = useState('');
  const [playerDesc, setPlayerDesc] = useState('');
  
  // Asset State
  const [showAssetForm, setShowAssetForm] = useState(false);
  const [editingAssetId, setEditingAssetId] = useState<string | null>(null);
  const [assetName, setAssetName] = useState('');
  const [assetType, setAssetType] = useState<AssetType>('NPC');
  const [assetDesc, setAssetDesc] = useState('');
  const [selectedAssetChapterIds, setSelectedAssetChapterIds] = useState<string[]>([]);
  const [viewingAsset, setViewingAsset] = useState<{ id: string; tagType: string; name?: string; type?: string; description?: string } | null>(null);

  // Asset Insertion Modal State
  const [showAssetInsertionModal, setShowAssetInsertionModal] = useState(false);
  const [insertionCursorPos, setInsertionCursorPos] = useState<number>(0);

  // Chapter State
  const [showChapterForm, setShowChapterForm] = useState(false);
  const [showChapterOptionsModal, setShowChapterOptionsModal] = useState(false);
  const [editingChapterId, setEditingChapterId] = useState<string | null>(null);
  const [chapterTitle, setChapterTitle] = useState('');
  const [chapterContent, setChapterContent] = useState('');

  // Encounter State
  const [isCreatingEncounter, setIsCreatingEncounter] = useState(false);
  const [editingEncounter, setEditingEncounter] = useState<Encounter | null>(null);

  // View & Chapter Context State
  const [viewMode, setViewMode] = useState<'chapters' | 'all' | 'world'>('chapters');

  // Tell the Assistant Oracle which screen this is. While an encounter is being created/edited,
  // EncounterBuilder takes over and registers itself, so this yields (null).
  const assistantScreen: AssistantScreenId | null =
    isCreatingEncounter || editingEncounter
      ? null
      : viewMode === 'chapters'
        ? 'create.chapters'
        : viewMode === 'all'
          ? 'create.campaign_overview'
          : 'create.world';
  useAssistantScreen(assistantScreen);
  const [dataLoaded, setDataLoaded] = useState(false);
  const selectedChapterId = (activeChapterId && activeCampaign?.chapters?.some(c => c.id === activeChapterId))
    ? activeChapterId
    : (activeCampaign?.chapters?.[0]?.id ?? null);
  const setSelectedChapterId = (id: string | null) => {
    setActiveChapterId(id);
  };

  // Refs for focus management
  const campaignHeadingRef = useRef<HTMLHeadingElement>(null);
  const worldLinkHeadingRef = useRef<HTMLHeadingElement>(null);
  const newWorldHeadingRef = useRef<HTMLHeadingElement>(null);

  const playerHeadingRef = useRef<HTMLHeadingElement>(null);
  const addPlayerBtnRef = useRef<HTMLButtonElement>(null);


  const chapterHeadingRef = useRef<HTMLHeadingElement>(null);
  const chapterOptionsBtnRef = useRef<HTMLButtonElement>(null);
  const chapterOptionsHeadingRef = useRef<HTMLHeadingElement>(null);

  const addAssetBtnRef = useRef<HTMLButtonElement>(null);
  const assetHeadingRef = useRef<HTMLHeadingElement>(null);

  const createEncounterBtnRef = useRef<HTMLButtonElement>(null);
  const assetViewerHeadingRef = useRef<HTMLHeadingElement>(null);
  const { remember, restore } = useFocusRestore();

  // Modal container refs for Tab focus trapping.
  const worldLinkModalRef = useRef<HTMLDivElement>(null);
  const chapterOptionsModalRef = useRef<HTMLDivElement>(null);
  const chapterModalRef = useRef<HTMLDivElement>(null);
  const assetModalRef = useRef<HTMLDivElement>(null);
  const campaignModalRef = useRef<HTMLDivElement>(null);
  const playerModalRef = useRef<HTMLDivElement>(null);
  const assetViewerModalRef = useRef<HTMLDivElement>(null);

  useFocusTrap(worldLinkModalRef, showWorldLinkModal);
  useFocusTrap(chapterOptionsModalRef, showChapterOptionsModal);
  useFocusTrap(chapterModalRef, showChapterForm);
  useFocusTrap(assetModalRef, showAssetForm);
  useFocusTrap(campaignModalRef, isCampaignSettingsOpen);
  useFocusTrap(playerModalRef, showPlayerForm);
  useFocusTrap(assetViewerModalRef, viewingAsset !== null);

  const closePlayerForm = useCallback(() => {
    setShowPlayerForm(false);
    setEditingPlayerId(null);
    setPlayerName('');
    setPlayerDesc('');
    restore('player', () => addPlayerBtnRef.current?.focus());
  }, [restore]);

  const closeChapterForm = useCallback(() => {
    setShowChapterForm(false);
    setEditingChapterId(null);
    setChapterTitle('');
    setChapterContent('');
    restore('chapter', () => chapterOptionsBtnRef.current?.focus());
  }, [restore]);

  const closeChapterOptionsModal = useCallback(() => {
    setShowChapterOptionsModal(false);
    restore('chapterOptions', () => chapterOptionsBtnRef.current?.focus());
  }, [restore]);

  const closeAssetForm = useCallback(() => {
    setShowAssetForm(false);
    setEditingAssetId(null);
    setAssetName('');
    setAssetDesc('');
    setAssetType('NPC');
    setSelectedAssetChapterIds([]);
    restore('asset', () => addAssetBtnRef.current?.focus());
  }, [restore]);

  const closeAssetViewer = useCallback(() => {
    setViewingAsset(null);
    restore('viewer');
  }, [restore]);

  useEffect(() => {
    Promise.all([
      dataService.getAllMonsters(),
      dataService.getAllSpells(),
      dataService.getAllMagicItems()
    ]).then(() => {
      setDataLoaded(true);
    }).catch((err) => {
      console.error(err);
    });
  }, []);

  const closeWorldLinkModal = useCallback(() => {
    setShowWorldLinkModal(false);
    setIsCreatingNewWorld(false);
    restore('world');
  }, [restore]);

  const getSortedAssets = useCallback(() => {
    // Reference dataLoaded so react-hooks/exhaustive-deps knows it is a dependency
    if (dataLoaded) { /* data is ready */ }
    if (!activeCampaign) return [];
    const sorted: Asset[] = [];
    const addedIds = new Set<string>();

    const addCampaignAsset = (id: string, tagType: string = 'Campaign') => {
      const key = `${tagType}:${id}`;
      if (!addedIds.has(key)) {
        let asset: Asset | undefined;
        
        if (tagType === 'Campaign') {
          asset = activeCampaign.assets.find(a => a.id === id);
        } else if (tagType === 'World') {
          const wAsset = activeWorld?.assets.find(a => a.id === id);
          if (wAsset) asset = { ...wAsset, tagType: 'World' };
        } else if (tagType === 'Monster') {
          const m = dataService.getMonsterByIdSync(id);
          if (m) asset = { id: m.id, name: m.name, type: 'NPC', description: 'Global Monster', tagType: 'Monster' };
        } else if (tagType === 'Spell') {
          const s = dataService.getSpellByIdSync(id);
          if (s) asset = { id: s.id.toString(), name: s.name, type: 'Spell', description: 'Global Spell', tagType: 'Spell' };
        } else if (tagType === 'Item') {
          const mi = dataService.getMagicItemByIdSync(id);
          if (mi) asset = { id: mi.id, name: mi.name, type: 'Item', description: 'Global Magic Item', tagType: 'Item' };
        }

        if (asset) {
          sorted.push(asset);
          addedIds.add(key);
        }
      }
    };

    const sortedChapters = [...activeCampaign.chapters].sort((a, b) => a.order - b.order);
    for (const chapter of sortedChapters) {
      if (chapter.mentionedAssets) {
        // Fast path: use the pre-computed index stored on the chapter (new chapters)
        for (const ref of chapter.mentionedAssets) {
          addCampaignAsset(ref.id, ref.tagType);
        }
      } else {
        // Migration path: scan content for chapters saved before this index existed.
        const regex = /@(Campaign|Asset|World|Monster|Spell|Item)\[([^\]]+)\]/g;
        let match: RegExpExecArray | null;
        while ((match = regex.exec(chapter.content)) !== null) {
          const type = match[1] === 'Asset' ? 'Campaign' : match[1];
          addCampaignAsset(match[2], type);
        }
      }

      // Also include assets that were manually associated via the chapter-picker in the asset form
      const associated = activeCampaign.assets.filter(a => a.chapterIds?.includes(chapter.id));
      for (const asset of associated) {
        addCampaignAsset(asset.id, 'Campaign');
      }
    }

    // Phase 3: any remaining campaign assets with no chapter association come last
    for (const asset of activeCampaign.assets) {
      addCampaignAsset(asset.id, 'Campaign');
    }

    return sorted;
  }, [activeCampaign, activeWorld, dataLoaded]);

  useEffect(() => {
    if (isCampaignSettingsOpen) campaignHeadingRef.current?.focus();
  }, [isCampaignSettingsOpen]);

  useEffect(() => {
    if (showWorldLinkModal) {
      setTimeout(() => {
        if (isCreatingNewWorld) {
          newWorldHeadingRef.current?.focus();
        } else {
          worldLinkHeadingRef.current?.focus();
        }
      }, 50);
    }
  }, [showWorldLinkModal, isCreatingNewWorld]);

  useEffect(() => {
    if (showPlayerForm) playerHeadingRef.current?.focus();
  }, [showPlayerForm]);

  useEffect(() => {
    if (showChapterForm) chapterHeadingRef.current?.focus();
  }, [showChapterForm]);

  useEffect(() => {
    if (showChapterOptionsModal) chapterOptionsHeadingRef.current?.focus();
  }, [showChapterOptionsModal]);

  useEffect(() => {
    if (showAssetForm) assetHeadingRef.current?.focus();
  }, [showAssetForm]);

  useEffect(() => {
    if (viewingAsset) {
      remember('viewer');
      assetViewerHeadingRef.current?.focus();
    }
  }, [viewingAsset, remember]);

  // Focus world heading when viewMode changes to world
  useEffect(() => {
    if (viewMode === 'world') {
      setTimeout(() => {
        const heading = document.getElementById('world-info-title') || document.getElementById('world-no-select-heading');
        heading?.focus();
      }, 50);
    }
  }, [viewMode]);

  // Escape key handler for all modals
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !e.defaultPrevented) {
        if (showAssetInsertionModal) {
          setShowAssetInsertionModal(false);
          e.preventDefault();
          setTimeout(() => {
            document.getElementById('chap-content')?.focus();
          }, 0);
        }
        else if (showWorldLinkModal) {
          closeWorldLinkModal();
          e.preventDefault();
        }
        else if (showPlayerForm) {
          closePlayerForm();
          e.preventDefault();
        }
        else if (showChapterForm) {
          closeChapterForm();
          e.preventDefault();
        }
        else if (showChapterOptionsModal) {
          closeChapterOptionsModal();
          e.preventDefault();
        }
        else if (showAssetForm) {
          closeAssetForm();
          e.preventDefault();
        }
        else if (viewingAsset) {
          closeAssetViewer();
          e.preventDefault();
        }
        else if (isCampaignSettingsOpen && !isNewCampaignOpen) {
          onCloseCampaignSettings();
          e.preventDefault();
        }
      }

      // Prevent default behavior for Enter and Space on non-interactive elements
      if ((e.key === 'Enter' || e.key === ' ') && !isInteractiveTarget(e.target)) {
        e.preventDefault();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isCampaignSettingsOpen, isNewCampaignOpen, showPlayerForm, showChapterForm, showChapterOptionsModal, showAssetForm, showAssetInsertionModal, viewingAsset, showWorldLinkModal, onCloseCampaignSettings, closePlayerForm, closeChapterForm, closeChapterOptionsModal, closeAssetForm, closeAssetViewer, closeWorldLinkModal]);

  const closeEncounterForm = () => {
    setIsCreatingEncounter(false);
    setEditingEncounter(null);
    setTimeout(() => createEncounterBtnRef.current?.focus(), 0);
  };

  const getAssetDisplayName = useCallback((asset: Asset) => {
    if (asset.type === 'NPC') {
      const monster = dataService.getMonsterByIdSync(asset.id);
      if (monster) return monster.name;
    } else if (asset.type === 'Spell') {
      const spell = dataService.getSpellByIdSync(asset.id);
      if (spell) return spell.name;
    } else if (asset.type === 'Item') {
      const item = dataService.getMagicItemByIdSync(asset.id);
      if (item) return item.name;
    }
    return asset.name;
  }, []);

  const allChapterAssets = useMemo(() => {
    if (!activeCampaign || !selectedChapterId) return [];

    const currentChapter = activeCampaign.chapters.find(c => c.id === selectedChapterId);
    const dynamicAssetsMap = new Map<string, { id: string; tagType: string; name: string }>();
    if (currentChapter) {
      const regex = /@(Spell|Monster|Item|World|Campaign)\[([^\]]+)\](?:\{([^}]+)\})?/g;
      let match;
      while ((match = regex.exec(currentChapter.content)) !== null) {
        const tagType = match[1];
        const id = match[2];
        const key = `${tagType}-${id}`;
        if (!dynamicAssetsMap.has(key)) {
          let name = match[3] || '';
          if (!name) {
            if (tagType === 'Monster') name = dataService.getMonsterByIdSync(id)?.name || id;
            else if (tagType === 'Spell') name = dataService.getSpellByIdSync(id)?.name || id;
            else if (tagType === 'Item') name = dataService.getMagicItemByIdSync(id)?.name || id;
            else if (tagType === 'Campaign') name = activeCampaign.assets.find(a => a.id === id)?.name || id;
            else if (tagType === 'World') name = activeWorld?.assets.find(a => a.id === id)?.name || id;
            else name = id;
          }
          dynamicAssetsMap.set(key, { id, tagType, name });
        }
      }
    }

    activeCampaign.assets.filter(a => a.chapterIds?.includes(selectedChapterId)).forEach(a => {
      const key = `Campaign-${a.id}`;
      if (!dynamicAssetsMap.has(key)) {
        dynamicAssetsMap.set(key, { id: a.id, tagType: 'Campaign', name: getAssetDisplayName(a) });
      }
    });

    return Array.from(dynamicAssetsMap.values());
  }, [activeCampaign, selectedChapterId, activeWorld, getAssetDisplayName]);

  const handleAddPlayer = async () => {
    if (!activeCampaign || !playerName) return;
    
    let newPlayers;
    if (editingPlayerId) {
      newPlayers = activeCampaign.players.map(p => p.id === editingPlayerId ? { ...p, name: playerName, description: playerDesc } : p);
    } else {
      const newPlayer: PlayerCharacter = {
        id: crypto.randomUUID(),
        name: playerName,
        description: playerDesc
      };
      newPlayers = [...activeCampaign.players, newPlayer];
    }

    await updateCampaign({
      ...activeCampaign,
      players: newPlayers
    });
    closePlayerForm();
  };

  const handleAddAsset = async () => {
    if (!activeCampaign || !assetName) return;
    
    let newAssets;
    if (editingAssetId) {
      const existing = activeCampaign.assets.find(a => a.id === editingAssetId);
      if (existing?.worldAssetId && activeWorld) {
        const updatedWorldAssets = activeWorld.assets.map(wa => {
          if (wa.id === existing.worldAssetId) {
            return {
              ...wa,
              name: assetName,
              type: assetType,
              description: assetDesc
            };
          }
          return wa;
        });
        await updateWorld({
          ...activeWorld,
          assets: updatedWorldAssets
        });
      }
      newAssets = activeCampaign.assets.map(a => a.id === editingAssetId ? { ...a, name: assetName, type: assetType, description: assetDesc, chapterIds: selectedAssetChapterIds } : a);
    } else {
      let nextId = 1;
      if (activeCampaign.assets && activeCampaign.assets.length > 0) {
        const ids = activeCampaign.assets
          .map(a => parseInt(a.id, 10))
          .filter(id => !isNaN(id));
        if (ids.length > 0) {
          nextId = Math.max(...ids) + 1;
        }
      }
      const newAsset: Asset = {
        id: nextId.toString(),
        name: assetName,
        type: assetType,
        description: assetDesc,
        chapterIds: selectedAssetChapterIds
      };
      newAssets = [...activeCampaign.assets, newAsset];
    }

    await updateCampaign({
      ...activeCampaign,
      assets: newAssets
    });
    closeAssetForm();
  };

  const handleAddChapter = async () => {
    if (!activeCampaign || !chapterTitle) return;

    // Compute the mention index from the final content before persisting
    const mentionedAssets = parseMentionedAssets(chapterContent);

    let newChapters;
    let newChapterId = editingChapterId;
    if (editingChapterId) {
      newChapters = activeCampaign.chapters.map(c =>
        c.id === editingChapterId
          ? { ...c, title: chapterTitle, content: chapterContent, mentionedAssets }
          : c
      );
    } else {
      newChapterId = crypto.randomUUID();
      const newChapter: Chapter = {
        id: newChapterId!,
        title: chapterTitle,
        content: chapterContent,
        order: activeCampaign.chapters.length,
        mentionedAssets
      };
      newChapters = [...activeCampaign.chapters, newChapter];
    }

    // Keep Campaign-type asset associations in sync with this chapter's mentions (on save only).
    const mentionedCampaignIds = new Set(
      mentionedAssets.filter(r => r.tagType === 'Campaign').map(r => r.id)
    );
    const newAssets = activeCampaign.assets.map(a =>
      mentionedCampaignIds.has(a.id) && newChapterId && !a.chapterIds?.includes(newChapterId)
        ? { ...a, chapterIds: [...(a.chapterIds || []), newChapterId] }
        : a
    );

    await updateCampaign({
      ...activeCampaign,
      chapters: newChapters,
      assets: newAssets
    });
    if (!editingChapterId && newChapterId) {
      setSelectedChapterId(newChapterId);
    }
    closeChapterForm();
  };



  const handleInsertAsset = async (assetId: string, assetName: string, tagType: string, newAsset?: Asset) => {
    const before = chapterContent.substring(0, insertionCursorPos - 1); // Remove the @
    const after = chapterContent.substring(insertionCursorPos);
    const insertion = `@${tagType}[${assetId}]{${assetName}}`;
    const newContent = before + insertion + after;
    setChapterContent(newContent);
    setShowAssetInsertionModal(false);

    // Only persist a newly created asset immediately (it already exists server-side
    // semantics-wise and must not be lost). The chapter's mention index and asset/chapter
    // links are computed from the final content when the chapter form is saved, so an
    // unsaved editor draft never leaks into a stored chapter (or the wrong one).
    if (activeCampaign && newAsset && !activeCampaign.assets.some(a => a.id === newAsset.id)) {
      await updateCampaign({
        ...activeCampaign,
        assets: [...activeCampaign.assets, newAsset]
      });
    }

    // Restore focus to textarea
    setTimeout(() => {
      const textarea = document.getElementById('chap-content') as HTMLTextAreaElement;
      if (textarea) {
        textarea.focus();
        const newPos = before.length + insertion.length;
        textarea.setSelectionRange(newPos, newPos);
      }
    }, 0);
  };

  const handleDeleteChapter = async (chapterId: string) => {
    if (!activeCampaign) return;
    if (!confirm("Are you sure you want to delete this chapter? Assets and encounters exclusively associated with this chapter will also be deleted.")) return;

    const newChapters = activeCampaign.chapters.filter(c => c.id !== chapterId);
    
    // Cascading delete for assets
    const newAssets = activeCampaign.assets
      .filter(asset => {
        if (!asset.chapterIds || asset.chapterIds.length === 0) return true; // Global
        if (!asset.chapterIds.includes(chapterId)) return true; // Not in this chapter
        return asset.chapterIds.length > 1; // Keep if in other chapters too
      })
      .map(asset => {
        if (!asset.chapterIds?.includes(chapterId)) return asset;
        return { ...asset, chapterIds: asset.chapterIds.filter(id => id !== chapterId) };
      });

    // Cascading delete for encounters
    const newEncounters = activeCampaign.encounters
      .filter(encounter => {
        if (!encounter.chapterIds || encounter.chapterIds.length === 0) return true; // Global
        if (!encounter.chapterIds.includes(chapterId)) return true; // Not in this chapter
        return encounter.chapterIds.length > 1; // Keep if in other chapters too
      })
      .map(encounter => {
        if (!encounter.chapterIds?.includes(chapterId)) return encounter;
        return { ...encounter, chapterIds: encounter.chapterIds.filter(id => id !== chapterId) };
      });

    await updateCampaign({
      ...activeCampaign,
      chapters: newChapters,
      assets: newAssets,
      encounters: newEncounters
    });

    if (selectedChapterId === chapterId) {
      setSelectedChapterId(newChapters.length > 0 ? newChapters[0].id : null);
    }
    setShowChapterOptionsModal(false);
    setTimeout(() => {
      chapterOptionsBtnRef.current?.focus();
    }, 0);
  };

  const handleAddWorld = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newWorldName.trim() && activeCampaign) {
      const created = await createWorld(newWorldName.trim(), newWorldDesc.trim());
      if (created) {
        await updateCampaign({
          ...activeCampaign,
          worldId: created.id
        });
      }
      setNewWorldName('');
      setNewWorldDesc('');
      setIsCreatingNewWorld(false);
      setShowWorldLinkModal(false);
      restore('world');
    }
  };

  const handleDeleteWorld = async (id: string, name: string) => {
    if (confirm(`Are you sure you want to delete the world "${name}"? All assets and connections will be lost.`)) {
      await deleteWorld(id);
      if (activeCampaign && activeCampaign.worldId === id) {
        await updateCampaign({
          ...activeCampaign,
          worldId: undefined
        });
      }
    }
  };

  const handleEditPlayer = useCallback((player: PlayerCharacter) => {
    remember('player');
    setEditingPlayerId(player.id);
    setPlayerName(player.name);
    setPlayerDesc(player.description);
    setShowPlayerForm(true);
  }, [remember]);

  const handleDeletePlayer = useCallback(async (id: string) => {
    if (!activeCampaign) return;
    if (confirm("Are you sure you want to delete this player character?")) {
      await updateCampaign({
        ...activeCampaign,
        players: activeCampaign.players.filter(p => p.id !== id)
      });
    }
  }, [activeCampaign, updateCampaign]);

  const handleEditChapter = useCallback((chapter: Chapter) => {
    remember('chapter', showChapterOptionsModal ? chapterOptionsBtnRef.current : undefined);
    setEditingChapterId(chapter.id);
    setChapterTitle(chapter.title);
    setChapterContent(chapter.content);
    setShowChapterForm(true);
  }, [showChapterOptionsModal, remember]);

  const handleEditAsset = useCallback((asset: Asset) => {
    remember('asset');
    setEditingAssetId(asset.id);
    setAssetName(asset.name);
    setAssetType(asset.type);
    setAssetDesc(asset.description);
    setSelectedAssetChapterIds(asset.chapterIds || []);
    setShowAssetForm(true);
  }, [remember]);

  const handleDeleteEncounter = useCallback(async (id: string) => {
    if (!activeCampaign) return;
    if (confirm("Are you sure you want to delete this encounter?")) {
      await updateCampaign({
        ...activeCampaign,
        encounters: activeCampaign.encounters.filter(e => e.id !== id)
      });
    }
  }, [activeCampaign, updateCampaign]);

  const handleAssetLinkClick = useCallback((id: string, tagType: string) => {
    setViewingAsset({ id, tagType });
  }, []);

  const handleAddAssetClick = () => {
    remember('asset');
    if (viewMode === 'chapters' && selectedChapterId) {
      setSelectedAssetChapterIds([selectedChapterId]);
    } else {
      setSelectedAssetChapterIds([]);
    }
    setShowAssetForm(true);
  };

  const closeAssetInsertionModal = useCallback(() => {
    setShowAssetInsertionModal(false);
    setTimeout(() => {
      document.getElementById('chap-content')?.focus();
    }, 0);
  }, []);

  if (!activeCampaign) {
    return <p>Please select or create a campaign from Campaign Settings in the Main Menu.</p>;
  }

  if (isCreatingEncounter || editingEncounter) {
    return (
      <EncounterBuilder 
        initialEncounter={editingEncounter}
        chapterId={viewMode === 'chapters' ? selectedChapterId : null}
        onClose={closeEncounterForm}
      />
    );
  }

  // Calculate global aria-hidden for the main content when modals are open
  const isAnyModalOpen = isCampaignSettingsOpen || showPlayerForm || showChapterForm || showAssetForm || viewingAsset || showAssetInsertionModal || showWorldLinkModal;

  const handleUnlinkWorld = async () => {
    if (confirm('Are you sure you want to unlink this campaign from its world? Existing assets with links to the world will retain their data but will no longer be linked.')) {
      await updateCampaign({
        ...activeCampaign,
        worldId: undefined
      });
    }
  };

  const handleDeleteCampaign = async () => {
    if (confirm(`Delete the campaign "${activeCampaign.name}"? This cannot be undone.`)) {
      await deleteCampaign(activeCampaign.id);
      onCloseCampaignSettings();
    }
  };

  const linkedWorld = worlds.find(w => w.id === activeCampaign.worldId);
  const linkedWorldName = linkedWorld?.name;

  const sortedAssets = getSortedAssets();

  return (
    <div >

      {/* Link World Modal */}
      {showWorldLinkModal && (
        <div className="modal-overlay" role="dialog" aria-modal="true" aria-labelledby="world-picker-title" style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          backgroundColor: 'rgba(0,0,0,0.5)', display: 'flex',
          alignItems: 'center', justifyContent: 'center', zIndex: 2100
        }}>
          <div ref={worldLinkModalRef} className="modal-content" style={{
            backgroundColor: 'white', padding: '2rem', borderRadius: '8px',
            maxWidth: '500px', width: '90%', maxHeight: '80vh', overflowY: 'auto'
          }}>
            {!isCreatingNewWorld ? (
              <>
                <h2 id="world-picker-title" ref={worldLinkHeadingRef} tabIndex={-1} style={{ outline: 'none', marginTop: 0 }}>Link Campaign to World</h2>
                {worlds.length === 0 ? (
                  <p>No worlds found.</p>
                ) : (
                  <ul style={{ listStyle: 'none', padding: 0, display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                    {worlds.map(w => (
                      <li key={w.id} style={{ display: 'flex', gap: '0.5rem' }}>
                        <button
                          type="button"
                          onClick={async () => {
                            await updateCampaign({
                              ...activeCampaign,
                              worldId: w.id
                            });
                            closeWorldLinkModal();
                          }}
                          style={{ flexGrow: 1, textAlign: 'left', padding: '0.75rem', fontWeight: activeCampaign?.worldId === w.id ? 'bold' : 'normal' }}
                        >
                          {w.name} {activeCampaign?.worldId === w.id && '(Linked)'}
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteWorld(w.id, w.name)}
                          style={{ background: '#d32f2f', color: 'white', border: 'none', padding: '0 1rem' }}
                          aria-label={`Delete ${w.name}`}
                        >
                          Delete
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                <div style={{ marginTop: '2rem', display: 'flex', gap: '1rem' }}>
                  <button type="button" onClick={() => setIsCreatingNewWorld(true)} style={{ flex: 1, padding: '1rem', fontWeight: 'bold' }}>+ Create New World</button>
                  <button
                    type="button"
                    onClick={closeWorldLinkModal}
                    style={{ flex: 1, padding: '1rem', background: '#eee' }}
                  >
                    Cancel
                  </button>
                </div>
              </>
            ) : (
              <form onSubmit={handleAddWorld}>
                <h2 id="world-picker-title" ref={newWorldHeadingRef} tabIndex={-1} style={{ outline: 'none', marginTop: 0 }}>New World</h2>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                  <div>
                    <label htmlFor="new-world-name">World Name:</label>
                    <input
                      id="new-world-name"
                      type="text"
                      required
                      value={newWorldName}
                      onChange={e => setNewWorldName(e.target.value)}
                      style={{ width: '100%', padding: '0.75rem' }}
                    />
                  </div>
                  <div>
                    <label htmlFor="new-world-desc">Description:</label>
                    <textarea
                      id="new-world-desc"
                      value={newWorldDesc}
                      onChange={e => setNewWorldDesc(e.target.value)}
                      style={{ width: '100%', padding: '0.75rem', minHeight: '100px' }}
                    />
                  </div>
                  <div style={{ display: 'flex', gap: '1rem', marginTop: '1rem' }}>
                    <button type="submit" style={{ flex: 1, padding: '1rem', background: '#1976d2', color: 'white', fontWeight: 'bold' }}>Create & Link</button>
                    <button type="button" onClick={() => setIsCreatingNewWorld(false)} style={{ flex: 1, padding: '1rem', background: '#eee' }}>Back</button>
                  </div>
                </div>
              </form>
            )}
          </div>
        </div>
      )}

      <div className="sub-nav" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
        <h2 id="campaign-builder-heading" tabIndex={-1} style={{ margin: 0, outline: 'none' }}>Create Mode</h2>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <div className="tab-group" style={{ marginRight: '1rem' }}>
            <button
              aria-current={viewMode === 'chapters' ? 'page' : undefined}
              onClick={() => setViewMode('chapters')}
              className={viewMode === 'chapters' ? 'active' : ''}
              style={{ fontWeight: viewMode === 'chapters' ? 'bold' : 'normal', borderBottom: viewMode === 'chapters' ? '2px solid #000' : 'none' }}
            >
              Chapters
            </button>
            <button
              aria-current={viewMode === 'all' ? 'page' : undefined}
              onClick={() => setViewMode('all')}
              className={viewMode === 'all' ? 'active' : ''}
              style={{ fontWeight: viewMode === 'all' ? 'bold' : 'normal', borderBottom: viewMode === 'all' ? '2px solid #000' : 'none' }}
            >
              All Assets
            </button>
            <button
              aria-current={viewMode === 'world' ? 'page' : undefined}
              onClick={() => setViewMode('world')}
              className={viewMode === 'world' ? 'active' : ''}
              style={{ fontWeight: viewMode === 'world' ? 'bold' : 'normal', borderBottom: viewMode === 'world' ? '2px solid #000' : 'none' }}
            >
              World
            </button>
          </div>
        </div>
      </div>

      {viewMode === 'chapters' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }} aria-hidden={!!isAnyModalOpen}>
          {/* Chapter Selector */}
          <section style={{ borderBottom: '2px solid #eee', paddingBottom: '1rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
              <DisclosureSelect
                id="chapter-select"
                label="Current Chapter"
                value={selectedChapterId || ''}
                options={activeCampaign.chapters.map(c => ({ value: c.id, label: stripMentionTags(c.title) }))}
                onChange={(id) => setSelectedChapterId(id || null)}
                emptyText="No Chapters"
                buttonStyle={{ padding: '0.5rem', minWidth: '260px', fontWeight: 'bold' }}
              />
            </div>
          </section>

          {/* Active Chapter Content */}
          {selectedChapterId ? (
            <section>
              {(() => {
                const chapter = activeCampaign.chapters.find(c => c.id === selectedChapterId);
                if (!chapter) return <p>Chapter not found.</p>;
                return (
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', marginBottom: '1rem' }}>
                      <button type="button" ref={chapterOptionsBtnRef} onClick={() => {
                        remember('chapterOptions');
                        setShowChapterOptionsModal(true);
                      }}>Chapter Options</button>
                    </div>
                    <div style={{ padding: '1.5rem', border: '1px solid #ccc', borderRadius: '4px', backgroundColor: '#f9f9f9' }}>
                      <h3 style={{ marginTop: 0 }}>{stripMentionTags(chapter.title)}</h3>
                      <Markdown
                        content={chapter.content}
                        onAssetClick={handleAssetLinkClick}
                        baseHeadingLevel={4}
                      />
                    </div>
                  </div>
                );
              })()}
            </section>
          ) : (
            <div style={{ textAlign: 'center', padding: '2rem' }}>
              <p>Write your first chapter to get started!</p>
              <button type="button" onClick={() => setShowChapterForm(true)}>+ Add Chapter</button>
            </div>
          )}

          {/* Chapter-Specific Assets & Encounters */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '2rem' }}>
            <section style={{ flex: '1 1 300px' }}>
              <h3>Chapter Assets</h3>
              {allChapterAssets.length > 0 && (
              <ul style={{ listStyle: 'none', padding: 0, marginBottom: '1rem' }}>
                {(
                  allChapterAssets.map(asset => (
                    <li key={`${asset.tagType}-${asset.id}`} style={{ borderBottom: '1px solid #eee', padding: '0.5rem 0' }}>
                      <div style={{ display: 'flex', alignItems: 'center' }}>
                        <button type="button"
                          onClick={() => handleAssetLinkClick(asset.id, asset.tagType)}
                          style={{ width: '100%', textAlign: 'left', fontWeight: 'bold', background: 'none', border: 'none', padding: '0.5rem', cursor: 'pointer' }}
                        >
                          {asset.name} ({asset.tagType === 'Campaign' ? (activeCampaign.assets.find(a => a.id === asset.id)?.type || 'Campaign') : asset.tagType})
                        </button>
                      </div>
                    </li>
                  ))
                )}
              </ul>
              )}
              <button type="button" ref={addAssetBtnRef} onClick={handleAddAssetClick}>+ Add Asset</button>
            </section>

            <section style={{ flex: '1 1 300px' }}>
              <h3>Chapter Encounters</h3>
              {activeCampaign.encounters.some(e => e.chapterIds?.includes(selectedChapterId || '')) && (
              <ul style={{ listStyle: 'none', padding: 0, marginBottom: '1rem' }}>
                {activeCampaign.encounters.filter(e => e.chapterIds?.includes(selectedChapterId || '')).map(e => (
                  <li key={e.id} style={{ borderBottom: '1px solid #eee', padding: '0.5rem 0', display: 'flex', gap: '1rem', alignItems: 'center' }}>
                    <strong style={{ flexGrow: 1 }}>{e.name} ({e.units.length} units)</strong>
                    <button type="button" onClick={() => setEditingEncounter(e)}>Edit</button>
                    <button type="button" onClick={() => handleDeleteEncounter(e.id)}>Delete</button>
                  </li>
                ))}
              </ul>
              )}
              <button type="button" onClick={() => setIsCreatingEncounter(true)}>+ Create Encounter</button>
            </section>
          </div>
        </div>
      )}

      {viewMode === 'all' && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '2rem' }} aria-hidden={!!isAnyModalOpen}>

          {/* Asset Management */}
          <section style={{ flex: '1 1 300px' }}>
            <h3 id="assets-heading">Manage Assets</h3>
            {sortedAssets.length > 0 && (
            <ul style={{ listStyle: 'none', padding: 0, marginBottom: '1rem' }}>
              {sortedAssets.map(a => {
                const displayName = getAssetDisplayName(a);
                return (
                  <li key={a.id} style={{ borderBottom: '1px solid #eee', padding: '0.5rem 0' }}>
                    <div style={{ display: 'flex', alignItems: 'center' }}>
                      <button type="button"
                        onClick={() => handleAssetLinkClick(a.id, 'Campaign')}
                        style={{ width: '100%', textAlign: 'left', fontWeight: 'bold', background: 'none', border: 'none', padding: '0.5rem', cursor: 'pointer' }}
                      >
                        {displayName} ({a.type})
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
            )}
            <button type="button" ref={addAssetBtnRef} onClick={handleAddAssetClick}>+ Add Asset</button>
          </section>

          {/* Encounter Management */}
          <section style={{ flex: '1 1 100%' }}>
            <h3 id="encounters-heading">Manage Encounters</h3>
            {activeCampaign.encounters.length > 0 && (
            <ul style={{ listStyle: 'none', padding: 0, marginBottom: '1rem' }}>
              {activeCampaign.encounters.map(e => (
                <li key={e.id} style={{ borderBottom: '1px solid #eee', padding: '0.5rem 0', display: 'flex', gap: '1rem', alignItems: 'center' }}>
                  <strong style={{ flexGrow: 1 }}>{e.name} ({e.units.length} units)</strong>
                  <button type="button" onClick={() => setEditingEncounter(e)}>Edit</button>
                  <button type="button" onClick={() => handleDeleteEncounter(e.id)}>Delete</button>
                </li>
              ))}
            </ul>
            )}
            <button type="button" ref={createEncounterBtnRef} onClick={() => setIsCreatingEncounter(true)}>+ Create Encounter</button>
          </section>
        </div>
      )}

      {viewMode === 'world' && (
        !activeWorld ? (
          <div style={{ padding: '2rem', textAlign: 'center' }}>
            <h2 id="world-no-select-heading" tabIndex={-1} style={{ outline: 'none' }}>No World Selected</h2>
            <p>Please select or create a world using Switch World (Alt+W) to get started.</p>
          </div>
        ) : (
          <WorldBuilder />
        )
      )}

      {/* Chapter Options Modal */}
      {showChapterOptionsModal && (
        <div className="modal-overlay" role="dialog" aria-modal="true" aria-labelledby="chapter-options-title" style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          backgroundColor: 'rgba(0,0,0,0.5)', display: 'flex',
          alignItems: 'center', justifyContent: 'center', zIndex: 2000
        }}>
          <div ref={chapterOptionsModalRef} className="modal-content" style={{
            backgroundColor: 'white', padding: '2rem', borderRadius: '8px',
            maxWidth: '400px', width: '90%', display: 'flex', flexDirection: 'column', gap: '1rem'
          }}>
            <h2 id="chapter-options-title" ref={chapterOptionsHeadingRef} tabIndex={-1} style={{ outline: 'none', marginTop: 0 }}>
              Chapter Options
            </h2>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <button type="button" onClick={() => {
                remember('chapter', chapterOptionsBtnRef.current);
                setShowChapterOptionsModal(false);
                setShowChapterForm(true);
              }} style={{ padding: '0.75rem', fontWeight: 'bold' }}>
                Add New Chapter
              </button>
              <button type="button" onClick={() => {
                const chapter = activeCampaign.chapters.find(c => c.id === selectedChapterId);
                if (chapter) handleEditChapter(chapter);
                setShowChapterOptionsModal(false);
              }} style={{ padding: '0.75rem' }}>
                Edit Chapter
              </button>
              <button type="button" onClick={() => {
                if (selectedChapterId) handleDeleteChapter(selectedChapterId);
              }} style={{ padding: '0.75rem', color: '#cc0000' }}>
                Delete Chapter
              </button>
              <button type="button" onClick={closeChapterOptionsModal} style={{ padding: '0.75rem', marginTop: '0.5rem' }}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Chapter Form Modal */}
      {showChapterForm && (
        <div className="modal-overlay" role="dialog" aria-modal="true" aria-labelledby="chapter-modal-title" style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          backgroundColor: 'rgba(0,0,0,0.5)', display: 'flex',
          alignItems: 'center', justifyContent: 'center', zIndex: 2000
        }}>

          <div ref={chapterModalRef} className="modal-content" style={{
            backgroundColor: 'white', padding: '2rem', borderRadius: '8px',
            maxWidth: '600px', width: '90%', maxHeight: '90vh', display: 'flex', flexDirection: 'column'
          }}>
            <h2 id="chapter-modal-title" ref={chapterHeadingRef} tabIndex={-1} style={{ outline: 'none', marginTop: 0 }}>
              {editingChapterId ? 'Edit Chapter' : 'Add New Chapter'}
            </h2>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', flexGrow: 1 }}>
              <div>
                <label htmlFor="chap-title" style={{ display: 'block', fontWeight: 'bold' }}>Chapter Title</label>
                <input 
                  id="chap-title"
                  value={chapterTitle}
                  onChange={e => setChapterTitle(e.target.value)}
                  style={{ width: '100%', padding: '0.5rem' }}
                />
              </div>
              <div style={{ flexGrow: 1, display: 'flex', flexDirection: 'column' }}>
                <label htmlFor="chap-content" style={{ display: 'block', fontWeight: 'bold' }}>Story Text</label>
                <p style={{ margin: '0 0 0.5rem 0', fontSize: '0.85rem', color: '#666' }}>Use # for headings and @Campaign[id]{`{Name}`} or @Monster[id]{`{Name}`} to link assets. Type @ to search.</p>
                <textarea 
                  id="chap-content"
                  value={chapterContent}
                  onChange={e => setChapterContent(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === '@') {
                      const pos = (e.target as HTMLTextAreaElement).selectionStart;
                      setInsertionCursorPos(pos + 1);
                      setShowAssetInsertionModal(true);
                    }
                  }}
                  style={{ width: '100%', flexGrow: 1, minHeight: '200px', padding: '0.5rem', fontFamily: 'monospace' }}
                />
              </div>
              <div style={{ display: 'flex', gap: '1rem', marginTop: '1rem' }}>
                <button type="button" onClick={handleAddChapter} disabled={!chapterTitle} style={{ flex: 1, fontWeight: 'bold' }}>Save</button>
                <button type="button" onClick={closeChapterForm} style={{ flex: 1 }}>Cancel</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Asset Insertion Modal */}
      <AssetInsertionModal
        isOpen={showAssetInsertionModal}
        key={showAssetInsertionModal ? 'open' : 'closed'}
        onClose={closeAssetInsertionModal}
        onInsert={handleInsertAsset}
        campaignAssets={getSortedAssets()}
        worldAssets={activeWorld?.assets}
        chapterId={editingChapterId}
      />

      {/* Asset Form Modal */}
      {showAssetForm && (
        <div className="modal-overlay" role="dialog" aria-modal="true" aria-labelledby="asset-modal-title" style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, 
          backgroundColor: 'rgba(0,0,0,0.5)', display: 'flex', 
          alignItems: 'center', justifyContent: 'center', zIndex: 2000
        }}>
          <div ref={assetModalRef} className="modal-content" style={{
            backgroundColor: 'white', padding: '2rem', borderRadius: '8px',
            maxWidth: '500px', width: '90%', maxHeight: '80vh', overflowY: 'auto'
          }}>
            <h2 id="asset-modal-title" ref={assetHeadingRef} tabIndex={-1} style={{ outline: 'none', marginTop: 0 }}>
              {editingAssetId ? 'Edit Asset' : 'Add New Asset'}
            </h2>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <div>
                <label htmlFor="asset-name" style={{ display: 'block', fontWeight: 'bold' }}>Asset Name</label>
                <input 
                  id="asset-name"
                  placeholder="e.g. King Bruenor"
                  value={assetName}
                  onChange={e => setAssetName(e.target.value)}
                  style={{ width: '100%', padding: '0.5rem' }}
                />
              </div>
              <div>
                <label htmlFor="asset-type" style={{ display: 'block', fontWeight: 'bold' }}>Asset Type</label>
                <select 
                  id="asset-type"
                  value={assetType} 
                  onChange={e => setAssetType(e.target.value as AssetType)}
                  style={{ width: '100%', padding: '0.5rem' }}
                >
                  <option value="NPC">NPC</option>
                  <option value="Location">Location</option>
                  <option value="Item">Item</option>
                  <option value="Spell">Spell</option>
                  <option value="Organization">Organization</option>
                  <option value="Religion">Religion</option>
                  <option value="Lore">Lore</option>
                  <option value="Faction">Faction</option>
                  <option value="Race">Race</option>
                  <option value="Class">Class</option>
                  <option value="Background">Background</option>
                  <option value="Note">Note</option>
                </select>
              </div>
              <fieldset style={{ border: '1px solid #ccc', padding: '1rem', borderRadius: '4px' }}>
                <legend style={{ fontWeight: 'bold', padding: '0 0.5rem' }}>Assign to Chapters</legend>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', maxHeight: '150px', overflowY: 'auto' }}>
                  {activeCampaign.chapters.map(c => (
                    <label key={c.id} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
                      <input 
                        type="checkbox"
                        checked={selectedAssetChapterIds.includes(c.id)}
                        onChange={e => {
                          if (e.target.checked) {
                            setSelectedAssetChapterIds(prev => [...prev, c.id]);
                          } else {
                            setSelectedAssetChapterIds(prev => prev.filter(id => id !== c.id));
                          }
                        }}
                      />
                      {stripMentionTags(c.title)}
                    </label>
                  ))}
                  {activeCampaign.chapters.length === 0 && <p style={{ margin: 0, fontSize: '0.9rem', color: '#666' }}>No chapters created yet.</p>}
                </div>
              </fieldset>
              <div>
                <label htmlFor="asset-desc" style={{ display: 'block', fontWeight: 'bold' }}>Description / Notes</label>
                <textarea 
                  id="asset-desc"
                  value={assetDesc}
                  onChange={e => setAssetDesc(e.target.value)}
                  rows={5}
                  style={{ width: '100%', padding: '0.5rem' }}
                />
              </div>
              <div style={{ display: 'flex', gap: '1rem', marginTop: '1rem' }}>
                <button type="button" onClick={handleAddAsset} disabled={!assetName} style={{ flex: 1, fontWeight: 'bold' }}>Save</button>
                <button type="button" onClick={closeAssetForm} style={{ flex: 1 }}>Cancel</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Campaign Form Modal */}
      {isCampaignSettingsOpen && (
        <div className="modal-overlay" role="dialog" aria-modal="true" aria-labelledby="campaign-modal-title" style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, 
          backgroundColor: 'rgba(0,0,0,0.5)', display: 'flex', 
          alignItems: 'center', justifyContent: 'center', zIndex: 2000
        }}>
          <div ref={campaignModalRef} className="modal-content" style={{
            backgroundColor: 'white', padding: '2rem', borderRadius: '8px',
            maxWidth: '600px', width: '90%', maxHeight: '95vh', overflowY: 'auto'
          }}>
            <h2 id="campaign-modal-title" ref={campaignHeadingRef} tabIndex={-1} style={{ outline: 'none', marginTop: 0 }}>
              Campaign Settings
            </h2>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <CampaignPicker id="camp-switcher" onAddNew={onAddCampaign} />
              <div>
                <label htmlFor="camp-name" style={{ display: 'block', fontWeight: 'bold' }}>Campaign Name</label>
                <input 
                  id="camp-name"
                  value={activeCampaign.name}
                  onChange={e => updateCampaign({ ...activeCampaign, name: e.target.value })}
                  style={{ width: '100%', padding: '0.5rem' }}
                />
              </div>
              <div>
                <label htmlFor="camp-desc" style={{ display: 'block', fontWeight: 'bold' }}>Description</label>
                <textarea 
                  id="camp-desc"
                  value={activeCampaign.description}
                  onChange={e => updateCampaign({ ...activeCampaign, description: e.target.value })}
                  rows={3}
                  style={{ width: '100%', padding: '0.5rem' }}
                />
              </div>

              {/* World Association */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '1rem', backgroundColor: '#fcfcfc', border: '1px solid #ddd', borderRadius: '4px', marginTop: '0.5rem' }}>
                <div>
                  <h3 id="world-link-heading" style={{ margin: 0, fontSize: '1.1rem' }}>World Association</h3>
                  <p style={{ margin: '0.25rem 0 0 0', fontSize: '0.95rem' }}>
                    Linked to: <strong>{linkedWorldName || 'None'}</strong>
                  </p>
                </div>
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  <button type="button" onClick={(e) => { remember('world', e.currentTarget); setShowWorldLinkModal(true); }}>Change World</button>
                  {activeCampaign.worldId && (
                    <button type="button" onClick={handleUnlinkWorld}>Unlink World</button>
                  )}
                </div>
              </div>

              {/* Player Management */}
              <section style={{ marginTop: '1rem' }}>
                <h3 id="players-heading" style={{ margin: '0 0 0.5rem 0', fontSize: '1.2rem' }}>Manage Players</h3>
                {activeCampaign.players.length > 0 && (
                  <ul style={{ listStyle: 'none', padding: 0, marginBottom: '1rem' }}>
                    {activeCampaign.players.map(p => (
                      <li key={p.id} style={{ borderBottom: '1px solid #eee', padding: '0.5rem 0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <div>
                          <strong>{p.name}</strong>
                          <p style={{ margin: 0, fontSize: '0.9rem', color: '#666' }}>{p.description}</p>
                        </div>
                        <div style={{ display: 'flex', gap: '0.5rem' }}>
                          <button type="button" onClick={() => handleEditPlayer(p)}>Edit</button>
                          <button type="button" onClick={() => handleDeletePlayer(p.id)}>Delete</button>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
                <button type="button" ref={addPlayerBtnRef} onClick={(e) => { remember('player', e.currentTarget); setShowPlayerForm(true); }}>+ Add Player</button>
              </section>

              <div style={{ marginTop: '1rem', paddingTop: '1rem', borderTop: '1px solid #ddd' }}>
                <button
                  type="button"
                  onClick={handleDeleteCampaign}
                  style={{ background: '#d32f2f', color: 'white', border: 'none', padding: '0.5rem 1rem', borderRadius: '4px', cursor: 'pointer' }}
                >
                  Delete Campaign
                </button>
              </div>

              <div style={{ display: 'flex', gap: '1rem' }}>
                <button type="button" onClick={onCloseCampaignSettings} style={{ flex: 1 }}>Close</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Player Form Modal */}
      {showPlayerForm && (
        <div className="modal-overlay" role="dialog" aria-modal="true" aria-labelledby="player-modal-title" style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, 
          backgroundColor: 'rgba(0,0,0,0.5)', display: 'flex', 
          alignItems: 'center', justifyContent: 'center', zIndex: 2000
        }}>
          <div ref={playerModalRef} className="modal-content" style={{
            backgroundColor: 'white', padding: '2rem', borderRadius: '8px',
            maxWidth: '500px', width: '90%'
          }}>
            <h2 id="player-modal-title" ref={playerHeadingRef} tabIndex={-1} style={{ outline: 'none', marginTop: 0 }}>
              {editingPlayerId ? 'Edit Player' : 'Add New Player'}
            </h2>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <div>
                <label htmlFor="player-name" style={{ display: 'block', fontWeight: 'bold' }}>Player Name</label>
                <input 
                  id="player-name"
                  value={playerName}
                  onChange={e => setPlayerName(e.target.value)}
                  placeholder="e.g. Grog"
                  style={{ width: '100%', padding: '0.5rem' }}
                />
              </div>
              <div>
                <label htmlFor="player-desc" style={{ display: 'block', fontWeight: 'bold' }}>Description / Class</label>
                <input 
                  id="player-desc"
                  value={playerDesc}
                  onChange={e => setPlayerDesc(e.target.value)}
                  placeholder="e.g. Goliath Barbarian"
                  style={{ width: '100%', padding: '0.5rem' }}
                />
              </div>
              <div style={{ display: 'flex', gap: '1rem', marginTop: '1rem' }}>
                <button type="button" onClick={handleAddPlayer} disabled={!playerName} style={{ flex: 1, fontWeight: 'bold' }}>Save</button>
                <button type="button" onClick={closePlayerForm} style={{ flex: 1 }}>Cancel</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Asset Viewer Modal (for links in preview) */}
      {viewingAsset && (
        <div className="modal-overlay" role="dialog" aria-modal="true" aria-labelledby="asset-viewer-title" style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, 
          backgroundColor: 'rgba(0,0,0,0.5)', display: 'flex', 
          alignItems: 'center', justifyContent: 'center', zIndex: 2000
        }}>
          <div ref={assetViewerModalRef} className="modal-content" style={{
            backgroundColor: 'white', padding: '2rem', borderRadius: '8px',
            maxWidth: '500px', width: '90%', maxHeight: '80vh', overflowY: 'auto'
          }}>
            {(() => {
              if (viewingAsset.tagType === 'Monster') {
                const matchedMonster = dataService.getMonsterByIdSync(viewingAsset.id);
                if (matchedMonster) {
                  return (
                    <div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                        <h2 id="asset-viewer-title" ref={assetViewerHeadingRef} tabIndex={-1} style={{ outline: 'none', margin: 0 }}>
                          Monster Details: {matchedMonster.name}
                        </h2>
                      </div>
                      <MonsterDetails monster={matchedMonster} />
                    </div>
                  );
                }
              }

              if (viewingAsset.tagType === 'Spell') {
                const matchedSpell = dataService.getSpellByIdSync(viewingAsset.id);
                if (matchedSpell) {
                  return (
                    <div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                        <h2 id="asset-viewer-title" ref={assetViewerHeadingRef} tabIndex={-1} style={{ outline: 'none', margin: 0 }}>
                          Spell Details: {matchedSpell.name}
                        </h2>
                      </div>
                      <SpellDetail spell={matchedSpell} />
                    </div>
                  );
                }
              }

              if (viewingAsset.tagType === 'Item') {
                const matchedMagicItem = dataService.getMagicItemByIdSync(viewingAsset.id);
                if (matchedMagicItem) {
                  return (
                    <div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                        <h2 id="asset-viewer-title" ref={assetViewerHeadingRef} tabIndex={-1} style={{ outline: 'none', margin: 0 }}>
                          Magic Item Details: {matchedMagicItem.name}
                        </h2>
                      </div>
                      <MagicItemDetail magicItem={matchedMagicItem} onAssetClick={handleAssetLinkClick} />
                    </div>
                  );
                }
              }

              if (viewingAsset.tagType === 'Campaign') {
                const asset = activeCampaign?.assets.find(a => a.id === viewingAsset.id);
                if (asset) {
                  return (
                    <>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                        <h2 id="asset-viewer-title" ref={assetViewerHeadingRef} tabIndex={-1} style={{ outline: 'none', margin: 0 }}>
                          {asset.name} ({asset.type})
                        </h2>
                        <button type="button" onClick={() => { setViewingAsset(null); handleEditAsset(asset); }}>Edit Asset</button>
                      </div>
                      {asset.description && !asset.description.startsWith('Scraped') && (
                        <div style={{ marginTop: '1rem', padding: '1rem', backgroundColor: '#f0f7ff', borderRadius: '4px', borderLeft: '4px solid #0066cc' }}>
                          <h3 style={{ marginTop: 0, fontSize: '1rem' }}>Notes</h3>
                          <p style={{ whiteSpace: 'pre-wrap', margin: 0 }}>{asset.description}</p>
                        </div>
                      )}
                    </>
                  );
                }
              }

              if (viewingAsset.tagType === 'World') {
                const asset = activeWorld?.assets.find(a => a.id === viewingAsset.id);
                if (asset) {
                  return (
                    <>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                        <h2 id="asset-viewer-title" ref={assetViewerHeadingRef} tabIndex={-1} style={{ outline: 'none', margin: 0 }}>
                          {asset.name} ({asset.type})
                        </h2>
                      </div>
                      {asset.description && (
                        <div style={{ marginTop: '1rem', padding: '1rem', backgroundColor: '#f0f7ff', borderRadius: '4px', borderLeft: '4px solid #0066cc' }}>
                          <h3 style={{ marginTop: 0, fontSize: '1rem' }}>Description</h3>
                          <p style={{ whiteSpace: 'pre-wrap', margin: 0 }}>{asset.description}</p>
                        </div>
                      )}
                    </>
                  );
                }
              }

              return <p>Asset details not found.</p>;
            })()}

            <button type="button" onClick={closeAssetViewer} style={{ marginTop: '2rem', width: '100%', padding: '0.5rem' }}>
              Close (Esc)
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
