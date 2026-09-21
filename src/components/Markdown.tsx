import React from 'react';
import type { ReactNode } from 'react';

interface MarkdownProps {
  content: string;
  onAssetClick: (id: string, tagType: string) => void;
  baseHeadingLevel?: number;
}

/**
 * Normalizes spacing around asset tags to handle any lingering legacy or pasted formatting:
 * 1. Unwraps accidental duplicate nesting: @Tag[id]{@Tag[id]{name}} -> @Tag[id]{name}
 * 2. Adds whitespace before tags if directly preceded by alphanumeric chars or sentence punctuation without space.
 * 3. Adds whitespace after tags if directly followed by alphanumeric chars or opening parenthesis.
 */
export function normalizeTagSpacing(text: string): string {
  if (!text) return text;
  
  // 1. Unwrap accidental double-nested tags
  let normalized = text.replace(
    /@(Spell|Monster|Item|World|Campaign|Encounter)\[([^\]]+)\]\{@(Spell|Monster|Item|World|Campaign|Encounter)\[\2\]\{([^}]+)\}\}/g,
    '@$1[$2]{$4}'
  );

  // 2. Add space before tag if preceded by alphanumeric char or sentence punctuation (,.!?;:)
  normalized = normalized.replace(/([a-zA-Z0-9,.:;?!])(@(?:Spell|Monster|Item|World|Campaign|Encounter)\[)/g, '$1 $2');

  // 3. Add space after tag if followed by alphanumeric char or opening parenthesis
  normalized = normalized.replace(/(@(?:Spell|Monster|Item|World|Campaign|Encounter)\[[^\]]+\]\{[^}]+\})([a-zA-Z0-9(])/g, '$1 $2');

  return normalized;
}

/**
 * A component wrapper for the custom markdown parser to avoid ref-related lint issues.
 */
export function Markdown({ 
  content, 
  onAssetClick, 
  baseHeadingLevel = 3 
}: MarkdownProps) {
  if (!content) return null;

  const normalizedContent = normalizeTagSpacing(content);

  // Split into paragraphs/blocks based on double newlines
  const blocks = normalizedContent.split(/\n\s*\n/).map(b => b.trim()).filter(b => b);

  const renderInline = (text: string, keyPrefix: string): ReactNode[] => {
    const inlineElements: ReactNode[] = [];
    const linkRegex = /@(Spell|Monster|Item|World|Campaign|Encounter)\[([^\]]+)\](?:\{([^}]+)\})?/g;
    
    let lastIndex = 0;
    let match: RegExpExecArray | null;

    while ((match = linkRegex.exec(text)) !== null) {
      if (match.index > lastIndex) {
        inlineElements.push(
          <span key={`${keyPrefix}-text-${lastIndex}`}>
            {text.slice(lastIndex, match.index)}
          </span>
        );
      }

      const type = match[1];
      const entityId = match[2];
      const displayName = match[3] || entityId;

      if (type !== 'Encounter') {
        inlineElements.push(
          <button 
            type="button"
            key={`${keyPrefix}-${type}-${entityId}-${match.index}`}
            onClick={() => onAssetClick(entityId, type)}
            className="asset-link-btn"
            style={{
              background: 'none',
              border: 'none',
              color: '#0066cc',
              textDecoration: 'underline',
              cursor: 'pointer',
              padding: 0,
              font: 'inherit',
              fontWeight: 'bold',
              display: 'inline'
            }}
            aria-label={`Open asset: ${displayName}`}
          >
            {displayName}
          </button>
        );
      } else {
        inlineElements.push(
          <a 
            key={`${keyPrefix}-${type}-${entityId}-${match.index}`}
            href={`/?encounter=${entityId}`}
            target="_blank"
            rel="noopener noreferrer"
            className="encounter-link"
            style={{
              color: '#cc0000',
              textDecoration: 'underline',
              cursor: 'pointer',
              fontWeight: 'bold',
              display: 'inline'
            }}
            aria-label={`Run encounter: ${displayName} (opens in new tab)`}
          >
            {displayName}
          </a>
        );
      }

      lastIndex = linkRegex.lastIndex;
    }

    if (lastIndex < text.length) {
      inlineElements.push(
        <span key={`${keyPrefix}-text-${lastIndex}`}>
          {text.slice(lastIndex)}
        </span>
      );
    }

    return inlineElements;
  };

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

        // Check if it's a list (all non-empty lines start with - or *)
        const lines = block.split('\n').map(l => l.trim()).filter(l => l);
        const isList = lines.length > 0 && lines.every(l => /^[-*]\s+/.test(l));

        if (isList) {
          return (
            <ul key={blockIndex} style={{ marginBottom: '1rem', paddingLeft: '1.5rem' }}>
              {lines.map((line, lineIndex) => {
                const itemContent = line.replace(/^[-*]\s+/, '');
                return (
                  <li key={lineIndex}>
                    {renderInline(itemContent, `${blockIndex}-${lineIndex}`)}
                  </li>
                );
              })}
            </ul>
          );
        }

        return (
          <p key={blockIndex} style={{ marginBottom: '1rem' }}>
            {renderInline(block, `${blockIndex}`)}
          </p>
        );
      })}
    </>
  );
}
