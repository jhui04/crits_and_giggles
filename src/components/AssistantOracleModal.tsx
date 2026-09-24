import React, { useState, useEffect, useRef, useCallback } from 'react';
import { AssistantMarkdown } from './AssistantMarkdown';
import { SpellDetail } from './SpellBrowser';
import { MonsterDetails } from './MonsterDetails';
import { MagicItemDetail } from './MagicItemBrowser';
import { dataService } from '../services/DataService';
import type { Spell, Monster, MagicItem, ConfirmationProposal } from '../types';
import { HitlConfirmationBox } from './hitl/HitlConfirmationBox';
import { useCampaigns } from '../context/CampaignContext';
import { useAnnouncer } from './uiHelpers';

export interface PassageItem {
  id?: string;
  source?: string;
  entityId?: string;
  title: string;
  content: string;
  metadata?: Record<string, unknown>;
}

export interface MapToolResult {
  success?: boolean;
  encounterId?: string;
  encounterName?: string;
  mapName?: string;
  mapUrl?: string;
  version?: string;
  grid?: {
    columns: number;
    rows: number;
    cellPitch?: number;
  };
  combatantsCount?: number;
  unplacedCombatantsCount?: number;
  totalCombatantsInEncounter?: number;
  combatants?: Array<{
    name: string;
    instanceId?: string;
    team: string;
    coordinates?: { x: number; y: number };
    cell: string;
    hp?: string;
    conditions?: string[];
  }>;
  image?: string;
  imageAttached?: boolean;
  mimeType?: string;
  error?: string;
  hint?: string;
}

export interface Message {
  id: string;
  sender: 'user' | 'oracle';
  text: string;
  thinking?: string | null;
  passages?: PassageItem[];
  toolCalls?: Array<{ toolName: string; args: unknown; result?: unknown }>;
  modelUsed?: string;
  timestamp: string;
}

export interface AssistantOracleModalProps {
  isOpen: boolean;
  onClose: () => void;
  campaignId?: string | null;
  encounterId?: string | null;
  chapterId?: string | null;
  chapterName?: string | null;
  worldId?: string | null;
  worldName?: string | null;
  initialFocusOnInput?: boolean;
}

function formatTimestamp(date: Date = new Date()): string {
  const hours = date.getHours();
  const minutes = date.getMinutes().toString().padStart(2, '0');
  return `${hours}:${minutes}`;
}

function getModelDisplayName(model: string): string {
  if (model === 'qwen3.5:9b') return 'Qwen3.5-9B';
  if (model === 'qwen3.5:4b') return 'Qwen3.5-4B';
  if (model === 'llama3' || model === 'llama3:8b' || model === 'llama3:latest') return 'Llama 3 (8B)';
  return model;
}

type EntityPayload =
  | { type: 'spell'; data: Spell }
  | { type: 'monster'; data: Monster }
  | { type: 'item'; data: MagicItem }
  | { type: 'lore'; data: PassageItem };

const STORAGE_KEY_MODEL = 'crits_assistant_model';

