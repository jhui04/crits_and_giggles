import { createContext, useContext } from 'react';
import type { World } from '../types';

export interface WorldContextType {
  worlds: World[];
  activeWorldId: string | null;
  activeWorld: World | undefined;
  setActiveWorldId: (id: string | null) => void;
  createWorld: (name: string, description: string) => Promise<void>;
  updateWorld: (world: World) => Promise<void>;
  deleteWorld: (id: string) => Promise<void>;
}

export const WorldContext = createContext<WorldContextType | undefined>(undefined);

export function useWorlds() {
  const context = useContext(WorldContext);
  if (context === undefined) {
    throw new Error('useWorlds must be used within a WorldProvider');
  }
  return context;
}
