/**
 * Replaces each @TagType[id]{Name} tag with its display name, for text shown
 * as plain text (chapter titles in pickers, headings and assistant prompts).
 * A tag without a {Name} falls back to its id. Shared by the app and the server.
 */
export function stripMentionTags(text: string): string {
  return text.replace(/@(?:Campaign|Monster|Spell|Item|World)\[([^\]]+)\](?:\{([^}]+)\})?/g, (_, id: string, name?: string) => name ?? id);
}