export function AssistantOracleModal({
  isOpen,
  onClose,
  campaignId = null,
  encounterId = null,
  chapterId = null,
  chapterName = null,
  worldId = null,
  worldName = null,
  initialFocusOnInput = false,
}: AssistantOracleModalProps) {
  const { refreshCampaign } = useCampaigns();
  const [messages, setMessages] = useState<Message[]>([
    {
      id: 'welcome',
      sender: 'oracle',
      text: '**Greetings, Dungeon Master.** I am your Assistant Oracle, grounded in official **SRD 5.2.1** rules and your active campaign state. Ask any rules question or check live combat HP and initiative.',
      timestamp: formatTimestamp(),
    },
  ]);
  const [inputQuery, setInputQuery] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [activeModel, setActiveModel] = useState<string>(() => {
    if (typeof localStorage !== 'undefined') {
      try {
        const saved = localStorage.getItem(STORAGE_KEY_MODEL);
        if (saved) return saved;
      } catch {
        // Ignored
      }
    }
    return 'qwen3.5:9b';
  });

  // Human-in-the-Loop (HITL) proposal queue. Multiple write-tool calls in
  // one turn (or across turns) can each stage their own proposal; the DM
  // reviews them one at a time, oldest first, via the front of this queue.
  const [proposalQueue, setProposalQueue] = useState<ConfirmationProposal[]>([]);
  const pendingProposal = proposalQueue[0] ?? null;
  const [isConfirming, setIsConfirming] = useState(false);
  const [hitlAnnouncement, setHitlAnnouncement] = useAnnouncer();

  // Copy-to-clipboard state for chat history messages
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null);
  const [copyAnnouncement, setCopyAnnouncement] = useAnnouncer();
  const copyResetTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Knowledge passage modal state
  const [selectedPassage, setSelectedPassage] = useState<PassageItem | null>(null);
  const [passageEntityData, setPassageEntityData] = useState<EntityPayload | null>(null);
  const [isLoadingPassage, setIsLoadingPassage] = useState(false);
  const lastPassageButtonRef = useRef<HTMLElement | null>(null);
  const passageModalRef = useRef<HTMLDivElement>(null);
  const passageHeadingRef = useRef<HTMLHeadingElement>(null);

  const modalRef = useRef<HTMLDivElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const logEndRef = useRef<HTMLDivElement>(null);

  // Fetch active model config on mount or sync persisted model choice
  useEffect(() => {
    if (isOpen) {
      let savedModel: string | null = null;
      if (typeof localStorage !== 'undefined') {
        try {
          savedModel = localStorage.getItem(STORAGE_KEY_MODEL);
        } catch {
          // Ignored
        }
      }

      if (savedModel) {
        // activeModel's useState initializer already read this same value
        // from localStorage, so no setState is needed here — just push the
        // persisted choice to the server so its config matches.
        fetch('/api/assistant/config', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ activeModel: savedModel }),
        }).catch(() => {});
      } else {
        fetch('/api/assistant/config')
          .then((res) => res.json())
          .then((data) => {
            if (data.activeModel) {
              setActiveModel(data.activeModel);
              if (typeof localStorage !== 'undefined') {
                try {
                  localStorage.setItem(STORAGE_KEY_MODEL, data.activeModel);
                } catch {
                  // Ignored
                }
              }
            }
          })
          .catch(() => {});
      }
    }
  }, [isOpen]);

  // Recover the pending proposal queue on reopen, then decide where focus
  // goes. Escape closes the modal without denying anything (see N-7), so if
  // the DM dismissed the modal with Escape — or reloaded the page entirely —
  // any pending proposals are still live server-side; re-fetch them here
  // rather than leaving them silently orphaned with no way back to them.
  //
  // Recovery and initial focus are done as one sequential flow (rather than
  // two independent effects racing each other) so the outcome is
  // deterministic: if a proposal is recovered, its own HitlConfirmationBox
  // claims focus on mount (see accessibility standard in
  // docs/HITL_WRITE_TOOLS.md §5 — a proposal's arrival claims focus); only
  // once we know there's nothing to recover does this effect focus the chat
  // input/heading itself. `syncedForThisOpenRef` guards against re-running
  // when `setProposalQueue` below (or a later resolve/deny) changes
  // `proposalQueue` — this should run once per modal open, not on every
  // queue change.
  const syncedForThisOpenRef = useRef(false);
  // Read queue / focus preference through refs so changes to them mid-fetch
  // don't tear down the effect (its cleanup would cancel the in-flight
  // recovery fetch and the run-once guard would then never retry).
  const proposalQueueRef = useRef(proposalQueue);
  const initialFocusOnInputRef = useRef(initialFocusOnInput);
  useEffect(() => {
    proposalQueueRef.current = proposalQueue;
    initialFocusOnInputRef.current = initialFocusOnInput;
  }, [proposalQueue, initialFocusOnInput]);
  useEffect(() => {
    if (!isOpen) {
      syncedForThisOpenRef.current = false;
      return;
    }
    if (syncedForThisOpenRef.current) return;
    syncedForThisOpenRef.current = true;

    let cancelled = false;
    const focusDefault = () => {
      setTimeout(() => {
        if (cancelled) return;
        if (initialFocusOnInputRef.current && inputRef.current) {
          inputRef.current.focus();
        } else if (headingRef.current) {
          headingRef.current.focus();
        }
      }, 30);
    };

    if (proposalQueueRef.current.length > 0 || !campaignId) {
      focusDefault();
      return () => {
        cancelled = true;
      };
    }

    fetch(`/api/assistant/proposals/pending?campaignId=${encodeURIComponent(campaignId)}`)
      .then((res) => (res.ok ? res.json() : []))
      .then((proposals: ConfirmationProposal[]) => {
        if (cancelled) return;
        if (!Array.isArray(proposals) || proposals.length === 0) {
          focusDefault();
          return;
        }
        setProposalQueue(proposals);
        const restored = proposals[0];
        const queueNote = proposals.length > 1 ? ` (${proposals.length} actions pending in total.)` : '';
        setHitlAnnouncement(
          `Restored a pending action proposal from before this window was closed: ${restored.description}. Press Alt+Y to approve, Alt+N to deny.${queueNote}`
        );
      })
      .catch(() => {
        if (!cancelled) focusDefault();
      });
    return () => {
      cancelled = true;
    };
  }, [isOpen, campaignId, setHitlAnnouncement]);

  // Auto-scroll conversation log
  useEffect(() => {
    if (isOpen && logEndRef.current) {
      logEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, isOpen]);

  // Focus management for knowledge passage modal
  useEffect(() => {
    if (selectedPassage) {
      setTimeout(() => {
        passageHeadingRef.current?.focus();
      }, 40);
    }
  }, [selectedPassage]);

  // Human-in-the-Loop (HITL) proposal resolution handlers.
  //
  // The server is the single source of truth for the mutation. On success we
  // simply refetch the campaign from the server and replace local state;
  // we never derive the new state from the staged proposal payload
  // ourselves. This guarantees a rejected/expired/failed confirmation can
  // never leave a client-side trace (see G-1), and avoids the client and
  // server independently computing (and disagreeing on) the same mutation
  // (see G-2, G-6).
  const confirmInFlightRef = useRef(false);
  // Set when an approve/deny empties the queue; the effect below moves focus to the chat input
  // once React has committed the box's removal. A fixed timer raced with slow renders (e.g. the
  // campaign refresh re-rendering the map), leaving focus on <body>.
  const reclaimInputFocusRef = useRef(false);
  useEffect(() => {
    if (reclaimInputFocusRef.current && !isConfirming && proposalQueue.length === 0) {
      reclaimInputFocusRef.current = false;
      inputRef.current?.focus();
    }
  }, [isConfirming, proposalQueue.length]);
  const handleProposalApprove = useCallback(async (proposalId: string) => {
    if (confirmInFlightRef.current) return;
    confirmInFlightRef.current = true;
    setIsConfirming(true);
    // Only the chat input should reclaim focus once the queue is empty. If
    // another proposal is still pending, HitlConfirmationBox's own
    // proposal.proposalId effect focuses ITS heading as the next proposal
    // renders (see docs/HITL_WRITE_TOOLS.md §5) — the unconditional focus
    // timeout below used to always win that race and yank focus back to
    // the input out from under the next queued proposal.
    let queueEmptiedByThis = false;
    try {
      const res = await fetch('/api/assistant/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ proposalId, action: 'approve' }),
      });
      const result = await res.json().catch(() => ({}));

      if (!res.ok) {
        const errorMsg = result?.error || `Confirmation failed (HTTP ${res.status}).`;
        setHitlAnnouncement(`Error approving action: ${errorMsg}`);
        setMessages((prev) => [
          ...prev,
          {
            id: `confirm-error-${Date.now()}`,
            sender: 'oracle',
            text: `⚠️ **Could not apply action**: ${errorMsg}. Game state was NOT changed.`,
            timestamp: formatTimestamp(),
          },
        ]);
        // A failed/stale/already-resolved confirmation means the server did
        // not accept this decision; the DM must be shown the proposal again
        // if they still want to act on it, so it's simplest to just drop it
        // from the queue rather than let it sit in a now-inconsistent local
        // state. The rest of the queue (if any) is untouched and the next
        // proposal is shown immediately.
        queueEmptiedByThis = proposalQueue.length - 1 <= 0;
        setProposalQueue((prev) => prev.filter((p) => p.proposalId !== proposalId));
        return;
      }

      const remaining = proposalQueue.length - 1;
      queueEmptiedByThis = remaining <= 0;
      const summary = result.executionSummary || 'Action approved and applied.';
      setHitlAnnouncement(
        `Action approved: ${summary}. Game state updated successfully.${remaining > 0 ? ` ${remaining} more action${remaining > 1 ? 's' : ''} pending.` : ''}`
      );

      // Prefer this modal's own campaignId prop, but fall back to the
      // campaign the proposal was actually staged against (now included in
      // the proposal's context). The two only diverge when the Oracle was
      // opened with no active campaign in context and the server resolved
      // the write tool via its global fallback — a narrow case, but one
      // where skipping the refetch entirely would leave CampaignProvider's
      // copy of that campaign stale with no other trigger to correct it
      // (see N-9).
      const targetCampaignId = campaignId || pendingProposal?.context?.campaignId;
      if (targetCampaignId) {
        await refreshCampaign(targetCampaignId);
      }

      setMessages((prev) => [
        ...prev,
        {
          id: `confirm-approve-${Date.now()}`,
          sender: 'oracle',
          text: `✅ **Action Approved & Applied**: ${summary}`,
          timestamp: formatTimestamp(),
        },
      ]);

      setProposalQueue((prev) => prev.filter((p) => p.proposalId !== proposalId));
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      setHitlAnnouncement(`Error executing action: ${errorMsg}`);
      setMessages((prev) => [
        ...prev,
        {
          id: `confirm-error-${Date.now()}`,
          sender: 'oracle',
          text: `⚠️ **Error applying action**: ${errorMsg}`,
          timestamp: formatTimestamp(),
        },
      ]);
    } finally {
      confirmInFlightRef.current = false;
      setIsConfirming(false);
      if (queueEmptiedByThis) reclaimInputFocusRef.current = true;
    }
  }, [campaignId, pendingProposal, proposalQueue.length, refreshCampaign, setHitlAnnouncement]);

  const handleProposalDeny = useCallback(async (proposalId: string) => {
    if (confirmInFlightRef.current) return;
    confirmInFlightRef.current = true;
    setIsConfirming(true);
    // See handleProposalApprove: only reclaim input focus once the queue is
    // actually empty, so the next queued proposal's own heading-focus
    // effect isn't overridden.
    let queueEmptiedByThis = false;
    try {
      const res = await fetch('/api/assistant/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ proposalId, action: 'deny' }),
      });
      const result = await res.json().catch(() => ({}));

      if (!res.ok) {
        const errorMsg = result?.error || `Cancellation failed (HTTP ${res.status}).`;
        setHitlAnnouncement(`Error denying action: ${errorMsg}`);
        setMessages((prev) => [
          ...prev,
          {
            id: `confirm-error-${Date.now()}`,
            sender: 'oracle',
            text: `⚠️ **Could not cancel action**: ${errorMsg}.`,
            timestamp: formatTimestamp(),
          },
        ]);
        queueEmptiedByThis = proposalQueue.length - 1 <= 0;
        setProposalQueue((prev) => prev.filter((p) => p.proposalId !== proposalId));
        return;
      }

      const remaining = proposalQueue.length - 1;
      queueEmptiedByThis = remaining <= 0;
      const cancelMsg = result.message || 'Action cancelled by user.';
      setHitlAnnouncement(
        `Action denied. ${cancelMsg}${remaining > 0 ? ` ${remaining} more action${remaining > 1 ? 's' : ''} pending.` : ''}`
      );

      setMessages((prev) => [
        ...prev,
        {
          id: `confirm-deny-${Date.now()}`,
          sender: 'oracle',
          text: `❌ **Action Cancelled**: ${cancelMsg}`,
          timestamp: formatTimestamp(),
        },
      ]);

      setProposalQueue((prev) => prev.filter((p) => p.proposalId !== proposalId));
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      setHitlAnnouncement(`Error cancelling action: ${errorMsg}`);
    } finally {
      confirmInFlightRef.current = false;
      setIsConfirming(false);
      if (queueEmptiedByThis) reclaimInputFocusRef.current = true;
    }
  }, [proposalQueue.length, setHitlAnnouncement]);

  // Global window keydown listener while modal is open
  useEffect(() => {
    if (!isOpen) return;

    const handleWindowKeyDown = (e: KeyboardEvent) => {
      if (selectedPassage) return;

      // HITL Decision Shortcuts (Alt+Y / Alt+N)
      if (pendingProposal && !isConfirming && e.altKey) {
        const key = e.key.toLowerCase();
        if (key === 'y' || e.code === 'KeyY') {
          e.preventDefault();
          e.stopPropagation();
          handleProposalApprove(pendingProposal.proposalId);
          return;
        }
        if (key === 'n' || e.code === 'KeyN') {
          e.preventDefault();
          e.stopPropagation();
          handleProposalDeny(pendingProposal.proposalId);
          return;
        }
      }

      // Escape is handled exclusively here (not also in the overlay's
      // onKeyDown) so onClose only ever runs once per press. Escape only
      // closes the modal; it never denies a pending proposal on its own.
      // Denial is a decision with a real consequence (the proposal is
      // discarded), so it must go through the explicit Deny
      // button/Alt+N — a stray Escape (closing to check something else,
      // muscle memory, a misclick) must not silently throw away a
      // proposal the DM was still reading. The proposal stays pending
      // server-side and is recovered automatically if this modal reopens
      // (see the recovery effect above), so nothing is orphaned either.
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }
    };

    window.addEventListener('keydown', handleWindowKeyDown);
    return () => window.removeEventListener('keydown', handleWindowKeyDown);
  }, [isOpen, selectedPassage, pendingProposal, isConfirming, handleProposalApprove, handleProposalDeny, onClose]);

  // Main modal focus trap (Escape is handled by the window-level listener above)
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      // If passage modal is active, let passage modal handler handle it
      if (selectedPassage) return;

      if (e.key === 'Tab' && modalRef.current) {
        const focusable = modalRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
        );
        if (focusable.length > 0) {
          const first = focusable[0];
          const last = focusable[focusable.length - 1];

          if (e.shiftKey) {
            if (
              document.activeElement === first ||
              document.activeElement === headingRef.current ||
              !modalRef.current.contains(document.activeElement)
            ) {
              e.preventDefault();
              last.focus();
            }
          } else {
            if (document.activeElement === last || !modalRef.current.contains(document.activeElement)) {
              e.preventDefault();
              first.focus();
            }
          }
        }
      }
    },
    [selectedPassage]
  );

  // Passage modal keyboard handling
  const handlePassageKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      handleClosePassageModal();
      return;
    }

    if (e.key === 'Tab' && passageModalRef.current) {
      const focusable = passageModalRef.current.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      );
      if (focusable.length > 0) {
        const first = focusable[0];
        const last = focusable[focusable.length - 1];

        if (e.shiftKey) {
          if (
            document.activeElement === first ||
            document.activeElement === passageHeadingRef.current ||
            !passageModalRef.current.contains(document.activeElement)
          ) {
            e.preventDefault();
            last.focus();
          }
        } else {
          if (document.activeElement === last || !passageModalRef.current.contains(document.activeElement)) {
            e.preventDefault();
            first.focus();
          }
        }
      }
    }
  };

  const handleModelChange = async (e: React.ChangeEvent<HTMLSelectElement>) => {
    const newModel = e.target.value;
    setActiveModel(newModel);
    if (typeof localStorage !== 'undefined') {
      try {
        localStorage.setItem(STORAGE_KEY_MODEL, newModel);
      } catch {
        // Ignored
      }
    }
    try {
      await fetch('/api/assistant/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ activeModel: newModel }),
      });
    } catch {
      // Ignored
    }
  };

  const passageRequestRef = useRef(0);
  const handleOpenPassageModal = async (passage: PassageItem, trigger: HTMLElement) => {
    lastPassageButtonRef.current = trigger;
    const token = ++passageRequestRef.current;
    const isStale = () => token !== passageRequestRef.current;
    const applyEntity = (v: typeof passageEntityData) => { if (!isStale()) setPassageEntityData(v); };
    const finishLoading = () => { if (!isStale()) setIsLoadingPassage(false); };
    setSelectedPassage(passage);
    setIsLoadingPassage(true);

    try {
      const source = passage.source || '';
      const titleLower = passage.title.toLowerCase();

      // 1. Spells
      if (source === 'spell' || titleLower.startsWith('spell:')) {
        const allSpells = await dataService.getAllSpells();
        const pName = (
          (passage.metadata?.name as string) ||
          passage.title.replace(/^Spell:\s*/i, '').split('(')[0]
        ).toLowerCase().trim();
        let found = passage.entityId
          ? allSpells.find((s) => String(s.id) === String(passage.entityId))
          : undefined;
        if (!found) {
          found = allSpells.find((s) => s.name && s.name.toLowerCase() === pName);
        }
        if (!found) {
          found = allSpells.find(
            (s) =>
              s.name &&
              (s.name.toLowerCase().startsWith(pName) || s.name.toLowerCase().includes(pName))
          );
        }
        if (found) {
          applyEntity({ type: 'spell', data: found });
          finishLoading();
          return;
        }
      }

      // 2. Monsters
      if (source === 'monster' || titleLower.startsWith('monster:')) {
        const allMonsters = await dataService.getAllMonsters();
        const mName = (
          (passage.metadata?.name as string) ||
          passage.title.replace(/^Monster:\s*/i, '').split('(')[0]
        ).toLowerCase().trim();
        let found = passage.entityId
          ? allMonsters.find((m) => String(m.id) === String(passage.entityId))
          : undefined;
        if (!found) {
          found = allMonsters.find((m) => m.name && m.name.toLowerCase() === mName);
        }
        if (!found) {
          found = allMonsters.find(
            (m) =>
              m.name &&
              (m.name.toLowerCase().startsWith(mName) || m.name.toLowerCase().includes(mName))
          );
        }
        if (found) {
          applyEntity({ type: 'monster', data: found });
          finishLoading();
          return;
        }
      }

      // 3. Magic Items
      if (source === 'magic_item' || titleLower.startsWith('magic item:') || titleLower.startsWith('item:')) {
        const allItems = await dataService.getAllMagicItems();
        const iName = (
          (passage.metadata?.name as string) ||
          passage.title.replace(/^Magic Item:\s*/i, '').replace(/^Item:\s*/i, '').split('(')[0]
        ).toLowerCase().trim();
        let found = passage.entityId
          ? allItems.find((it) => String(it.id) === String(passage.entityId) || it.slug === String(passage.entityId))
          : undefined;
        if (!found) {
          found = allItems.find((it) => it.name && it.name.toLowerCase() === iName);
        }
        if (!found) {
          found = allItems.find(
            (it) =>
              it.name &&
              (it.name.toLowerCase().startsWith(iName) || it.name.toLowerCase().includes(iName))
          );
        }
        if (found) {
          applyEntity({ type: 'item', data: found });
          finishLoading();
          return;
        }
      }

      // 4. Default Lore / Asset / SRD
      applyEntity({ type: 'lore', data: passage });
    } catch {
      applyEntity({ type: 'lore', data: passage });
    } finally {
      finishLoading();
    }
  };

  // Copy a chat message's text content to the clipboard. Falls back to a
  // hidden-textarea + execCommand approach for browsers/contexts (e.g. no
  // secure context) where navigator.clipboard is unavailable, so the button
  // still works rather than silently failing.
  const handleCopyMessage = useCallback(async (msg: Message) => {
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(msg.text);
      } else {
        const textarea = document.createElement('textarea');
        textarea.value = msg.text;
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.focus();
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
      }

      setCopiedMessageId(msg.id);
      setCopyAnnouncement(`${msg.sender === 'user' ? 'Your message' : "Oracle's message"} copied to clipboard.`);

      if (copyResetTimeoutRef.current) {
        clearTimeout(copyResetTimeoutRef.current);
      }
      copyResetTimeoutRef.current = setTimeout(() => {
        setCopiedMessageId((current) => (current === msg.id ? null : current));
      }, 2000);
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      setCopyAnnouncement(`Could not copy message to clipboard: ${errorMsg}`);
    }
  }, [setCopyAnnouncement]);

  // Clear any pending "Copied!" reset timeout on unmount to avoid a
  // state update after the component is gone.
  useEffect(() => {
    return () => {
      if (copyResetTimeoutRef.current) {
        clearTimeout(copyResetTimeoutRef.current);
      }
    };
  }, []);

  const handleClosePassageModal = () => {
    passageRequestRef.current++; // invalidate any in-flight passage lookup
    setSelectedPassage(null);
    setPassageEntityData(null);
    setTimeout(() => {
      lastPassageButtonRef.current?.focus();
    }, 40);
  };

  const handleSend = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const query = inputQuery.trim();
    if (!query || isLoading) return;

    const userMessage: Message = {
      id: `user-${Date.now()}`,
      sender: 'user',
      text: query,
      timestamp: formatTimestamp(),
    };

    setMessages((prev) => [...prev, userMessage]);
    setInputQuery('');
    setIsLoading(true);

    try {
      const res = await fetch('/api/assistant/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query,
          campaignId,
          encounterId,
          chapterId,
          chapterName,
          worldId,
          worldName,
          model: activeModel,
        }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.error || `Assistant request failed (HTTP ${res.status}).`);
      }

      // Handle staged Human-in-the-Loop proposal(s). A single turn can stage
      // more than one write-tool proposal; each is appended to the existing
      // queue so nothing already awaiting the DM's review is displaced.
      const newProposals: ConfirmationProposal[] = Array.isArray(data.proposals)
        ? data.proposals.filter((p: ConfirmationProposal) => p && p.requiresConfirmation)
        : [];
      if (newProposals.length > 0) {
        // A proposal already recovered into the queue on modal reopen (see
        // the recovery effect above) can be echoed back by this same chat
        // response if the DM re-asked before resolving it. Dedupe by
        // proposalId so it isn't queued twice — an inflated queue length
        // would both show a wrong "N of M" count and make the approve/deny
        // handlers below think more proposals are still pending than
        // actually are, keeping focus away from the chat input after the
        // real (single) proposal is resolved.
        setProposalQueue((prev) => {
          const existingIds = new Set(prev.map((p) => p.proposalId));
          const deduped = newProposals.filter((p) => !existingIds.has(p.proposalId));
          return [...prev, ...deduped];
        });
        const first = newProposals[0];
        const extraNote =
          newProposals.length > 1 ? ` (${newProposals.length} actions proposed; reviewing them one at a time.)` : '';
        setHitlAnnouncement(
          `Action proposed: ${first.description}. Press Alt+Y to approve, Alt+N to deny, or review details above input.${extraNote}`
        );
      }

      let answerText = data.answer || 'No response received from the Oracle.';
      let thinkingText = data.thinking || null;

      // Failsafe: if answerText contains <think> tags, extract and clean them
      if (answerText.includes('<think>')) {
        const closedMatch = answerText.match(/<think>([\s\S]*?)<\/think>/i);
        if (closedMatch) {
          const extracted = closedMatch[1].trim();
          thinkingText = thinkingText ? `${thinkingText}\n\n${extracted}` : extracted;
          answerText = answerText.replace(/<think>[\s\S]*?<\/think>/i, '').trim();
        } else {
          const unclosedMatch = answerText.match(/<think>([\s\S]*)$/i);
          if (unclosedMatch) {
            const extracted = unclosedMatch[1].trim();
            thinkingText = thinkingText ? `${thinkingText}\n\n${extracted}` : extracted;
            answerText = answerText.replace(/<think>[\s\S]*$/i, '').trim();
          }
        }
      }

      const oracleMessage: Message = {
        id: `oracle-${Date.now()}`,
        sender: 'oracle',
        text: answerText || '*(The model completed its thought process. Expand "Thought Process" above to view its reasoning.)*',
        thinking: thinkingText,
        passages: data.passages,
        toolCalls: data.toolCalls,
        modelUsed: data.modelUsed || activeModel,
        timestamp: formatTimestamp(),
      };

      setMessages((prev) => [...prev, oracleMessage]);
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      const errorMsgId = `oracle-error-${Date.now()}`;
      setMessages((prev) => [
        ...prev,
        {
          id: errorMsgId,
          sender: 'oracle',
          text: `**Error communicating with Oracle**: ${errorMessage}`,
          timestamp: formatTimestamp(),
        },
      ]);
    } finally {
      setIsLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div
      className="modal-overlay assistant-oracle-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="assistant-oracle-title"
      onKeyDown={handleKeyDown}
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: 'rgba(0,0,0,0.85)',
        zIndex: 3500,
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        padding: '1rem',
      }}
    >
      <div
        ref={modalRef}
        className="modal-content assistant-oracle-content dark-theme"
        style={{
          backgroundColor: '#1a1a1a',
          color: '#f0f0f0',
          padding: '1.5rem',
          borderRadius: '8px',
          width: '95%',
          maxWidth: '850px',
          height: '88vh',
          display: 'flex',
          flexDirection: 'column',
          border: '2px solid #555',
          boxShadow: '0 8px 30px rgba(0,0,0,0.8)',
        }}
      >
        {/* Persistent Live Region for Screen Reader Announcements */}
        <div
          id="hitl-live-announcement"
          role="status"
          aria-live="polite"
          aria-atomic="true"
          className="sr-only"
          style={{
            position: 'absolute',
            width: '1px',
            height: '1px',
            overflow: 'hidden',
            clip: 'rect(0,0,0,0)',
          }}
        >
          {hitlAnnouncement}
        </div>

        {/* Persistent Live Region for Copy-to-Clipboard Announcements */}
        <div
          id="copy-message-announcement"
          role="status"
          aria-live="polite"
          aria-atomic="true"
          className="sr-only"
          style={{
            position: 'absolute',
            width: '1px',
            height: '1px',
            overflow: 'hidden',
            clip: 'rect(0,0,0,0)',
          }}
        >
          {copyAnnouncement}
        </div>

        {/* Header */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            borderBottom: '1px solid #333',
            paddingBottom: '0.75rem',
            marginBottom: '0.75rem',
          }}
        >
          <div>
            <h2
              id="assistant-oracle-title"
              ref={headingRef}
              tabIndex={-1}
              style={{
                margin: 0,
                outline: 'none',
                fontSize: '1.5rem',
              }}
            >
              Oracle AI
            </h2>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Close Assistant Oracle"
            style={{
              background: '#444',
              color: 'white',
              border: 'none',
              padding: '0.4rem 0.8rem',
              borderRadius: '4px',
              cursor: 'pointer',
              fontWeight: 'bold',
            }}
          >
            Close (Esc)
          </button>
        </div>

        {/* Conversation Log */}
        <div
          role="log"
          aria-label="Assistant Oracle Conversation History"
          tabIndex={0}
          style={{
            flex: 1,
            overflowY: 'auto',
            background: '#111',
            borderRadius: '6px',
            padding: '1rem',
            marginBottom: '1rem',
            border: '1px solid #333',
            display: 'flex',
            flexDirection: 'column',
            gap: '1rem',
          }}
        >
          {messages.map((msg) => (
            <article
              key={msg.id}
              id={msg.id}
              aria-label={`${msg.sender === 'user' ? 'You' : 'Assistant Oracle'}, ${msg.timestamp}`}
              className={`chat-message ${msg.sender === 'user' ? 'user-message' : 'oracle-message'}`}
              style={{
                alignSelf: msg.sender === 'user' ? 'flex-end' : 'flex-start',
                maxWidth: '85%',
                backgroundColor: msg.sender === 'user' ? '#004c99' : '#222',
                padding: '0.75rem 1rem',
                borderRadius: '8px',
                border: msg.sender === 'user' ? '1px solid #0066cc' : '1px solid #444',
                outline: 'none',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'flex-start',
                  gap: '0.5rem',
                  marginBottom: '0.35rem',
                }}
              >
                {/* Header hidden from screen readers to prevent duplicate announcement with article aria-label */}
                <header
                  aria-hidden="true"
                  style={{
                    fontSize: '0.8rem',
                    color: msg.sender === 'user' ? '#e6f2ff' : '#bbb',
                  }}
                >
                  <span style={{ fontWeight: 'bold' }}>
                    {msg.sender === 'user' ? 'You' : 'Oracle'} {msg.timestamp}
                  </span>
                </header>

                <button
                  type="button"
                  onClick={() => handleCopyMessage(msg)}
                  aria-label={`Copy ${msg.sender === 'user' ? 'your' : "the Oracle's"} message from ${msg.timestamp} to clipboard`}
                  style={{
                    flexShrink: 0,
                    background: 'transparent',
                    color: msg.sender === 'user' ? '#e6f2ff' : '#bbb',
                    border: '1px solid currentColor',
                    borderRadius: '4px',
                    padding: '0.15rem 0.5rem',
                    fontSize: '0.75rem',
                    cursor: 'pointer',
                  }}
                >
                  {copiedMessageId === msg.id ? 'Copied!' : 'Copy'}
                </button>
              </div>

              {msg.sender === 'user' ? (
                <p style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{msg.text}</p>
              ) : (
                <>
                  {/* Collapsed Thought Process Disclosure */}
                  {msg.thinking && (
                    <details
                      className="oracle-thoughts-disclosure"
                      style={{
                        marginBottom: '0.75rem',
                        fontSize: '0.85rem',
                        background: '#161616',
                        padding: '0.4rem 0.6rem',
                        borderRadius: '4px',
                        border: '1px solid #333',
                      }}
                    >
                      <summary
                        style={{
                          cursor: 'pointer',
                          fontWeight: 600,
                          color: '#a0a0a0',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '0.4rem',
                        }}
                        aria-label="Oracle Thought Process"
                      >
                        <span>💭 Thought Process</span>
                      </summary>
                      <div
                        tabIndex={0}
                        role="region"
                        aria-label="Expanded Thought Process"
                        style={{
                          marginTop: '0.5rem',
                          padding: '0.5rem',
                          background: '#0d0d0d',
                          borderRadius: '4px',
                          color: '#999',
                          whiteSpace: 'pre-wrap',
                          fontFamily: 'monospace',
                          fontSize: '0.8rem',
                          lineHeight: '1.45',
                          maxHeight: '320px',
                          overflowY: 'auto',
                          border: '1px solid #222',
                        }}
                      >
                        {msg.thinking}
                      </div>
                    </details>
                  )}

                  <AssistantMarkdown content={msg.text} />

                  {/* Executed Tools Disclosure */}
                  {msg.toolCalls && msg.toolCalls.length > 0 && (
                    <details
                      style={{
                        marginTop: '0.75rem',
                        fontSize: '0.85rem',
                        background: '#181818',
                        padding: '0.5rem',
                        borderRadius: '4px',
                        border: '1px solid #333',
                      }}
                    >
                      <summary style={{ cursor: 'pointer', fontWeight: 'bold', color: '#4da6ff' }}>
                        Authoritative Data Reads Executed ({msg.toolCalls.length})
                      </summary>
                      <ul style={{ margin: '0.5rem 0 0 1rem', padding: 0 }}>
                        {msg.toolCalls.map((tc, idx) => {
                          const isMapTool = tc.toolName === 'get_current_map';
                          const mapResult =
                            isMapTool && tc.result && typeof tc.result === 'object'
                              ? (tc.result as MapToolResult)
                              : null;

                          return (
                            <li key={idx} style={{ marginBottom: '0.5rem' }}>
                              <div>
                                <code>{tc.toolName}</code> with args <code>{JSON.stringify(tc.args)}</code>
                              </div>
                              {mapResult && mapResult.image && (
                                <div
                                  className="assistant-map-result-container"
                                  style={{
                                    marginTop: '0.4rem',
                                    padding: '0.5rem',
                                    background: '#121212',
                                    borderRadius: '4px',
                                    border: '1px solid #333',
                                  }}
                                >
                                  <div
                                    style={{
                                      fontWeight: 'bold',
                                      marginBottom: '0.3rem',
                                      color: '#66d9ef',
                                    }}
                                  >
                                    Tactical Map: {mapResult.mapName || mapResult.encounterName || 'Current Encounter'}
                                    {mapResult.grid
                                      ? ` (${mapResult.grid.columns}x${mapResult.grid.rows} grid)`
                                      : ''}
                                  </div>
                                  <div style={{ textAlign: 'center', marginBottom: '0.4rem' }}>
                                    <img
                                      src={mapResult.image}
                                      alt={`Tactical combat map for ${mapResult.mapName || 'the encounter'} with character locations`}
                                      style={{
                                        maxWidth: '100%',
                                        maxHeight: '360px',
                                        objectFit: 'contain',
                                        borderRadius: '4px',
                                        border: '1px solid #444',
                                        display: 'block',
                                        margin: '0 auto',
                                      }}
                                    />
                                  </div>
                                  {mapResult.combatants && mapResult.combatants.length > 0 && (
                                    <div style={{ marginTop: '0.4rem' }}>
                                      <div
                                        style={{
                                          fontSize: '0.8rem',
                                          fontWeight: 'bold',
                                          color: '#bbb',
                                          marginBottom: '0.2rem',
                                        }}
                                      >
                                        Character Locations:
                                      </div>
                                      <div
                                        tabIndex={0}
                                        role="region"
                                        aria-label={`Combatant coordinates table for ${mapResult.mapName || 'tactical map'}`}
                                        style={{ overflowX: 'auto', outline: 'none' }}
                                      >
                                        <table
                                          style={{
                                            width: '100%',
                                            borderCollapse: 'collapse',
                                            fontSize: '0.78rem',
                                            textAlign: 'left',
                                          }}
                                          aria-label={`Combatant coordinates on ${mapResult.mapName || 'tactical map'}`}
                                        >
                                          <thead>
                                            <tr style={{ borderBottom: '1px solid #444', color: '#888' }}>
                                              <th scope="col" style={{ padding: '2px 4px' }}>Name</th>
                                              <th scope="col" style={{ padding: '2px 4px' }}>Team</th>
                                              <th scope="col" style={{ padding: '2px 4px' }}>Cell</th>
                                              <th scope="col" style={{ padding: '2px 4px' }}>HP</th>
                                            </tr>
                                          </thead>
                                          <tbody>
                                            {mapResult.combatants.map((c, cIdx) => (
                                              <tr key={cIdx} style={{ borderBottom: '1px solid #282828' }}>
                                                <td style={{ padding: '2px 4px', fontWeight: 'bold' }}>
                                                  {c.name}
                                                </td>
                                                <td
                                                  style={{
                                                    padding: '2px 4px',
                                                    color: c.team === 'Player' ? '#74c0fc' : '#ffa8a8',
                                                  }}
                                                >
                                                  {c.team}
                                                </td>
                                                <td
                                                  style={{
                                                    padding: '2px 4px',
                                                    fontFamily: 'monospace',
                                                    fontWeight: 'bold',
                                                  }}
                                                >
                                                  {c.cell}
                                                </td>
                                                <td style={{ padding: '2px 4px' }}>{c.hp || '—'}</td>
                                              </tr>
                                            ))}
                                          </tbody>
                                        </table>
                                      </div>
                                    </div>
                                  )}
                                  {mapResult.unplacedCombatantsCount !== undefined && mapResult.unplacedCombatantsCount > 0 && (
                                    <div
                                      style={{
                                        marginTop: '0.35rem',
                                        fontSize: '0.75rem',
                                        color: '#ced4da',
                                        fontStyle: 'italic',
                                      }}
                                    >
                                      {mapResult.unplacedCombatantsCount} combatant{mapResult.unplacedCombatantsCount > 1 ? 's' : ''} in encounter not yet placed on grid coordinates.
                                    </div>
                                  )}
                                </div>
                              )}
                              {mapResult && mapResult.error && (
                                <div
                                  className="assistant-map-error-callout"
                                  style={{
                                    marginTop: '0.35rem',
                                    padding: '0.4rem 0.6rem',
                                    background: '#2b1616',
                                    borderRadius: '4px',
                                    border: '1px solid #ff6b6b',
                                    color: '#ffc9c9',
                                    fontSize: '0.8rem',
                                  }}
                                >
                                  <strong>Map Unavailable:</strong> {mapResult.error}
                                  {mapResult.hint && (
                                    <div style={{ marginTop: '0.2rem', color: '#ffe066' }}>
                                      {mapResult.hint}
                                    </div>
                                  )}
                                </div>
                              )}
                            </li>
                          );
                        })}
                      </ul>
                    </details>
                  )}

                  {/* Retrieved Knowledge Passages Disclosure */}
                  {msg.passages && msg.passages.length > 0 && (
                    <details
                      style={{
                        marginTop: '0.5rem',
                        fontSize: '0.85rem',
                        background: '#181818',
                        padding: '0.5rem',
                        borderRadius: '4px',
                        border: '1px solid #333',
                      }}
                    >
                      <summary style={{ cursor: 'pointer', fontWeight: 'bold', color: '#a6e22e' }}>
                        Knowledge Passages Retrieved ({msg.passages.length})
                      </summary>
                      <ul style={{ margin: '0.5rem 0 0 1rem', padding: 0, listStyle: 'none' }}>
                        {msg.passages.map((p, idx) => (
                          <li key={idx} style={{ marginBottom: '0.4rem' }}>
                            <button
                              type="button"
                              onClick={(e) => handleOpenPassageModal(p, e.currentTarget)}
                              aria-label={`View details for ${p.title}`}
                              style={{
                                background: 'transparent',
                                border: 'none',
                                color: '#4da6ff',
                                textDecoration: 'underline',
                                cursor: 'pointer',
                                textAlign: 'left',
                                padding: '0.2rem 0',
                                fontSize: '0.9rem',
                                fontWeight: 'bold',
                              }}
                            >
                              {p.title}
                            </button>
                          </li>
                        ))}
                      </ul>
                    </details>
                  )}
                </>
              )}
            </article>
          ))}

          {isLoading && (
            <div
              role="status"
              aria-live="polite"
              style={{
                alignSelf: 'flex-start',
                backgroundColor: '#222',
                padding: '0.75rem 1rem',
                borderRadius: '8px',
                border: '1px solid #444',
                color: '#aaa',
                fontStyle: 'italic',
              }}
            >
              The Oracle is contemplating...
            </div>
          )}

          <div ref={logEndRef} />
        </div>

        {/* HITL Write-Tool Confirmation Box */}
        {pendingProposal && (
          <HitlConfirmationBox
            proposal={pendingProposal}
            onApprove={handleProposalApprove}
            onDeny={handleProposalDeny}
            isProcessing={isConfirming}
            queuePosition={1}
            queueTotal={proposalQueue.length}
          />
        )}

        {/* Input Form */}
        <form onSubmit={handleSend} style={{ display: 'flex', gap: '0.5rem' }}>
          <label
            htmlFor="assistant-oracle-input"
            className="sr-only"
            style={{
              position: 'absolute',
              width: '1px',
              height: '1px',
              overflow: 'hidden',
              clip: 'rect(0,0,0,0)',
            }}
          >
            Ask the Oracle a rules or game state question
          </label>
          <textarea
            id="assistant-oracle-input"
            ref={inputRef}
            value={inputQuery}
            onChange={(e) => setInputQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSend();
              }
            }}
            placeholder="Ask rules, spells, monsters, or live state (Alt+A to focus, Enter to send)..."
            rows={2}
            disabled={isLoading}
            style={{
              flex: 1,
              background: '#2a2a2a',
              color: 'white',
              border: '1px solid #555',
              borderRadius: '4px',
              padding: '0.6rem 0.8rem',
              fontSize: '1rem',
              resize: 'none',
              outline: 'none',
            }}
          />
          <button
            type="submit"
            disabled={isLoading || !inputQuery.trim()}
            style={{
              backgroundColor: isLoading || !inputQuery.trim() ? '#444' : '#0066cc',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              padding: '0 1.5rem',
              fontWeight: 'bold',
              fontSize: '1rem',
              cursor: isLoading || !inputQuery.trim() ? 'not-allowed' : 'pointer',
            }}
          >
            {isLoading ? 'Asking...' : 'Ask'}
          </button>
        </form>

        {/* Model Selection Combo Box under edit box and send button */}
        <div style={{ display: 'flex', justifyContent: 'flex-start', marginTop: '0.5rem' }}>
          <select
            id="assistant-model-select"
            value={activeModel}
            onChange={handleModelChange}
            aria-label={`Current Model: ${getModelDisplayName(activeModel)}`}
            style={{
              background: '#222',
              color: '#ccc',
              border: '1px solid #444',
              borderRadius: '4px',
              padding: '0.25rem 0.6rem',
              fontSize: '0.85rem',
              cursor: 'pointer',
            }}
          >
            <option value="qwen3.5:9b">Qwen3.5-9B (Primary - ~6GB VRAM)</option>
            <option value="qwen3.5:4b">Qwen3.5-4B (Fallback - ~3GB VRAM)</option>
            <option value="llama3">Llama 3 (8B) - ~5.5GB VRAM</option>
          </select>
        </div>
      </div>

      {/* Accessible Knowledge Passage Detail Modal */}
      {selectedPassage && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="passage-modal-heading"
          onKeyDown={handlePassageKeyDown}
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(0,0,0,0.85)',
            zIndex: 4000,
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
            padding: '1.5rem',
          }}
        >
          <div
            ref={passageModalRef}
            className="modal-content dark-theme"
            style={{
              backgroundColor: '#1f1f1f',
              color: '#f0f0f0',
              padding: '1.5rem',
              borderRadius: '8px',
              maxWidth: '850px',
              width: '95%',
              maxHeight: '85vh',
              overflowY: 'auto',
              border: '2px solid #555',
              boxShadow: '0 8px 30px rgba(0,0,0,0.9)',
            }}
          >
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                borderBottom: '1px solid #444',
                paddingBottom: '0.75rem',
                marginBottom: '1rem',
              }}
            >
              <h3
                id="passage-modal-heading"
                ref={passageHeadingRef}
                tabIndex={-1}
                style={{ margin: 0, outline: 'none', fontSize: '1.4rem' }}
              >
                {selectedPassage.title}
              </h3>
              <button
                type="button"
                onClick={handleClosePassageModal}
                aria-label={`Close ${selectedPassage.title} details`}
                style={{
                  background: '#444',
                  color: 'white',
                  border: 'none',
                  padding: '0.4rem 0.8rem',
                  borderRadius: '4px',
                  cursor: 'pointer',
                  fontWeight: 'bold',
                }}
              >
                Close (Esc)
              </button>
            </div>

            {isLoadingPassage ? (
              <p style={{ color: '#aaa', fontStyle: 'italic' }}>Loading details...</p>
            ) : passageEntityData?.type === 'spell' ? (
              <div style={{ backgroundColor: '#ffffff', color: '#111111', padding: '1.25rem', borderRadius: '6px' }}>
                <SpellDetail spell={passageEntityData.data} />
              </div>
            ) : passageEntityData?.type === 'monster' ? (
              <div style={{ backgroundColor: '#ffffff', color: '#111111', padding: '1.25rem', borderRadius: '6px' }}>
                <MonsterDetails monster={passageEntityData.data} />
              </div>
            ) : passageEntityData?.type === 'item' ? (
              <div style={{ backgroundColor: '#ffffff', color: '#111111', padding: '1.25rem', borderRadius: '6px' }}>
                <MagicItemDetail magicItem={passageEntityData.data} onClose={handleClosePassageModal} />
              </div>
            ) : (
              <div style={{ lineHeight: '1.6', color: '#e0e0e0' }}>
                <p style={{ fontSize: '0.85rem', color: '#888', marginBottom: '1rem' }}>
                  Source: <strong>{selectedPassage.source || 'SRD / Lore'}</strong>
                </p>
                <div style={{ whiteSpace: 'pre-wrap' }}>
                  <AssistantMarkdown content={selectedPassage.content} />
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
