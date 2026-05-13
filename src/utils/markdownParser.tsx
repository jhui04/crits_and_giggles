import React from 'react';
import type { ReactNode } from 'react';

/**
 * A lightweight custom parser for rendering Campaign Chapters.
 * Supports:
 * - Paragraphs (double newline separation)
 * - Headings (e.g., "# Heading 1")
 * - Custom Asset Links (e.g., "@Asset[asset-id]{Display Name}")
 * - Custom Encounter Links (e.g., "@Encounter[encounter-id]{Display Name}")
 */

export function parseMarkdown(
  text: string, 
  onAssetClick: (id: string) => void,
  onEncounterClick: (id: string) => void = () => {},
  baseHeadingLevel: number = 3
): ReactNode[] {
  if (!text) return [];

  // Split into paragraphs/blocks based on double newlines
  const blocks = text.split(/\n\s*\n/).map(b => b.trim()).filter(b => b);

  return blocks.map((block, blockIndex) => {
    // Check if it's a heading
    const headingMatch = block.match(/^(#+)\s+(.*)$/);
    if (headingMatch) {
      const level = Math.min(headingMatch[1].length + baseHeadingLevel, 6);
      const content = headingMatch[2];
      const HeadingTag = `h${level}`;
      return React.createElement(HeadingTag, { key: blockIndex }, content);
    }

    // Otherwise, parse as a paragraph containing potential inline asset links
    // Syntax: @Asset[id]{Display Name} or @Encounter[id]{Display Name}
    const inlineElements: ReactNode[] = [];
    
    const linkRegex = /@(Asset|Encounter)\[([^\]]+)\](?:\{([^}]+)\})?/g;
    
    let lastIndex = 0;
    let match;

    while ((match = linkRegex.exec(block)) !== null) {
      if (match.index > lastIndex) {
        inlineElements.push(<span key={`${blockIndex}-text-${lastIndex}`}>{block.slice(lastIndex, match.index)}</span>);
      }

      const type = match[1];
      const entityId = match[2];
      const displayName = match[3] || entityId;

      inlineElements.push(
        <button 
          type="button"
          key={`${blockIndex}-${type}-${entityId}-${match.index}`}
          onClick={() => type === 'Asset' ? onAssetClick(entityId) : onEncounterClick(entityId)}
          className={`${type.toLowerCase()}-link-btn`}
          style={{
            background: 'none',
            border: 'none',
            color: type === 'Asset' ? '#0066cc' : '#cc0000',
            textDecoration: 'underline',
            cursor: 'pointer',
            padding: 0,
            font: 'inherit',
            fontWeight: 'bold'
          }}
          aria-label={`Open ${type.toLowerCase()}: ${displayName}`}
        >
          {displayName}
        </button>
      );

      lastIndex = linkRegex.lastIndex;
    }

    if (lastIndex < block.length) {
      inlineElements.push(<span key={`${blockIndex}-text-${lastIndex}`}>{block.slice(lastIndex)}</span>);
    }

    return <p key={blockIndex} style={{ marginBottom: '1rem' }}>{inlineElements}</p>;
  });
}
