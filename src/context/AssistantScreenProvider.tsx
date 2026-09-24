import { useState } from 'react';
import type { ReactNode } from 'react';
import { AssistantScreenContext, createAssistantScreenStore } from './AssistantScreenContext';

export function AssistantScreenProvider({ children }: { children: ReactNode }) {
  // Created once; the store identity never changes so registering never re-renders anything.
  const [store] = useState(createAssistantScreenStore);
  return <AssistantScreenContext.Provider value={store}>{children}</AssistantScreenContext.Provider>;
}
