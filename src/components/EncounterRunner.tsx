import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { DiceService } from '../services/DiceService';
import { diceLogService } from '../services/DiceLogService';
import { MonsterDetails } from './MonsterDetails';
import { MonsterOperationsModal } from './MonsterOperationsModal';
import { CombatMap } from './CombatMap';
import { autoDeployUnits } from '../utils/mapUtils';
import { tickConditionsAtEndOfTurn, formatConditions, normalizeConditions, removeCondition } from '../utils/conditions';
import type { ActiveCondition } from '../utils/conditions';
import { getSaveModifier } from '../utils/dnd';
import {
  getConcentrationDC,
  needsConcentrationCheck,
  buildConcentrationDownAnnouncement,
  buildConcentrationSaveAnnouncement,
} from '../utils/concentrationCheck';
import type { Encounter, EncounterUnit, EncounterRunningState, Campaign, Position, MapSize } from '../types';
import { useCampaigns } from '../context/CampaignContext';
import { useAssistantScreen } from '../context/AssistantScreenContext';
import { dataService } from '../services/DataService';
import { mapGridService } from '../services/MapGridService';
import { isInteractiveTarget, useAnnouncer, useFocusTrap } from './uiHelpers';
import { hasDamageImmunity, hasDamageResistance, hasDamageVulnerability, projectHpApplication } from '../shared/combatHp';
import { UNTYPED_DAMAGE } from '../utils/damageTypes';
import { phaseLabel } from '../utils/phaseNames';
import { buildHpChangeAnnouncement, formatTrackerHp } from '../utils/combatDamageAnnouncements';
import {
  buildUndoAnnouncement,
  buildUndoDescription,
  buildStaleUndoAnnouncement,
  describeUndoAction,
  isUndoEntryStale,
  popUndoEntry,
  pushUndoEntry,
  type HpUndoEntry,
} from '../utils/hpUndoStack';

const DEFAULT_MAP_SIZE: MapSize = { width: 20, height: 20 };

function resolveMapSize(encounter: Encounter): MapSize {
  if (encounter.mapSize) return encounter.mapSize;
  const cachedGrid = encounter.dmMapUrl ? mapGridService.getCachedGrid(encounter.dmMapUrl) : null;
  if (cachedGrid && cachedGrid.columns > 0) {
    return {
      width: cachedGrid.columns,
      height: cachedGrid.rows,
      cellPitch: cachedGrid.cellPitch,
      offsetX: cachedGrid.offsetX,
      offsetY: cachedGrid.offsetY,
      regions: cachedGrid.regions,
      walls: cachedGrid.walls
    };
  }
  return DEFAULT_MAP_SIZE;
}

/** Roll a unit's hit-point dice; returns null (caller falls back to maxHp) on malformed dice. */
function tryRollHp(u: EncounterUnit, purpose: string) {
  if (!u.hpDice) return null;
  try {
    const hpRes = DiceService.roll(u.hpDice);
    if (!Number.isFinite(hpRes.total) || hpRes.total < 1) return null;
    diceLogService.logRoll({
      source: u.name,
      purpose,
      formula: u.hpDice,
      rolls: hpRes.rolls,
      modifier: hpRes.modifier,
      total: hpRes.total
    });
    return hpRes.total;
  } catch (e) {
    console.warn(`Invalid hpDice "${u.hpDice}" for ${u.name}; falling back to max HP.`, e);
    return null;
  }
}

/** Roll initiative (1d20 + dex) and log it. */
function rollInitiative(u: EncounterUnit, purpose: string): number {
  const formula = `1d20${u.dexMod >= 0 ? '+' : ''}${u.dexMod}`;
  const initRoll = DiceService.roll(formula);
  diceLogService.logRoll({
    source: u.name,
    purpose,
    formula,
    rolls: initRoll.rolls,
    modifier: u.dexMod,
    total: initRoll.total,
    critStatus: initRoll.rolls[0] === 20 ? 'crit' : initRoll.rolls[0] === 1 ? 'fumble' : 'normal'
  });
  return initRoll.total;
}

function visibleOf(list: EncounterUnit[], phases: number[]) {
  return list.filter(u => phases.includes(u.phase || 1));
}

