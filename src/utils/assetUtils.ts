import type { ChapterAssetRef } from '../types';

/** Matches @Campaign[id]{Name}, @Monster[id]{Name}, @Spell[id]{Name}, @Item[id]{Name}, @World[id]{Name} */
const MENTION_REGEX = /@(Campaign|Monster|Spell|Item|World)\[([^\]]+)\](?:\{[^}]+\})?/g;

/**
 * Parses a chapter's content string and returns an ordered, deduplicated list
 * of asset references found via @TagType[id]{Name} syntax.
 *
 * - Ordered  : refs appear in the same order as their first occurrence in the text.
 * - Deduped  : if the same tag+id pair appears more than once, only the first is kept.
 * - Minimal  : only {id, tagType} are stored — no full asset data is copied.
 *
 * This is the single source of truth for building `Chapter.mentionedAssets`.
 * Call it whenever chapter content is saved or an asset tag is inserted.
 */
export function parseMentionedAssets(content: string): ChapterAssetRef[] {
  // Create a fresh regex instance so exec() always starts from index 0
  const regex = new RegExp(MENTION_REGEX.source, 'g');
  const seen = new Set<string>();
  const refs: ChapterAssetRef[] = [];
  let match: RegExpExecArray | null;

  while ((match = regex.exec(content)) !== null) {
    const tagType = match[1] as ChapterAssetRef['tagType'];
    const id = match[2];
    const key = `${tagType}-${id}`;
    if (!seen.has(key)) {
      seen.add(key);
      refs.push({ id, tagType });
    }
  }

  return refs;
}
