import { useState, useEffect } from 'react';

export interface DiceLogEntry {
  id: string;
  timestamp: string;
  isoTimestamp: string;
  source: string;
  purpose: string;
  formula: string;
  rolls: number[];
  modifier: number;
  total: number;
  critStatus?: 'crit' | 'fumble' | 'normal';
  details?: string;
}

const STORAGE_KEY = 'crits_dice_log';
const MAX_LOG_ENTRIES = 100;

class DiceLogManager {
  private entries: DiceLogEntry[] = [];
  private listeners = new Set<(entries: DiceLogEntry[]) => void>();

  constructor() {
    this.loadFromStorage();
    if (typeof window !== 'undefined') {
      window.addEventListener('storage', (e) => {
        if (e.key === STORAGE_KEY) {
          this.loadFromStorage();
          this.notify();
        }
      });
    }
  }

  private loadFromStorage() {
    if (typeof window === 'undefined' || !window.localStorage) return;
    try {
      const data = localStorage.getItem(STORAGE_KEY);
      if (data) {
        this.entries = JSON.parse(data);
      } else {
        this.entries = [];
      }
    } catch {
      this.entries = [];
    }
  }

  private saveToStorage() {
    if (typeof window === 'undefined' || !window.localStorage) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.entries));
    } catch {
      // Ignore quota errors
    }
  }

  private notify() {
    const copy = [...this.entries];
    this.listeners.forEach(cb => cb(copy));
  }

  public getEntries(): DiceLogEntry[] {
    return [...this.entries];
  }

  public logRoll(params: {
    source: string;
    purpose: string;
    formula: string;
    rolls?: number[];
    modifier?: number;
    total: number;
    critStatus?: 'crit' | 'fumble' | 'normal';
    details?: string;
  }): DiceLogEntry {
    const now = new Date();
    const entry: DiceLogEntry = {
      id: `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
      timestamp: now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
      isoTimestamp: now.toISOString(),
      source: params.source,
      purpose: params.purpose,
      formula: params.formula,
      rolls: params.rolls || [],
      modifier: params.modifier || 0,
      total: params.total,
      critStatus: params.critStatus || 'normal',
      details: params.details
    };

    this.entries = [entry, ...this.entries].slice(0, MAX_LOG_ENTRIES);
    this.saveToStorage();
    this.notify();
    return entry;
  }

  public clear(): void {
    this.entries = [];
    this.saveToStorage();
    this.notify();
  }

  public subscribe(listener: (entries: DiceLogEntry[]) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
}

export const diceLogService = new DiceLogManager();

export function useDiceLog() {
  const [entries, setEntries] = useState<DiceLogEntry[]>(() => diceLogService.getEntries());

  useEffect(() => {
    return diceLogService.subscribe((updated) => {
      setEntries(updated);
    });
  }, []);

  return {
    entries,
    logRoll: diceLogService.logRoll.bind(diceLogService),
    clearLog: diceLogService.clear.bind(diceLogService)
  };
}