export function EncounterRunner({ targetEncounterId }: { targetEncounterId?: string | null }) {
  const { campaigns, activeCampaign, setActiveCampaignId, updateCampaign } = useCampaigns();
  const [activeEncounter, setActiveEncounter] = useState<Encounter | null>(null);
  useAssistantScreen(activeEncounter ? 'run.combat' : 'run.encounter_picker');
  const [combatants, setCombatants] = useState<EncounterUnit[]>([]);
  const [turnIndex, setTurnIndex] = useState(0);
  const [round, setRound] = useState(1);
  const [isCombatStarted, setIsCombatStarted] = useState(false);
  const [announcement, setAnnouncement] = useAnnouncer();
  const [selectedUnitBase, setSelectedUnit] = useState<EncounterUnit | null>(null);
  const [activeOperationsUnit, setActiveOperationsUnit] = useState<EncounterUnit | null>(null);
  const [hpMods, setHpMods] = useState<Record<string, string>>({});
  const [activePhases, setActivePhases] = useState<number[]>([1]);
  // Undo stack for manual DM HP changes (see applyHpMod / undoLastHpChange
  // below). Capped at HP_UNDO_STACK_CAP via pushUndoEntry. Reset whenever
  // the loaded encounter's id actually changes (see hpUndoEncounterIdRef),
  // not on every reload of the same encounter.
  const [hpUndoStack, setHpUndoStack] = useState<HpUndoEntry[]>([]);
  const hpUndoEncounterIdRef = useRef<string | null>(null);

  // Tracks every running_state.updatedAt this component itself has written
  // (not just the most recent one), so the "pick up external server-side
  // updates" effect below can tell its own writes apart from a mutation that
  // happened elsewhere (e.g. an approved Assistant Oracle HITL proposal) and
  // only reload in the latter case.
  //
  // A single "last written" value isn't enough: updateCampaign (see
  // CampaignProvider) serializes PUTs but applies each one's *own* server
  // response to context state as it resolves. With two syncEncounterState
  // calls in flight (e.g. Alt+N pressed twice quickly), the ref gets
  // overwritten with write B's updatedAt before write A's response lands;
  // when A's echo then reaches the "fresh !== last-written" check below, it
  // looks external and triggers a spurious loadEncounter (clearing in-progress
  // HP edits, re-running autoDeploy, and announcing a bogus "Encounter
  // resumed" to the screen reader) even though it's just our own save. A Set
  // of every updatedAt we've written recognizes A's echo as our own no matter
  // which write's response lands last. Bounded/pruned so it can't grow
  // unboundedly over a long session.
  const syncedUpdatedAtsRef = useRef<Set<string>>(new Set());
  const MAX_TRACKED_SYNCED_UPDATED_ATS = 50;

  const recordSyncedUpdatedAt = useCallback((updatedAt: string | null) => {
    if (!updatedAt) return;
    const set = syncedUpdatedAtsRef.current;
    set.add(updatedAt);
    if (set.size > MAX_TRACKED_SYNCED_UPDATED_ATS) {
      const oldest = set.values().next().value;
      if (oldest !== undefined) set.delete(oldest);
    }
  }, []);

  const syncEncounterState = useCallback((
    updatedCombatants: EncounterUnit[],
    combatStarted: boolean = isCombatStarted,
    currentTurn: number = turnIndex,
    currentRound: number = round,
    currentPhases: number[] = activePhases
  ) => {
    if (!activeCampaign || !activeEncounter) return;

    // Strip fullData to keep serialization small and clean
    const cleanCombatants = updatedCombatants.map(c => {
      const copy = { ...c };
      delete copy.fullData;
      return copy;
    });

    const runningState: EncounterRunningState = {
      isCombatStarted: combatStarted,
      round: currentRound,
      turnIndex: currentTurn,
      combatants: cleanCombatants,
      activePhases: currentPhases,
      combatLog: activeEncounter.runningState?.combatLog || [],
      updatedAt: new Date().toISOString()
    };
    recordSyncedUpdatedAt(runningState.updatedAt ?? null);

    // Immediate synchronous localStorage update for instant page refresh recovery
    try {
      localStorage.setItem(`crits_encounter_${activeEncounter.id}`, JSON.stringify(runningState));
    } catch (e) {
      console.warn('Failed to sync encounter to localStorage:', e);
    }

    const existingUnitIds = new Set(activeEncounter.units.map(u => u.instanceId));
    const newlyAddedUnits = updatedCombatants
      .filter(c => !existingUnitIds.has(c.instanceId))
      .map(c => ({
        instanceId: c.instanceId,
        encounterId: activeEncounter.id,
        name: c.name,
        monsterId: c.monsterId,
        currentHp: c.currentHp,
        tempHp: c.tempHp || 0,
        maxHp: c.maxHp,
        initiative: c.initiative,
        position: c.position,
        phase: c.phase ?? 1,
        faction: c.faction,
        isPlayer: !!c.isPlayer,
        dexMod: c.dexMod ?? 0,
      }));

    const mappedExistingUnits = activeEncounter.units.map(u => {
      const found = updatedCombatants.find(c => c.instanceId === u.instanceId);
      if (found) {
        return {
          ...u,
          currentHp: found.currentHp,
          tempHp: found.tempHp,
          maxHp: found.maxHp,
          initiative: found.initiative,
          position: found.position,
          phase: found.phase ?? u.phase ?? 1,
          faction: found.faction ?? u.faction
        };
      }
      return u;
    });

    const updatedEncounter: Encounter = {
      ...activeEncounter,
      units: [...mappedExistingUnits, ...newlyAddedUnits],
      runningState
    };

    const updatedCampaign: Campaign = {
      ...activeCampaign,
      encounters: activeCampaign.encounters.map(e => 
        e.id === activeEncounter.id ? updatedEncounter : e
      )
    };

    updateCampaign(updatedCampaign);
    setActiveEncounter(updatedEncounter);
  }, [activeCampaign, activeEncounter, updateCampaign, isCombatStarted, turnIndex, round, activePhases, recordSyncedUpdatedAt]);

  const handleClose = () => {
    window.close();
    // Fallback if window.close() is blocked
    setTimeout(() => {
      window.location.href = '/';
    }, 100);
  };
  
  const [activeRoll, setActiveRoll] = useState<{ title: string, hit?: string, damage?: string, unitName?: string } | null>(null);
  const [radarRequestedUnit, setRadarRequestedUnit] = useState<EncounterUnit | null>(null);
  const rollModalRef = useRef<HTMLHeadingElement>(null);
  const rollDialogRef = useRef<HTMLDivElement>(null);
  const detailsModalRef = useRef<HTMLDivElement>(null);

  // Root element of this component's own DOM subtree. Used by the global keydown
  // handler below to tell "a dialog opened by this component" (inside this subtree)
  // apart from "a dialog opened by App.tsx or a sibling overlay" (outside it), since
  // App, AssistantOracleModal, and EncounterRunner each register their own window
  // keydown listener and registration order is not guaranteed.
  const rootRef = useRef<HTMLDivElement>(null);

  const unitRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const detailHeadingRef = useRef<HTMLHeadingElement>(null);
  const runnerHeadingRef = useRef<HTMLHeadingElement>(null);
  const lastFocusedUnitId = useRef<string | null>(null);
  const lastActiveRollButtonRef = useRef<HTMLElement | null>(null);
  const lastFocusedOperationsButtonRef = useRef<HTMLButtonElement | null>(null);
  const lastFocusedMapCellRef = useRef<Position | null>(null);
  const undoButtonRef = useRef<HTMLButtonElement | null>(null);
  const nextTurnButtonRef = useRef<HTMLButtonElement | null>(null);

  const loadEncounter = useCallback(async (encounter: Encounter, forceFresh: boolean = false, campaignOverride?: Campaign) => {
    const campaign = campaignOverride ?? activeCampaign;
    setActiveEncounter(encounter);

    // Switching to a genuinely different encounter invalidates any pending
    // undo (it describes HP changes on combatants that may not even exist in
    // the new encounter). Reloading the SAME encounter (an external HITL
    // update, or "Reset Encounter") intentionally leaves the stack alone.
    if (hpUndoEncounterIdRef.current !== encounter.id) {
      hpUndoEncounterIdRef.current = encounter.id;
      setHpUndoStack([]);
    }

    let savedState: EncounterRunningState | null = forceFresh ? null : (encounter.runningState || null);
    if (!forceFresh) {
      try {
        const local = localStorage.getItem(`crits_encounter_${encounter.id}`);
        if (local) {
          const parsed = JSON.parse(local) as EncounterRunningState;
          if (!savedState || (parsed.updatedAt && (!savedState.updatedAt || parsed.updatedAt >= savedState.updatedAt))) {
            savedState = parsed;
          }
        }
      } catch {
        // ignore parse error
      }
    }

    // If there is saved running state (either active combat or entered setup initiatives)
    if (savedState && savedState.combatants && savedState.combatants.length > 0) {
      const enrichedCombatants = await Promise.all(savedState.combatants.map(async u => {
        const copy = { ...u };
        if (!u.isPlayer && u.monsterId && !u.fullData) {
          copy.fullData = await dataService.getMonsterById(u.monsterId) || undefined;
        }
        return copy;
      }));

      const mapSize = resolveMapSize(encounter);
      const deployedCombatants = autoDeployUnits(enrichedCombatants, mapSize);
      setCombatants(deployedCombatants);
      const started = !!savedState.isCombatStarted;
      setIsCombatStarted(started);
      const loadedPhases = savedState.activePhases && savedState.activePhases.length > 0
        ? savedState.activePhases
        : [1];
      const loadedVisible = visibleOf(deployedCombatants, loadedPhases);
      // turnIndex indexes the visible (active-phase) list, so clamp against that.
      const tIdx = Math.min(Math.max(0, savedState.turnIndex || 0), Math.max(0, loadedVisible.length - 1));
      setTurnIndex(tIdx);
      setActivePhases(loadedPhases);
      const rVal = savedState.round || 1;
      setRound(rVal);
      setHpMods({});

      if (started && loadedVisible[tIdx]) {
        const currentConditionsText = formatConditions(loadedVisible[tIdx].conditions);
        const currentPart = currentConditionsText ? `${loadedVisible[tIdx].name}, ${currentConditionsText}` : loadedVisible[tIdx].name;
        setAnnouncement(`Encounter resumed. Round ${rVal}. Current turn: ${currentPart}.`);
      }
      return;
    }

    // Fresh start from template monsters and campaign players:
    const monsterUnits = await Promise.all(encounter.units
      .filter(u => !u.isPlayer)
      .map(async u => {
        const enriched = { ...u, phase: u.phase ?? 1 };
        if (u.monsterId && !u.fullData) {
          enriched.fullData = await dataService.getMonsterById(u.monsterId) || undefined;
        }
        return enriched;
      }));
    
    const existingPlayerUnits = encounter.units.filter(u => u.isPlayer);
    const playerUnits: EncounterUnit[] = (campaign?.players || []).map(p => {
      const existing = existingPlayerUnits.find(ep => ep.playerId === p.id || ep.name === p.name);
      return {
        instanceId: existing?.instanceId || `player-${p.id}`,
        playerId: p.id,
        name: p.name,
        dexMod: existing?.dexMod ?? 0,
        isPlayer: true,
        currentHp: existing?.currentHp ?? 1,
        maxHp: existing?.maxHp ?? 1,
        initiative: existing?.initiative,
        passivePerception: existing?.passivePerception ?? 10,
        position: existing?.position,
        phase: existing?.phase ?? 1
      };
    });

    const mapSize = resolveMapSize(encounter);
    const deployedFresh = autoDeployUnits([...monsterUnits, ...playerUnits], mapSize);
    setCombatants(deployedFresh);
    setActivePhases([1]);
    setIsCombatStarted(false);
    setTurnIndex(0);
    setRound(1);
    setHpMods({});
  }, [activeCampaign, setAnnouncement]);

  const resetCombat = useCallback(() => {
    if (!activeCampaign || !activeEncounter) return;

    try {
      localStorage.removeItem(`crits_encounter_${activeEncounter.id}`);
    } catch {
      // ignore storage error
    }

    const updatedEncounter: Encounter = {
      ...activeEncounter,
      runningState: null
    };

    const updatedCampaign: Campaign = {
      ...activeCampaign,
      encounters: activeCampaign.encounters.map(e => 
        e.id === activeEncounter.id ? updatedEncounter : e
      )
    };

    updateCampaign(updatedCampaign);
    setActiveEncounter(updatedEncounter);
    loadEncounter(updatedEncounter, true);
    setAnnouncement(`Encounter "${activeEncounter.name}" has been reset to setup.`);
  }, [activeCampaign, activeEncounter, updateCampaign, loadEncounter, setAnnouncement]);

  const handleResetCombat = () => {
    if (window.confirm(`Are you sure you want to reset "${activeEncounter?.name}"? This will clear active turns, rounds, and rolled HP.`)) {
      resetCombat();
    }
  };

  useEffect(() => {
    // Focus heading on mount or when view changes. Keyed on the encounter id (not object identity,
    // which changes on every campaign refresh) and skipped while a modal owns focus, so a
    // background refresh after a HITL approval can't steal focus from the open dialog.
    setTimeout(() => {
      if (document.activeElement?.closest('[role="dialog"]')) return;
      runnerHeadingRef.current?.focus();
    }, 0);
  }, [activeEncounter?.id]);

  const lastLoadedId = useRef<string | null>(null);

  useEffect(() => {
    if (targetEncounterId) {
      if (lastLoadedId.current === targetEncounterId) return;
      
      let campaign = activeCampaign;
      if (!campaign || !campaign.encounters.some(e => e.id === targetEncounterId)) {
        const foundCamp = campaigns.find(c => c.encounters.some(e => e.id === targetEncounterId));
        if (foundCamp) {
          campaign = foundCamp;
          setActiveCampaignId(foundCamp.id);
        }
      }

      if (campaign) {
        const encounter = campaign.encounters.find(e => e.id === targetEncounterId);
        if (encounter) {
          lastLoadedId.current = targetEncounterId;
          void loadEncounter(encounter, false, campaign);
        }
      }
    }
  }, [targetEncounterId, activeCampaign, campaigns, setActiveCampaignId, loadEncounter]);

  useEffect(() => {
    if (activeRoll && rollModalRef.current) {
      rollModalRef.current.focus();
    } else if (!activeRoll && lastActiveRollButtonRef.current) {
      lastActiveRollButtonRef.current.focus();
      lastActiveRollButtonRef.current = null;
    }
  }, [activeRoll]);

  const availablePhases = useMemo(() => {
    const phases = new Set<number>([1]);
    combatants.forEach(u => phases.add(u.phase || 1));
    return Array.from(phases).sort((a, b) => a - b);
  }, [combatants]);

  const visibleCombatants = useMemo(() => visibleOf(combatants, activePhases), [combatants, activePhases]);

  // Derive the open details unit from live combatants so HP edits show immediately.
  const selectedUnit = useMemo(
    () => selectedUnitBase ? (combatants.find(c => c.instanceId === selectedUnitBase.instanceId) ?? selectedUnitBase) : null,
    [selectedUnitBase, combatants]
  );

  const phaseName = (phaseNum: number) => phaseLabel(activeEncounter?.phaseNames, phaseNum);

  const togglePhase = (phaseNum: number) => {
    const isCurrentlyActive = activePhases.includes(phaseNum);
    // Keep the current turn pinned to the same unit across phase changes.
    const currentId = isCombatStarted ? visibleCombatants[turnIndex]?.instanceId : undefined;
    const resolveTurnIndex = (nextList: EncounterUnit[]) => {
      if (!isCombatStarted || nextList.length === 0) return 0;
      if (currentId) {
        const same = nextList.findIndex(u => u.instanceId === currentId);
        if (same >= 0) return same;
        // Current unit was hidden: advance to the next unit (in old order) that is still visible.
        for (let k = turnIndex + 1; k < visibleCombatants.length; k++) {
          const idx = nextList.findIndex(u => u.instanceId === visibleCombatants[k].instanceId);
          if (idx >= 0) return idx;
        }
      }
      return Math.min(turnIndex, nextList.length - 1);
    };

    if (isCurrentlyActive) {
      if (activePhases.length === 1) {
        setAnnouncement(`Cannot deactivate ${phaseName(phaseNum)}: at least one phase must remain active.`);
        return;
      }
      const nextPhases = activePhases.filter(p => p !== phaseNum);
      const hiddenUnits = combatants.filter(u => (u.phase || 1) === phaseNum);
      const nextIdx = resolveTurnIndex(visibleOf(combatants, nextPhases));
      setAnnouncement(`${phaseName(phaseNum)} deactivated. ${hiddenUnits.length} unit${hiddenUnits.length === 1 ? '' : 's'} hidden from encounter.`);
      setActivePhases(nextPhases);
      setTurnIndex(nextIdx);
      syncEncounterState(combatants, isCombatStarted, nextIdx, round, nextPhases);
    } else {
      const nextPhases = [...activePhases, phaseNum].sort((a, b) => a - b);
      const newlyVisible = combatants.filter(u => (u.phase || 1) === phaseNum);

      let updatedCombatants = combatants;
      if (isCombatStarted) {
        let rolledAny = false;
        updatedCombatants = combatants.map(u => {
          if ((u.phase || 1) === phaseNum && !u.isPlayer) {
            const hp = { max: u.maxHp || 1, current: u.currentHp || 1 };
            if (u.hpDice && (!u.maxHp || u.maxHp <= 1)) {
              const rolled = tryRollHp(u, `Hit Points (${phaseName(phaseNum)} entry)`);
              if (rolled !== null) {
                hp.max = rolled;
                hp.current = rolled;
              }
            }

            const initVal = u.initiative ?? rollInitiative(u, `Initiative (${phaseName(phaseNum)} entry)`);
            rolledAny = true;
            return { ...u, maxHp: hp.max, currentHp: hp.current, initiative: initVal };
          }
          return u;
        });

        if (rolledAny) {
          updatedCombatants = [...updatedCombatants].sort((a, b) => (b.initiative || 0) - (a.initiative || 0));
          setCombatants(updatedCombatants);
        }
      }

      const nextIdx = resolveTurnIndex(visibleOf(updatedCombatants, nextPhases));
      setAnnouncement(`${phaseName(phaseNum)} activated. ${newlyVisible.length} unit${newlyVisible.length === 1 ? '' : 's'} entered the encounter: ${newlyVisible.map(u => u.name).join(', ')}.`);
      setActivePhases(nextPhases);
      setTurnIndex(nextIdx);
      syncEncounterState(updatedCombatants, isCombatStarted, nextIdx, round, nextPhases);
    }
  };

  const nextTurn = useCallback(() => {
    if (!isCombatStarted || visibleCombatants.length === 0) return;

    // Tick the outgoing unit's timed conditions at the END of its turn;
    // expired ones are removed and reported in the advance announcement.
    const outgoing = visibleCombatants[turnIndex];
    const { unit: tickedOutgoing, expired } = tickConditionsAtEndOfTurn(outgoing);
    const updatedCombatants = combatants.map(u =>
      u.instanceId === tickedOutgoing.instanceId ? { ...u, conditions: tickedOutgoing.conditions } : u
    );
    const updatedVisible = visibleOf(updatedCombatants, activePhases);

    const nextIndex = (turnIndex + 1) % updatedVisible.length;
    const isNewRound = nextIndex === 0;
    const nextRound = isNewRound ? round + 1 : round;

    setCombatants(updatedCombatants);
    setTurnIndex(nextIndex);
    if (isNewRound) {
      setRound(nextRound);
    }

    const current = updatedVisible[nextIndex];
    const following = updatedVisible[(nextIndex + 1) % updatedVisible.length];
    const roundPrefix = isNewRound ? `Round ${nextRound}. ` : '';
    const expiredText = expired.length > 0
      ? `${expired.map(name => `${outgoing.name}'s ${name} has ended.`).join(' ')} `
      : '';
    const currentConditionsText = formatConditions(current.conditions);
    const currentPart = currentConditionsText ? `${current.name}, ${currentConditionsText}` : current.name;
    setAnnouncement(`${expiredText}${roundPrefix}Current turn: ${currentPart}. Next up: ${following.name}.`);

    syncEncounterState(updatedCombatants, true, nextIndex, nextRound, activePhases);
  }, [isCombatStarted, visibleCombatants, combatants, turnIndex, round, activePhases, syncEncounterState, setAnnouncement]);

  // Undoes the most recent manual DM HP change (applyHpMod below), restoring
  // the combatant's currentHp/tempHp from the top of hpUndoStack. Pure
  // push/pop logic lives in src/utils/hpUndoStack.ts; this just applies it
  // to component state and persists/announces the result.
  const undoLastHpChange = useCallback(() => {
    if (hpUndoStack.length === 0) return;
    const { entry, rest } = popUndoEntry(hpUndoStack);
    if (!entry) return;

    // The button disappears entirely once the stack empties (see render
    // below); if that's what had focus, it would otherwise teleport to
    // document.body. Move it to Next Turn instead -- still predictable,
    // and already the next logical control in this toolbar.
    const wasUndoButtonFocused = document.activeElement === undoButtonRef.current;

    const liveUnit = combatants.find(u => u.instanceId === entry.instanceId);
    // If the unit's HP/temp HP no longer match what this entry recorded
    // right after its own change, something else (an approved assistant
    // HITL mutation, an external running-state sync, etc.) touched it in
    // between. Restoring prevHp/prevTempHp now would silently clobber that
    // later change, so discard this entry instead of applying it. A
    // missing unit is treated the same way (can't verify -- discard).
    const stale = !liveUnit || isUndoEntryStale(entry, liveUnit);

    setHpUndoStack(rest);

    if (stale) {
      setAnnouncement(buildStaleUndoAnnouncement(entry, liveUnit));
    } else {
      let restoredMaxHp = 0;
      const next = combatants.map(u => {
        if (u.instanceId === entry.instanceId) {
          restoredMaxHp = u.maxHp || 0;
          return {
            ...u,
            currentHp: entry.prevHp,
            tempHp: entry.prevTempHp,
            conditions: entry.prevConditions !== undefined ? entry.prevConditions : u.conditions,
          };
        }
        return u;
      });

      setCombatants(next);
      syncEncounterState(next, isCombatStarted, turnIndex, round);
      setAnnouncement(buildUndoAnnouncement(entry, entry.prevHp, restoredMaxHp));
    }

    if (rest.length === 0 && wasUndoButtonFocused) {
      setTimeout(() => nextTurnButtonRef.current?.focus(), 0);
    }
  }, [hpUndoStack, combatants, syncEncounterState, isCombatStarted, turnIndex, round, setAnnouncement]);

  useFocusTrap(detailsModalRef, selectedUnitBase !== null);
  useFocusTrap(rollDialogRef, activeRoll !== null);

  const closeDetails = useCallback(() => {
    setSelectedUnit(null);
  }, []);

  const closeOperations = useCallback(() => {
    setActiveOperationsUnit(null);
  }, []);

  const saveConditions = useCallback((instanceId: string, conditions: ActiveCondition[], announcement: string) => {
    const next = combatants.map(u => u.instanceId === instanceId ? { ...u, conditions } : u);
    setCombatants(next);
    syncEncounterState(next, isCombatStarted, turnIndex, round, activePhases);
    setAnnouncement(announcement);
    setActiveOperationsUnit(null);
  }, [combatants, isCombatStarted, turnIndex, round, activePhases, syncEncounterState, setAnnouncement]);

  const closeRollModal = useCallback(() => {
    setActiveRoll(null);
    if (activeOperationsUnit) {
      closeOperations();
    }
  }, [activeOperationsUnit, closeOperations]);

  const openOperations = useCallback((e: React.MouseEvent<HTMLButtonElement> | null, unit: EncounterUnit, mapCell?: Position | null) => {
    if (e) {
      lastFocusedOperationsButtonRef.current = e.currentTarget;
    }
    lastFocusedMapCellRef.current = mapCell || null;
    setActiveOperationsUnit(unit);
  }, []);

  // Global Keyboard Listeners
  //
  // App.tsx and AssistantOracleModal.tsx each register their own `window`
  // keydown listener alongside this one. `e.stopPropagation()` in one window
  // listener does not stop the others, and registration order shifts
  // whenever an effect's deps change, so ordering can never be relied on to
  // keep these listeners from racing/colliding (e.g. Alt+A opening both the
  // Assistant Oracle and this component's old Operations shortcut at once,
  // or Alt+N advancing the turn while the Assistant denies a HITL proposal
  // with the same keystroke). Instead: bail out deterministically whenever
  // (a) some other listener already consumed this keystroke
  // (`e.defaultPrevented`), or (b) an App-level overlay (Assistant Oracle,
  // the Oracle, Shortcuts Help, the dice roller/log) is open on top of this
  // component. (b) is detected structurally rather than via extra state:
  // every such overlay renders an `aria-modal="true"` dialog, and none of
  // them live inside this component's own DOM subtree (`rootRef`), while
  // this component's own dialogs (details/roll/operations) do.
  useEffect(() => {
    const isForeignOverlayOpen = () => {
      const root = rootRef.current;
      if (!root) return false;
      const dialogs = document.querySelectorAll('[aria-modal="true"]');
      for (const node of Array.from(dialogs)) {
        if (!root.contains(node)) return true;
      }
      return false;
    };

    // Any of this component's OWN in-tree dialogs -- as opposed to a foreign
    // overlay (isForeignOverlayOpen above), these live inside rootRef, so
    // isForeignOverlayOpen alone doesn't catch them. Alt+N and Alt+U must do
    // nothing while any of these is open (pressing Next Turn or Undo from
    // inside e.g. the Options dialog should not silently act on the
    // encounter underneath it).
    const isOwnDialogOpen = () =>
      Boolean(activeRoll || activeOperationsUnit || selectedUnit);

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented || isForeignOverlayOpen()) return;

      // Escape
      if (e.key === 'Escape') {
        if (activeRoll) {
          e.preventDefault();
          closeRollModal();
        } else if (activeOperationsUnit) {
          e.preventDefault();
          closeOperations();
        } else if (selectedUnit) {
          e.preventDefault();
          closeDetails();
        }
      }

      // Alt + N for Next Turn. Suppressed while any of this runner's own
      // dialogs (Options, Details, Roll) is open, so it can't silently advance the turn underneath them.
      if (e.altKey && e.key.toLowerCase() === 'n' && !isOwnDialogOpen()) {
        e.preventDefault();
        nextTurn();
      }

      // Alt + U to undo the last manual HP change. No-op (and no
      // preventDefault, so it doesn't swallow the keystroke) when there is
      // nothing to undo, matching the button being absent in that state, or
      // while any of this runner's own dialogs is open.
      if (e.altKey && e.key.toLowerCase() === 'u' && hpUndoStack.length > 0 && !isOwnDialogOpen()) {
        e.preventDefault();
        undoLastHpChange();
      }

      // Note: Alt+A and Alt+D are intentionally NOT handled here. Alt+A is the
      // documented global Assistant Oracle shortcut (App.tsx); a per-combatant
      // Operations shortcut used to collide with it, but map cells already have
      // a plain 'a' for operations (CombatMap.tsx), so it was removed rather than
      // rebound. Alt+D is the documented global Dice Log shortcut (App.tsx); the
      // "Dice Log (Alt+D)" button below triggers that same global shortcut
      // instead of maintaining a second, competing dice log instance here.

      // Prevent default behavior for Enter/Space on non-interactive focused elements (like the heading)
      // to avoid potential page scroll/teleport issues. Never block summary/links/buttons.
      if ((e.key === 'Enter' || e.key === ' ') && !isInteractiveTarget(e.target)) {
        e.preventDefault();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [nextTurn, selectedUnit, activeRoll, activeOperationsUnit, closeDetails, closeRollModal, closeOperations, hpUndoStack, undoLastHpChange]);

  // Triggers the same global Alt+D shortcut App.tsx's own window keydown listener
  // handles, instead of maintaining a second local dice log here. Dispatching a
  // synthetic event (rather than duplicating App's open/close state) guarantees
  // there is only ever one Dice Log dialog in the DOM at a time.
  const openGlobalDiceLog = useCallback(() => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'd', altKey: true, bubbles: true, cancelable: true }));
  }, []);

  // Focus management for details modal and operations modal
  useEffect(() => {
    if (selectedUnit) {
      detailHeadingRef.current?.focus();
    } else if (activeOperationsUnit) {
      // These modals handle their own internal focus on mount.
    } else if (activeRoll) {
      // Roll modal focus is handled by its own effect.
      // We explicitly skip focus restoration here to avoid snatching focus away from the roll result.
    } else {
      if (lastFocusedMapCellRef.current) {
        const cell = lastFocusedMapCellRef.current;
        lastFocusedMapCellRef.current = null;
        lastActiveRollButtonRef.current = null;
        lastFocusedUnitId.current = null;
        lastFocusedOperationsButtonRef.current = null;
        setTimeout(() => {
          const cellEl = document.querySelector<HTMLTableCellElement>(
            `[data-cell="${cell.x}-${cell.y}"]`
          );
          cellEl?.focus();
        }, 50);
      } else if (lastFocusedUnitId.current) {
        unitRefs.current[lastFocusedUnitId.current]?.focus();
        lastFocusedUnitId.current = null;
      } else if (lastFocusedOperationsButtonRef.current) {
        lastFocusedOperationsButtonRef.current.focus();
        lastFocusedOperationsButtonRef.current = null;
      }
    }
  }, [selectedUnit, activeOperationsUnit, activeRoll]);

  const updateInitiative = (instanceId: string, val: string) => {
    const num = val === '' ? undefined : (parseInt(val, 10) || 0);
    const next = combatants.map(u => u.instanceId === instanceId ? { ...u, initiative: num } : u);
    setCombatants(next);
    syncEncounterState(next, false, 0, 1, activePhases);
  };

  const startCombat = () => {
    const rolledCombatants = combatants.map(u => {
      const hp = { max: u.maxHp || 1, current: u.currentHp || 1 };
      
      if (!u.isPlayer) {
        const rolled = tryRollHp(u, 'Hit Points (Initial Roll)');
        if (rolled !== null) {
          hp.max = rolled;
          hp.current = rolled;
        }
      }

      let initVal = u.initiative;
      if (initVal === undefined) {
        initVal = u.isPlayer ? 0 : rollInitiative(u, 'Initiative (Initial Roll)');
      }

      return {
        ...u,
        maxHp: hp.max,
        currentHp: hp.current,
        initiative: initVal
      };
    });

    const sorted = [...rolledCombatants].sort((a, b) => (b.initiative || 0) - (a.initiative || 0));
    setCombatants(sorted);
    setIsCombatStarted(true);
    setTurnIndex(0);
    setRound(1);
    syncEncounterState(sorted, true, 0, 1, activePhases);
    const firstVisible = sorted.filter(u => activePhases.includes(u.phase || 1))[0] || sorted[0];
    setAnnouncement(`Combat started. Round 1. First up is ${firstVisible.name}.`);
  };

  const openUnitDetails = (unit: EncounterUnit, mapCell?: Position | null) => {
    lastFocusedUnitId.current = unit.instanceId;
    lastFocusedMapCellRef.current = mapCell || null;
    setSelectedUnit(unit);
  };

  const handleUpdateUnitPosition = useCallback((instanceId: string, newPos: Position) => {
    const next = combatants.map(u => u.instanceId === instanceId ? { ...u, position: newPos } : u);
    setCombatants(next);
    syncEncounterState(next);
  }, [combatants, syncEncounterState]);

  // Pick up server-side mutations made outside this component (e.g. an
  // approved Assistant Oracle HITL proposal, which refetches the campaign
  // from the server rather than dispatching client-side events). When the
  // active encounter's running_state in the shared campaign context carries
  // an `updatedAt` this component never itself produced (see
  // syncedUpdatedAtsRef above), the change came from elsewhere, so reload
  // the encounter's local view from that authoritative server state. This is
  // the only mechanism for absorbing external updates; the server is always
  // the source of truth.
  useEffect(() => {
    if (!activeEncounter) return;
    const freshEncounter = activeCampaign?.encounters.find(e => e.id === activeEncounter.id);
    const freshUpdatedAt = freshEncounter?.runningState?.updatedAt;
    const localUpdatedAt = activeEncounter.runningState?.updatedAt;
    if (
      freshEncounter &&
      freshUpdatedAt &&
      !syncedUpdatedAtsRef.current.has(freshUpdatedAt) &&
      freshUpdatedAt !== localUpdatedAt
    ) {
      recordSyncedUpdatedAt(freshUpdatedAt);
      loadEncounter(freshEncounter, false);
    }
  }, [activeCampaign, activeEncounter, loadEncounter, recordSyncedUpdatedAt]);

  const applyHpMod = (instanceId: string, isDamage: boolean, amount?: number, damageType?: string) => {
    const val = amount !== undefined ? amount : parseInt(hpMods[instanceId] || '0', 10);
    if (isNaN(val) || val <= 0) return;

    // "untyped" (the DisclosureSelect default) and healing (which has no
    // damage type at all) both resolve to no type, so resistance/immunity/
    // vulnerability lookups in projectHpApplication are skipped for them.
    const normDamageType = isDamage && damageType && damageType !== UNTYPED_DAMAGE ? damageType : undefined;

    let announcementMsg = '';
    let pendingUndo: HpUndoEntry | null = null;

    const next = combatants.map(u => {
      if (u.instanceId === instanceId) {
        if (u.isPlayer) return u;

        const prevHp = u.currentHp || 0;
        const prevTempHp = u.tempHp || 0;

        const projection = projectHpApplication(u, isDamage ? 'damage' : 'healing', val, normDamageType);
        const newHp = projection.projectedHp;
        const newTempHp = projection.projectedTempHp;

        const isImmune = isDamage && normDamageType ? hasDamageImmunity(u, normDamageType) : false;
        const isResistant = isDamage && normDamageType && !isImmune ? hasDamageResistance(u, normDamageType) : false;
        const isVulnerable = isDamage && normDamageType && !isImmune ? hasDamageVulnerability(u, normDamageType) : false;

        announcementMsg = buildHpChangeAnnouncement({
          name: u.name,
          actionType: isDamage ? 'damage' : 'healing',
          amount: val,
          damageType: normDamageType,
          isImmune,
          isResistant,
          isVulnerable,
          prevHp,
          newHp,
          maxHp: u.maxHp || 0,
          newTempHp,
        });

        // Concentration check: only for damage (healing never triggers
        // one), only while Concentrating, and only when damage was
        // actually taken -- after resistance/vulnerability/immunity,
        // counting damage absorbed by temp HP, and never for immune (0
        // taken). The result is appended to the SAME announcement rather
        // than firing a second, competing one.
        const prevConditionsList = normalizeConditions(u.conditions);
        let nextConditionsList = prevConditionsList;
        if (isDamage) {
          const isConcentrating = prevConditionsList.some(c => c.name.toLowerCase() === 'concentrating');
          const damageTaken = (prevHp - newHp) + (prevTempHp - newTempHp);
          if (isConcentrating && needsConcentrationCheck(damageTaken)) {
            if (newHp <= 0) {
              // A creature at 0 HP is unconscious and automatically loses
              // concentration -- no roll.
              nextConditionsList = removeCondition(prevConditionsList, 'Concentrating');
              announcementMsg = `${announcementMsg} ${buildConcentrationDownAnnouncement()}`;
            } else {
              const dc = getConcentrationDC(damageTaken);
              const conMod = u.fullData ? getSaveModifier(u.fullData, 'CON') : 0;
              const formula = `1d20${conMod >= 0 ? '+' : ''}${conMod}`;
              const result = DiceService.roll(formula);
              const base = result.rolls[0];
              const maintained = result.total >= dc;
              diceLogService.logRoll({
                source: u.name,
                purpose: 'Concentration Save',
                formula,
                rolls: result.rolls,
                modifier: conMod,
                total: result.total,
                critStatus: base === 20 ? 'crit' : base === 1 ? 'fumble' : 'normal',
              });
              if (!maintained) {
                nextConditionsList = removeCondition(prevConditionsList, 'Concentrating');
              }
              announcementMsg = `${announcementMsg} ${buildConcentrationSaveAnnouncement(u.name, result.total, dc, maintained)}`;
            }
          }
        }
        const conditionsChanged = nextConditionsList !== prevConditionsList;

        if (newHp !== prevHp || newTempHp !== prevTempHp || conditionsChanged) {
          pendingUndo = {
            instanceId,
            unitName: u.name,
            prevHp,
            prevTempHp,
            postHp: newHp,
            postTempHp: newTempHp,
            prevConditions: conditionsChanged ? prevConditionsList : undefined,
            postConditions: conditionsChanged ? nextConditionsList : undefined,
            description: buildUndoDescription(val, isDamage ? 'damage' : 'healing', normDamageType, u.name),
          };
        }

        return conditionsChanged
          ? { ...u, currentHp: newHp, tempHp: newTempHp, conditions: nextConditionsList }
          : { ...u, currentHp: newHp, tempHp: newTempHp };
      }
      return u;
    });

    if (announcementMsg) {
      setAnnouncement(announcementMsg);
    }

    if (pendingUndo) {
      setHpUndoStack(prev => pushUndoEntry(prev, pendingUndo as HpUndoEntry));
    }

    setCombatants(next);
    syncEncounterState(next, isCombatStarted, turnIndex, round);

    if (amount === undefined) {
      setHpMods(prev => ({ ...prev, [instanceId]: '' }));
    }
  };

  const handleInlineRoll = (e: React.MouseEvent<HTMLElement> | null, unitName: string, title: string, hit: string, damage?: string) => {
    if (e) {
      lastActiveRollButtonRef.current = e.currentTarget as HTMLElement;
    } else {
      lastActiveRollButtonRef.current = document.activeElement as HTMLElement;
    }
    
    // Announce to screen reader using the robust string format
    const hitVal = hit.split(',')[0];
    const damageAnnounce = damage ? `. Damage: ${damage.split(' ')[0]} ${damage.split(' ')[1] || ''}` : '';
    setAnnouncement(`${unitName} rolled ${title}: ${hitVal}${damageAnnounce}`);

    setActiveRoll({
      title,
      hit,
      damage,
      unitName
    });
  };

  if (!activeEncounter) {
    const campaignEncounters = activeCampaign?.encounters || [];
    return (
      <section ref={rootRef}>
        <h2 ref={runnerHeadingRef} tabIndex={-1} style={{ outline: 'none' }}>Load Encounter</h2>
        {!activeCampaign ? <p>Please select a campaign in Create Mode.</p> :
         campaignEncounters.length === 0 ? <p>No saved encounters found. Go to Create Mode to build one.</p> : (
          <ul style={{ listStyle: 'none', padding: 0 }}>
            {campaignEncounters.map(e => (
              <li key={e.id}>
                <button type="button" onClick={() => loadEncounter(e)}>Load "{e.name}"</button>
              </li>
            ))}
          </ul>
        )}
      </section>
    );
  }

  return (
    <div className="encounter-runner" ref={rootRef}>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', flexWrap: 'wrap', gap: '0.5rem' }}>
        <div>
          <h2 ref={runnerHeadingRef} tabIndex={-1} style={{ outline: 'none', margin: 0 }}>Running: {activeEncounter.name}</h2>
          {isCombatStarted && (
            <p style={{ margin: '0.25rem 0 0 0', fontWeight: 'bold' }} aria-label={`Round ${round}`}>Round {round}</p>
          )}
        </div>
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
          <button
            type="button"
            onClick={openGlobalDiceLog}
            aria-label="Open Dice Roller and Log (Alt+D)"
            style={{ fontWeight: 'bold' }}
          >
            Dice Log (Alt+D)
          </button>
          {(isCombatStarted || combatants.some(c => c.initiative !== undefined)) && (
            <button type="button" onClick={handleResetCombat}>Reset Encounter</button>
          )}
          <button type="button" onClick={handleClose}>Close Encounter Tab</button>
        </div>
      </header>

      <div aria-live="assertive" aria-atomic="true" className="sr-only">
        {announcement}
      </div>

      {/* Encounter Phases Toolbar */}
      <section 
        aria-label="Encounter Phases" 
        style={{ 
          display: 'flex', 
          alignItems: 'center', 
          gap: '0.75rem', 
          padding: '0.6rem 1rem', 
          backgroundColor: '#f5f5f5', 
          border: '1px solid #ccc',
          borderRadius: '6px', 
          marginBottom: '1rem',
          flexWrap: 'wrap'
        }}
      >
        <span style={{ fontWeight: 'bold' }}>Encounter Phases:</span>
        {availablePhases.map(phaseNum => {
          const isActive = activePhases.includes(phaseNum);
          const count = combatants.filter(u => (u.phase || 1) === phaseNum).length;
          return (
            <button
              key={phaseNum}
              type="button"
              role="switch"
              aria-checked={isActive}
              onClick={() => togglePhase(phaseNum)}
              style={{
                padding: '0.4rem 0.8rem',
                fontSize: '0.9rem',
                borderRadius: '4px',
                border: isActive ? '2px solid #2e7d32' : '2px solid #888',
                backgroundColor: isActive ? '#e8f5e9' : '#fafafa',
                color: isActive ? '#1b5e20' : '#555',
                cursor: 'pointer',
                fontWeight: isActive ? 'bold' : 'normal',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.4rem'
              }}
              aria-label={`${phaseName(phaseNum)}: ${count} unit${count === 1 ? '' : 's'}. ${isActive ? 'Active (Click to hide)' : 'Hidden (Click to activate)'}`}
            >
              <span>{phaseName(phaseNum)} ({count})</span>
              <span style={{ fontSize: '0.8rem', fontWeight: 'bold' }}>
                {isActive ? '✓ Visible' : '✗ Hidden'}
              </span>
            </button>
          );
        })}
      </section>

      {!isCombatStarted ? (
        <section>
          <h3>Initiative Setup</h3>
          <p>Enter player initiatives and click Start. Monsters will auto-roll health and initiative.</p>
          <ul style={{ listStyle: 'none', padding: 0 }}>
            {visibleCombatants.map(u => (
              <li key={u.instanceId} style={{ marginBottom: '0.5rem' }}>
                <label htmlFor={`init-${u.instanceId}`} style={{ marginRight: '1rem' }}>{u.name}:</label>
                <input 
                  id={`init-${u.instanceId}`}
                  type="number" 
                  value={u.initiative ?? ''} 
                  onChange={(e) => updateInitiative(u.instanceId, e.target.value)}
                  placeholder={u.isPlayer ? "Required" : "Auto"}
                />
              </li>
            ))}
          </ul>
          <button type="button" onClick={startCombat} style={{ marginTop: '1rem' }}>Start Combat</button>
        </section>
      ) : (
        <section>
          <h3>Initiative Track</h3>
          <p>Use <strong>Tab</strong> to navigate. <strong>Enter</strong> on a combatant for options (damage, healing, actions, conditions, details). <strong>Alt + N</strong> for next turn.</p>
          <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem', flexWrap: 'wrap' }}>
            <button type="button" ref={nextTurnButtonRef} onClick={nextTurn}>Next Turn (Alt+N)</button>
            {hpUndoStack.length > 0 && (
              <button
                type="button"
                ref={undoButtonRef}
                onClick={undoLastHpChange}
                aria-keyshortcuts="Alt+U"
              >
                {describeUndoAction(hpUndoStack[hpUndoStack.length - 1])} (Alt+U)
              </button>
            )}
          </div>

          <ul style={{ listStyle: 'none', padding: 0 }} role="list">
            {visibleCombatants.map((u, i) => (
              <li key={u.instanceId} style={{ marginBottom: '1rem', border: i === turnIndex ? '3px solid #000' : '1px solid #eee', padding: '0.5rem', backgroundColor: i === turnIndex ? '#f0f8ff' : 'white' }}>
                <button
                  type="button"
                  ref={(el) => { unitRefs.current[u.instanceId] = el; }}
                  onClick={(e) => openOperations(e, u)}
                  style={{ display: 'block', width: '100%', textAlign: 'left', background: 'transparent', border: 'none', padding: '0.5rem', fontSize: '1.1rem', fontWeight: 'bold' }}
                  aria-current={i === turnIndex ? 'step' : undefined}
                >
                  <span className="sr-only">{i === turnIndex ? "Current Turn" : ""}</span>
                  {u.initiative} - {u.name} {u.isPlayer ? '(Player)' : `(${formatTrackerHp(u.currentHp, u.maxHp)})`}
                  {formatConditions(u.conditions) ? `, ${formatConditions(u.conditions)}` : ''}
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {activeEncounter && isCombatStarted && (
        <CombatMap
          units={visibleCombatants}
          mapSize={activeEncounter.mapSize || DEFAULT_MAP_SIZE}
          activeTurnUnitId={isCombatStarted && visibleCombatants[turnIndex] ? visibleCombatants[turnIndex].instanceId : undefined}
          onUpdateUnitPosition={handleUpdateUnitPosition}
          onOpenOperations={(unit, cell) => openOperations(null, unit, cell)}
          onOpenDetails={(unit, cell) => openUnitDetails(unit, cell)}
          externalRadarUnit={radarRequestedUnit}
          onResetExternalRadarUnit={() => setRadarRequestedUnit(null)}
          dmMapUrl={activeEncounter.dmMapUrl}
          playerMapUrl={activeEncounter.playerMapUrl}
          mapName={activeEncounter.name}
          isExternalModalOpen={Boolean(activeOperationsUnit || selectedUnit || activeRoll)}
        />
      )}

      {activeOperationsUnit && (
        <MonsterOperationsModal 
          unit={activeOperationsUnit}
          onClose={closeOperations}
          onApplyHpMod={applyHpMod}
          onRoll={(title, hit, damage) => handleInlineRoll(null, activeOperationsUnit.name, title, hit, damage)}
          onAnnounce={setAnnouncement}
          onOpenRadar={(unit) => setRadarRequestedUnit(unit)}
          isCurrentActor={isCombatStarted && visibleCombatants[turnIndex]?.instanceId === activeOperationsUnit.instanceId}
          onSaveConditions={saveConditions}
          onOpenDetails={(unit) => {
            // Swap Options for Details; closing Details restores focus to the
            // originating row via lastFocusedUnitId (or the map cell).
            setActiveOperationsUnit(null);
            openUnitDetails(unit, lastFocusedMapCellRef.current);
          }}
        />
      )}

      {selectedUnit && (
        <div ref={detailsModalRef} className="unit-details-modal" role="dialog" aria-modal="true" aria-labelledby="unit-detail-title" style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, 
          backgroundColor: 'rgba(0,0,0,0.5)', display: 'flex', 
          alignItems: 'center', justifyContent: 'center', zIndex: 1001
        }}>
          <div style={{ backgroundColor: 'white', padding: '2rem', borderRadius: '8px', maxWidth: '600px', width: '90%', maxHeight: '90vh', overflowY: 'auto' }}>
            <h3 id="unit-detail-title" ref={detailHeadingRef} tabIndex={-1} style={{ outline: 'none' }}>
              {selectedUnit.name} Details
            </h3>
            
            {selectedUnit.isPlayer ? (
              <section aria-labelledby="unit-detail-title">
                <p><strong>Initiative:</strong> {selectedUnit.initiative}</p>
                <p><strong>Passive Perception:</strong> {selectedUnit.passivePerception}</p>
              </section>
            ) : selectedUnit.fullData ? (
              <MonsterDetails 
                monster={selectedUnit.fullData} 
                currentHp={selectedUnit.currentHp} 
                maxHp={selectedUnit.maxHp} 
                initiative={selectedUnit.initiative} 
                onAnnounce={setAnnouncement}
              />
            ) : null}

            <button type="button" onClick={closeDetails} style={{ marginTop: '1.5rem', width: '100%', padding: '0.5rem' }}>
              Close Details (Esc)
            </button>
          </div>
        </div>
      )}

      {activeRoll && (
        <div ref={rollDialogRef} role="dialog" aria-modal="true" aria-labelledby="encounter-roll-result-title" style={{
          position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
          backgroundColor: '#333', color: 'white', padding: '1.5rem', borderRadius: '8px',
          boxShadow: '0 4px 6px rgba(0,0,0,0.3)', zIndex: 1002, minWidth: '250px', textAlign: 'center'
        }}>
          <h4 id="encounter-roll-result-title" ref={rollModalRef} tabIndex={-1} style={{ outline: 'none', margin: '0 0 1rem 0' }}>
            {activeRoll.unitName} - {activeRoll.title}
          </h4>
          
          <p style={{ fontSize: '1.2rem', marginBottom: '1rem' }}>
            <strong>Result:</strong> {activeRoll.hit}
          </p>

          {activeRoll.damage && (
            <p style={{ fontSize: '1.2rem', marginBottom: '1rem' }}>
              <strong>Damage:</strong> {activeRoll.damage}
            </p>
          )}

          <button type="button" onClick={closeRollModal} style={{ padding: '0.5rem 1rem', fontSize: '1rem', backgroundColor: '#fff', color: '#333', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>
            Close (Esc)
          </button>
        </div>
      )}
    </div>
  );
}
