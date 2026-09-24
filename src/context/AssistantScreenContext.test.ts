import { describe, it, expect } from 'vitest';
import { createAssistantScreenStore } from './AssistantScreenContext';

describe('createAssistantScreenStore', () => {
  it('is empty until a screen registers', () => {
    expect(createAssistantScreenStore().getCurrent()).toBeNull();
  });

  it('the most recent registration wins and unregistering restores the previous one', () => {
    const store = createAssistantScreenStore();
    const unregisterChapters = store.register('create.chapters');
    expect(store.getCurrent()).toBe('create.chapters');
    const unregisterBuilder = store.register('create.encounter_builder');
    expect(store.getCurrent()).toBe('create.encounter_builder');
    unregisterBuilder();
    expect(store.getCurrent()).toBe('create.chapters');
    unregisterChapters();
    expect(store.getCurrent()).toBeNull();
  });

  it('unregistering twice or out of order is safe', () => {
    const store = createAssistantScreenStore();
    const a = store.register('run.story');
    const b = store.register('run.combat');
    a();
    a();
    expect(store.getCurrent()).toBe('run.combat');
    b();
    expect(store.getCurrent()).toBeNull();
  });

  it('registering the same id twice keeps it until both unregister', () => {
    const store = createAssistantScreenStore();
    const a = store.register('run.story');
    const b = store.register('run.story');
    a();
    expect(store.getCurrent()).toBe('run.story');
    b();
    expect(store.getCurrent()).toBeNull();
  });
});
