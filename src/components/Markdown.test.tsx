import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Markdown, normalizeTagSpacing } from './Markdown';

describe('Markdown Component & normalizeTagSpacing', () => {
  describe('normalizeTagSpacing', () => {
    it('returns empty/falsy text as-is', () => {
      expect(normalizeTagSpacing('')).toBe('');
    });

    it('unwraps accidental double-nested tags', () => {
      const input = 'She found the @Item[1434359]{@Item[1434359]{rod of retribution}} in the sand.';
      expect(normalizeTagSpacing(input)).toBe('She found the @Item[1434359]{rod of retribution} in the sand.');
    });

    it('inserts space when tag is preceded by alphanumeric characters without space', () => {
      const input = 'use the@Monster[16829]{commoner}stat block';
      expect(normalizeTagSpacing(input)).toBe('use the @Monster[16829]{commoner} stat block');
    });

    it('inserts space when tag is preceded by sentence punctuation without space', () => {
      const input = 'nature,@Monster[744340]{Three Earrings} has taken';
      expect(normalizeTagSpacing(input)).toBe('nature, @Monster[744340]{Three Earrings} has taken');
    });

    it('inserts space when tag is followed by alphanumeric characters without space', () => {
      const input = 'sea elf @Monster[16848]{druid}named Aldageam';
      expect(normalizeTagSpacing(input)).toBe('sea elf @Monster[16848]{druid} named Aldageam');
    });

    it('inserts space when tag is followed by an opening parenthesis without space', () => {
      const input = 'two @Monster[744335]{sharkbody abominations}(see the sidebar)';
      expect(normalizeTagSpacing(input)).toBe('two @Monster[744335]{sharkbody abominations} (see the sidebar)');
    });

    it('leaves properly spaced text completely untouched', () => {
      const input = 'The party met @Monster[16848]{druid} in the glade. She gave them @Item[123]{potion}.';
      expect(normalizeTagSpacing(input)).toBe(input);
    });

    it('preserves parentheses enclosing tags', () => {
      const input = 'use the cleric (@Monster[16848]{druid}) instead';
      expect(normalizeTagSpacing(input)).toBe('use the cleric (@Monster[16848]{druid}) instead');
    });
  });

  describe('Markdown rendering', () => {
    const noop = vi.fn();

    it('renders null when content is empty', () => {
      const html = renderToStaticMarkup(<Markdown content="" onAssetClick={noop} />);
      expect(html).toBe('');
    });

    it('renders headings according to baseHeadingLevel', () => {
      const markdown = '# Main Heading\n\n## Subheading';
      const html = renderToStaticMarkup(<Markdown content={markdown} onAssetClick={noop} baseHeadingLevel={2} />);
      expect(html).toContain('<h3>Main Heading</h3>');
      expect(html).toContain('<h4>Subheading</h4>');
    });

    it('renders paragraphs with clickable asset buttons', () => {
      const content = 'The adventurer saw a @Monster[101]{Goblin} in the woods.';
      const html = renderToStaticMarkup(<Markdown content={content} onAssetClick={noop} />);
      expect(html).toContain('<p style="margin-bottom:1rem">');
      expect(html).toContain('<button type="button" class="asset-link-btn"');
      expect(html).toContain('aria-label="Open asset: Goblin"');
      expect(html).toContain('Goblin</button>');
      expect(html).toContain('<span>The adventurer saw a </span>');
      expect(html).toContain('<span> in the woods.</span>');
    });

    it('renders encounter links as external links', () => {
      const content = 'Prepare for @Encounter[enc-1]{Goblin Ambush}!';
      const html = renderToStaticMarkup(<Markdown content={content} onAssetClick={noop} />);
      expect(html).toContain('<a href="/?encounter=enc-1" target="_blank" rel="noopener noreferrer" class="encounter-link"');
      expect(html).toContain('aria-label="Run encounter: Goblin Ambush (opens in new tab)"');
      expect(html).toContain('Goblin Ambush</a>');
    });

    it('automatically ensures spacing around smooshed tags', () => {
      const content = 'use the@Monster[16829]{commoner}stat block';
      const html = renderToStaticMarkup(<Markdown content={content} onAssetClick={noop} />);
      expect(html).toContain('<span>use the </span>');
      expect(html).toContain('commoner</button>');
      expect(html).toContain('<span> stat block</span>');
    });

    it('renders bulleted lists semantically as ul and li elements', () => {
      const content = '- First item with @Item[55]{Torch}\n- Second item';
      const html = renderToStaticMarkup(<Markdown content={content} onAssetClick={noop} />);
      expect(html).toContain('<ul style="margin-bottom:1rem;padding-left:1.5rem">');
      expect(html).toContain('<li><span>First item with </span><button type="button" class="asset-link-btn"');
      expect(html).toContain('Torch</button></li>');
      expect(html).toContain('<li><span>Second item</span></li>');
      expect(html).toContain('</ul>');
    });
  });
});
