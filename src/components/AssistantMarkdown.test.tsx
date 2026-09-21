import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { AssistantMarkdown } from './AssistantMarkdown';

describe('AssistantMarkdown Component', () => {
  it('renders nothing when content is empty or whitespace-only', () => {
    const emptyHtml = renderToStaticMarkup(<AssistantMarkdown content="" />);
    expect(emptyHtml).toBe('');

    const whitespaceHtml = renderToStaticMarkup(
      <AssistantMarkdown
        content={`   
  
      `}
      />
    );
    expect(whitespaceHtml).toBe('');
  });

  it('renders headings with baseHeadingLevel = 3 by default (no h1 or h2)', () => {
    const markdown = '# Heading 1\n## Heading 2\n### Heading 3\n#### Heading 4';
    const html = renderToStaticMarkup(<AssistantMarkdown content={markdown} />);

    expect(html).not.toContain('<h1');
    expect(html).not.toContain('<h2');
    expect(html).toContain('<h3');
    expect(html).toContain('>Heading 1</h3>');
    expect(html).toContain('<h4');
    expect(html).toContain('>Heading 2</h4>');
    expect(html).toContain('<h5');
    expect(html).toContain('>Heading 3</h5>');
    expect(html).toContain('<h6');
    expect(html).toContain('>Heading 4</h6>');
  });

  it('normalizes top heading to baseHeadingLevel preventing skipped levels and caps at h6', () => {
    // When LLM starts with ### without #, it starts at baseHeadingLevel (h3) to prevent skipped levels under modal h2
    const isolatedH3 = '### Combat Overview\n#### Actions';
    const htmlH3 = renderToStaticMarkup(<AssistantMarkdown content={isolatedH3} />);
    expect(htmlH3).toContain('<h3');
    expect(htmlH3).toContain('>Combat Overview</h3>');
    expect(htmlH3).toContain('<h4');
    expect(htmlH3).toContain('>Actions</h4>');

    // Capping at h6
    const deepMarkdown = '# H1\n## H2\n### H3\n#### H4\n##### H5\n###### H6';
    const htmlDeep = renderToStaticMarkup(<AssistantMarkdown content={deepMarkdown} />);
    expect(htmlDeep).not.toContain('<h7');
    expect(htmlDeep).toContain('>H4</h6>');
    expect(htmlDeep).toContain('>H5</h6>');
    expect(htmlDeep).toContain('>H6</h6>');

    // Clamps invalid low baseHeadingLevel to h1 minimum
    const htmlLow = renderToStaticMarkup(
      <AssistantMarkdown content="# Heading" baseHeadingLevel={0} />
    );
    expect(htmlLow).toContain('<h1');
    expect(htmlLow).not.toContain('<h0');
  });

  it('respects custom baseHeadingLevel', () => {
    const markdown = '# Custom H2\n## Custom H3';
    const html = renderToStaticMarkup(
      <AssistantMarkdown content={markdown} baseHeadingLevel={2} />
    );

    expect(html).toContain('<h2');
    expect(html).toContain('>Custom H2</h2>');
    expect(html).toContain('<h3');
    expect(html).toContain('>Custom H3</h3>');
  });

  it('renders GFM tables with scope="col" on th elements and keyboard-accessible scroll region', () => {
    const markdown = `
| Spell | Level | School |
| :--- | :--- | :--- |
| Fireball | 3 | Evocation |
| Cure Wounds | 1 | Abjuration |
`;
    const html = renderToStaticMarkup(<AssistantMarkdown content={markdown} />);

    expect(html).toContain('role="region"');
    expect(html).toContain('aria-label="Table data"');
    expect(html).toContain('tabindex="0"');
    expect(html).toContain('<table');
    expect(html).toContain('<thead');
    expect(html).toContain('<tbody');

    // Verify each th has scope="col"
    const thMatches = html.match(/<th[^>]*scope="col"[^>]*>/g);
    expect(thMatches).not.toBeNull();
    expect(thMatches?.length).toBe(3);
    expect(html).toContain('Fireball');
    expect(html).toContain('Evocation');
  });

  it('renders table columns with alignment preserved', () => {
    const markdown = `
| Left | Center | Right |
| :--- | :---: | ---: |
| L | C | R |
`;
    const html = renderToStaticMarkup(<AssistantMarkdown content={markdown} />);
    expect(html).toContain('text-align:center');
    expect(html).toContain('text-align:right');
  });

  it('renders unordered, ordered, and nested lists with semantic HTML', () => {
    const markdown = `
- Bullet 1
- Bullet 2
  - Nested Bullet

1. Step 1
2. Step 2
`;
    const html = renderToStaticMarkup(<AssistantMarkdown content={markdown} />);

    expect(html).toContain('<ul');
    expect(html).toContain('<ol');
    expect(html).toContain('>Bullet 1</li>');
    expect(html).toContain('>Step 1</li>');
    expect(html).toContain('>Nested Bullet</li>');
  });

  it('renders GFM task list checkboxes with aria-labels and tabIndex={-1} for screen readers', () => {
    const markdown = '- [x] Completed task\n- [ ] Pending task';
    const html = renderToStaticMarkup(<AssistantMarkdown content={markdown} />);

    expect(html).toContain('aria-label="Completed item"');
    expect(html).toContain('aria-label="Incomplete item"');
    expect(html).toContain('tabindex="-1"');
    expect(html).toContain('disabled=""');
    expect(html).toContain('type="checkbox"');
  });

  it('renders links with target="_blank", rel="noopener noreferrer", and sr-only new tab notification', () => {
    const markdown = '[D&D Beyond](https://dndbeyond.com)';
    const html = renderToStaticMarkup(<AssistantMarkdown content={markdown} />);

    expect(html).toContain('href="https://dndbeyond.com"');
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).toContain('>D&amp;D Beyond');
    expect(html).toContain('<span class="sr-only"> (opens in a new tab)</span>');
  });

  it('renders blockquotes, bold, italic, and accessible strikethrough (del) with sr-only deleted indicators', () => {
    const markdown = '> Authoritative rule\n\n**bold** *italic* ~strikethrough~';
    const html = renderToStaticMarkup(<AssistantMarkdown content={markdown} />);

    expect(html).toContain('<blockquote');
    expect(html).toContain('<strong>bold</strong>');
    expect(html).toContain('<em>italic</em>');
    expect(html).toContain('<del');
    expect(html).toContain('<span class="sr-only">[deleted: </span>');
    expect(html).toContain('<span class="sr-only">]</span>');
    expect(html).toContain('strikethrough');
  });

  it('renders code blocks in pre elements with tabIndex={0}, aria-label, and inline code with chip styling', () => {
    const markdown = 'Inline `dice_roll` test.\n\n```python\nprint("hello")\n```';
    const html = renderToStaticMarkup(<AssistantMarkdown content={markdown} />);

    expect(html).toContain('<pre');
    expect(html).toContain('tabindex="0"');
    expect(html).toContain('aria-label="Code block"');
    expect(html).toContain('class="language-python"');
    expect(html).toContain('print(&quot;hello&quot;)');
    expect(html).toContain('dice_roll');
  });

  it('renders horizontal rules (hr) and images (img) cleanly', () => {
    const markdown = 'Above\n\n---\n\nBelow\n\n![Map](https://example.com/map.png)';
    const html = renderToStaticMarkup(<AssistantMarkdown content={markdown} />);

    expect(html).toContain('<hr');
    expect(html).toContain('<img');
    expect(html).toContain('alt="Map"');
    expect(html).toContain('src="https://example.com/map.png"');
  });
});

