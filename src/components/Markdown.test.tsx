import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Markdown } from './Markdown';

describe('Markdown Component & AST Processing', () => {
  const noop = vi.fn();

  describe('AST Entity Tag Processing (remarkAssetTags)', () => {
    it('renders null when content is empty or whitespace-only', () => {
      expect(renderToStaticMarkup(<Markdown content="" onAssetClick={noop} />)).toBe('');
      expect(
        renderToStaticMarkup(
          <Markdown
            content={`   
  
      `}
            onAssetClick={noop}
          />
        )
      ).toBe('');
    });

    it('converts non-encounter tags to asset buttons with accessible labels', () => {
      const input = 'Meet @Monster[101]{Goblin} and cast @Spell[202]{Fireball} with @Item[303]{Staff}.';
      const html = renderToStaticMarkup(<Markdown content={input} onAssetClick={noop} />);
      expect(html).toContain('<button type="button" class="asset-link-btn" aria-label="Open asset: Goblin">Goblin</button>');
      expect(html).toContain('<button type="button" class="asset-link-btn" aria-label="Open asset: Fireball">Fireball</button>');
      expect(html).toContain('<button type="button" class="asset-link-btn" aria-label="Open asset: Staff">Staff</button>');
    });

    it('uses entity id as display name if display name is omitted', () => {
      const input = 'Cast @Spell[cure-wounds].';
      const html = renderToStaticMarkup(<Markdown content={input} onAssetClick={noop} />);
      expect(html).toContain('<button type="button" class="asset-link-btn" aria-label="Open asset: cure-wounds">cure-wounds</button>');
    });

    it('unwraps accidental double-nested tags', () => {
      const input = 'She found the @Item[1434359]{@Item[1434359]{rod of retribution}} in the sand.';
      const html = renderToStaticMarkup(<Markdown content={input} onAssetClick={noop} />);
      expect(html).toContain('<button type="button" class="asset-link-btn" aria-label="Open asset: rod of retribution">rod of retribution</button>');
      expect(html).not.toContain('@Item');
    });

    it('automatically ensures spacing around smooshed tags', () => {
      const input = 'use the@Monster[16829]{commoner}stat block';
      const html = renderToStaticMarkup(<Markdown content={input} onAssetClick={noop} />);
      expect(html).toContain('use the ');
      expect(html).toContain('commoner</button>');
      expect(html).toContain(' stat block');
    });

    it('inserts space when tag is preceded by sentence punctuation without space', () => {
      const input = 'nature,@Monster[744340]{Three Earrings} has taken';
      const html = renderToStaticMarkup(<Markdown content={input} onAssetClick={noop} />);
      expect(html).toContain('nature, ');
      expect(html).toContain('Three Earrings</button>');
      expect(html).toContain(' has taken');
    });

    it('inserts space when tag is followed by an opening parenthesis without space', () => {
      const input = 'two @Monster[744335]{sharkbody abominations}(see the sidebar)';
      const html = renderToStaticMarkup(<Markdown content={input} onAssetClick={noop} />);
      expect(html).toContain('two ');
      expect(html).toContain('sharkbody abominations</button>');
      expect(html).toContain(' (see the sidebar)');
    });

    it('preserves parentheses enclosing tags', () => {
      const input = 'use the cleric (@Monster[16848]{druid}) instead';
      const html = renderToStaticMarkup(<Markdown content={input} onAssetClick={noop} />);
      expect(html).toContain('use the cleric (<button type="button" class="asset-link-btn" aria-label="Open asset: druid">druid</button>) instead');
    });

    it('bypasses code blocks and inline code so raw tags inside code remain untouched', () => {
      const input = 'Outside @Monster[1]{Goblin} but inside `code @Monster[2]{Orc}` and:\n```\n@Item[3]{Sword}\n```';
      const html = renderToStaticMarkup(<Markdown content={input} onAssetClick={noop} />);
      // Outside tag is converted to button
      expect(html).toContain('<button type="button" class="asset-link-btn" aria-label="Open asset: Goblin">Goblin</button>');
      // Inline code keeps raw tag string
      expect(html).toContain('<code>code @Monster[2]{Orc}</code>');
      // Fenced code block keeps raw tag string
      expect(html).toContain('@Item[3]{Sword}');
    });

    it('does not corrupt user text containing placeholder patterns like __CODEBLOCK_0__ (Gap 1)', () => {
      const input = '```\nfirst code block\n```\nUser notes mentioning `__CODEBLOCK_0__` should not be replaced.';
      const html = renderToStaticMarkup(<Markdown content={input} onAssetClick={noop} />);
      expect(html).toContain('<code>__CODEBLOCK_0__</code>');
      // Verify first code block is rendered once and not duplicated by placeholder replacement
      const matches = html.match(/first code block/g);
      expect(matches?.length).toBe(1);
    });

    it('inserts space across sibling node boundaries when tag borders formatted elements (Gap 1 Boundary Blindness)', () => {
      const inputPreceding = '**strong text**@Monster[1]{Orc}';
      const htmlPreceding = renderToStaticMarkup(<Markdown content={inputPreceding} onAssetClick={noop} />);
      expect(htmlPreceding).toContain('<strong>strong text</strong> <button type="button" class="asset-link-btn" aria-label="Open asset: Orc">Orc</button>');

      const inputFollowing = '@Monster[1]{Orc}**strong text**';
      const htmlFollowing = renderToStaticMarkup(<Markdown content={inputFollowing} onAssetClick={noop} />);
      expect(htmlFollowing).toContain('<button type="button" class="asset-link-btn" aria-label="Open asset: Orc">Orc</button> <strong>strong text</strong>');

      const inputBoth = '*italic text*@Monster[1]{Orc}*more italic*';
      const htmlBoth = renderToStaticMarkup(<Markdown content={inputBoth} onAssetClick={noop} />);
      expect(htmlBoth).toContain('<em>italic text</em> <button type="button" class="asset-link-btn" aria-label="Open asset: Orc">Orc</button> <em>more italic</em>');

      const inputLink = '[Reference Link](https://example.com)@Monster[1]{Orc}';
      const htmlLink = renderToStaticMarkup(<Markdown content={inputLink} onAssetClick={noop} />);
      expect(htmlLink).toContain('</a> <button type="button" class="asset-link-btn" aria-label="Open asset: Orc">Orc</button>');
    });
  });

  describe('Gap 2: Theme Cascading & CSS Classes', () => {
    it('applies theme classes to the outer container without inline color ternaries', () => {
      const content = '# Dark Mode Heading\n@Monster[1]{Goblin}\n> quote';
      const htmlDark = renderToStaticMarkup(<Markdown content={content} onAssetClick={noop} theme="dark" />);
      expect(htmlDark).toContain('class="markdown-body markdown-body--dark"');
      // Colors are defined via CSS custom properties in index.css, not inline style ternaries
      expect(htmlDark).not.toContain('color:#ffffff');
      expect(htmlDark).not.toContain('color:#4da6ff');

      const htmlAuto = renderToStaticMarkup(<Markdown content={content} onAssetClick={noop} theme="auto" />);
      expect(htmlAuto).toContain('class="markdown-body markdown-body--auto"');

      const htmlLight = renderToStaticMarkup(<Markdown content={content} onAssetClick={noop} theme="light" />);
      expect(htmlLight).toContain('class="markdown-body markdown-body--light"');
    });
  });

  describe('Malformed asset:// links do not crash rendering', () => {
    it('renders a button instead of throwing when the id segment is an invalid percent-encoding', () => {
      const content = '[bad](asset://Monster/100%)';
      expect(() =>
        renderToStaticMarkup(<Markdown content={content} onAssetClick={noop} />)
      ).not.toThrow();
      const html = renderToStaticMarkup(<Markdown content={content} onAssetClick={noop} />);
      expect(html).toContain('<button type="button" class="asset-link-btn"');
      expect(html).toContain('>bad</button>');
    });

    it('renders a button instead of throwing when the id segment is a truncated multi-byte percent-encoding', () => {
      const content = '[bad](asset://Monster/%E0%A4%A)';
      expect(() =>
        renderToStaticMarkup(<Markdown content={content} onAssetClick={noop} />)
      ).not.toThrow();
      const html = renderToStaticMarkup(<Markdown content={content} onAssetClick={noop} />);
      expect(html).toContain('<button type="button" class="asset-link-btn"');
      expect(html).toContain('>bad</button>');
    });
  });

  describe('Gap 3: Screen Reader Links Accessibility', () => {
    it('renders encounter links without redundant aria-label, using children and sr-only span', () => {
      const content = 'Prepare for @Encounter[enc-1]{Goblin Ambush}!';
      const html = renderToStaticMarkup(<Markdown content={content} onAssetClick={noop} />);
      expect(html).toContain('<a href="/?encounter=enc-1" target="_blank" rel="noopener noreferrer" class="encounter-link"');
      // No redundant aria-label that would override or duplicate children
      expect(html).not.toContain('aria-label="Run encounter');
      // Children and screen reader notice are naturally present
      expect(html).toContain('Goblin Ambush<span class="sr-only"> (opens in a new tab)</span></a>');
    });

    it('renders external links with children and sr-only span without aria-label overrides', () => {
      const content = 'Visit [D&D Beyond](https://dndbeyond.com) for details.';
      const html = renderToStaticMarkup(<Markdown content={content} onAssetClick={noop} />);
      expect(html).toContain('<a href="https://dndbeyond.com" target="_blank" rel="noopener noreferrer">');
      expect(html).toContain('D&amp;D Beyond<span class="sr-only"> (opens in a new tab)</span></a>');
    });
  });

  describe('Standard Markdown & GFM Features', () => {
    it('renders headings normalized according to baseHeadingLevel', () => {
      const markdown = '# Main Heading\n\n## Subheading';
      const html = renderToStaticMarkup(<Markdown content={markdown} onAssetClick={noop} baseHeadingLevel={2} />);
      expect(html).toContain('<h2');
      expect(html).toContain('>Main Heading</h2>');
      expect(html).toContain('<h3');
      expect(html).toContain('>Subheading</h3>');
    });

    it('ignores faux headings inside inline code blocks when determining minDepth (Gap 2)', () => {
      // Inline code contains a multiline faux heading: `\n# Faux\n`
      // Real highest-level heading is ### (level 3)
      const markdown = '### Real Heading\n\nSome inline code `\n# Faux Heading\n` here.';
      const html = renderToStaticMarkup(<Markdown content={markdown} onAssetClick={noop} baseHeadingLevel={3} />);
      // Real Heading should be rendered as h3 (not pushed down to h5 due to faux h1 in code)
      expect(html).toContain('<h3');
      expect(html).toContain('>Real Heading</h3>');
      expect(html).not.toContain('<h5');
    });

    it('renders bulleted lists semantically as ul and li elements', () => {
      const content = '- First item with @Item[55]{Torch}\n- Second item';
      const html = renderToStaticMarkup(<Markdown content={content} onAssetClick={noop} />);
      expect(html).toContain('<ul');
      expect(html).toContain('<li');
      expect(html).toContain('First item with ');
      expect(html).toContain('<button type="button" class="asset-link-btn" aria-label="Open asset: Torch">Torch</button>');
      expect(html).toContain('Second item');
      expect(html).toContain('</ul>');
    });

    it('renders GFM tables with accessible scroll region and th scope="col"', () => {
      const markdown = `
| Creature | CR | Size |
| :--- | :--- | :--- |
| @Monster[1]{Goblin} | 1/4 | Small |
| @Monster[2]{Ogre} | 2 | Large |
`;
      const html = renderToStaticMarkup(<Markdown content={markdown} onAssetClick={noop} />);

      expect(html).toContain('role="region"');
      expect(html).toContain('aria-label="Table data"');
      expect(html).toContain('tabindex="0"');
      expect(html).toContain('<table');
      expect(html).toContain('<thead');
      expect(html).toContain('<tbody');

      const thMatches = html.match(/<th[^>]*scope="col"[^>]*>/g);
      expect(thMatches).not.toBeNull();
      expect(thMatches?.length).toBe(3);

      expect(html).toContain('Goblin</button>');
      expect(html).toContain('Ogre</button>');
      expect(html).toContain('Small</td>');
      expect(html).toContain('Large</td>');
    });

    it('renders blockquotes with semantic <blockquote>', () => {
      const markdown = '> The cavern echoes with the dripping of distant water.';
      const html = renderToStaticMarkup(<Markdown content={markdown} onAssetClick={noop} />);
      expect(html).toContain('<blockquote');
      expect(html).toContain('The cavern echoes with the dripping of distant water.');
    });

    it('renders fenced code blocks with keyboard focusable pre element', () => {
      const markdown = '```\nconst dm = "Crits & Giggles";\n```';
      const html = renderToStaticMarkup(<Markdown content={markdown} onAssetClick={noop} />);
      expect(html).toContain('<pre tabindex="0" aria-label="Code block"');
      expect(html).toContain('const dm = &quot;Crits &amp; Giggles&quot;;');
    });
  });
});
