import React from 'react';
import type { ReactNode } from 'react';

interface MarkdownProps {
  content: string;
  onAssetClick: (id: string) => void;
  onEncounterClick?: (id: string) => void;
  baseHeadingLevel?: number;
}

/**
 * A component wrapper for the custom markdown parser to avoid ref-related lint issues.
 */
export function Markdown({ 
  content, 
  onAssetClick, 
  onEncounterClick = () => {}, 
  baseHeadingLevel = 3 
}: MarkdownProps) {
  if (!content) return null;

  // Split into paragraphs/blocks based on double newlines
  const blocks = content.split(/\n\s*\n/).map(b => b.trim()).filter(b => b);

  return (
    <>
      {blocks.map((block, blockIndex) => {
        // Check if it's a heading
        const headingMatch = block.match(/^(#+)\s+(.*)$/);
        if (headingMatch) {
          const level = Math.min(headingMatch[1].length + baseHeadingLevel, 6);
          const text = headingMatch[2];
          const HeadingTag = `h${level}` as 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6';
          return React.createElement(HeadingTag, { key: blockIndex }, text);
        }

        // Otherwise, parse as a paragraph containing potential inline asset links
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
      })}
    </>
  );
}
