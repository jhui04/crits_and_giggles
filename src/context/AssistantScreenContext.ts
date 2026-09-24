import { createContext, useContext, useEffect } from 'react';
import type { AssistantScreenId } from '../utils/assistantScreens';

/**
 * Registry of which screen the DM is currently on, so the Assistant Oracle can behave for it
 * (see docs/CONTEXT_AWARE_ASSISTANT.md). Screens register while mounted; the most recent
 * registration wins, and unmounting removes it. The store is deliberately not React state:
 * registering must not re-render anything, and the modal reads it once, when it opens.
 */
export interface AssistantScreenStore {
  register: (id: AssistantScreenId) => () => void;
  /** The current screen id, or null if no screen has registered. */
  getCurrent: () => AssistantScreenId | null;
}

export function createAssistantScreenStore(): AssistantScreenStore {
  const entries: Array<{ token: object; id: AssistantScreenId }> = [];
  return {
    register(id) {
      const entry = { token: {}, id };
      entries.push(entry);
      return () => {
        const index = entries.indexOf(entry);
        if (index !== -1) entries.splice(index, 1);
      };
    },
    getCurrent() {
      return entries.length > 0 ? entries[entries.length - 1].id : null;
    },
  };
}

// Without a provider (e.g. a component rendered on its own) registration is a harmless no-op.
const NOOP_STORE: AssistantScreenStore = {
  register: () => () => {},
  getCurrent: () => null,
};

export const AssistantScreenContext = createContext<AssistantScreenStore>(NOOP_STORE);

export function useAssistantScreenStore(): AssistantScreenStore {
  return useContext(AssistantScreenContext);
}

/**
 * Registers the calling screen with the Assistant. Pass null to register nothing (e.g. while a
 * child view is taking over the screen).
 */
export function useAssistantScreen(id: AssistantScreenId | null): void {
  const store = useAssistantScreenStore();
  useEffect(() => {
    if (!id) return;
    return store.register(id);
  }, [store, id]);
}
