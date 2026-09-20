import type { ReactNode } from 'react';

interface AssistantMarkdownProps {
  content: string;
  baseHeadingLevel?: number;
}

type ParsedBlock =
  | { type: 'heading'; level: number; text: string }
  | { type: 'ul'; items: string[] }
  | { type: 'ol'; items: string[] }
  | { type: 'blockquote'; text: string }
  | { type: 'codeblock'; code: string; lang?: string }
  | { type: 'paragraph'; text: string };

/**
 * Parses markdown into strictly accessible semantic HTML.
 * Ensures blind DMs can navigate responses rapidly via screen reader heading (H) and list (L/I) shortcuts.
 */
export function AssistantMarkdown({
  content,
  baseHeadingLevel = 3,
}: AssistantMarkdownProps) {
  if (!content) return null;

  const renderInline = (text: string): ReactNode[] => {
    // Matches: **bold**, `code`, *italic*, or [link](url)
    const tokens: ReactNode[] = [];
    const regex = /(\*\*([^*]+)\*\*|`([^`]+)`|\*([^*]+)\*|\[([^\]]+)\]\(([^)]+)\))/g;
    let lastIdx = 0;
    let match: RegExpExecArray | null;

    while ((match = regex.exec(text)) !== null) {
      if (match.index > lastIdx) {
        tokens.push(text.slice(lastIdx, match.index));
      }

      if (match[2]) {
        // Bold
        tokens.push(<strong key={`b-${match.index}`}>{match[2]}</strong>);
      } else if (match[3]) {
        // Inline code
        tokens.push(
          <code
            key={`c-${match.index}`}
            style={{
              backgroundColor: '#2a2a2a',
              padding: '0.1rem 0.35rem',
              borderRadius: '3px',
              fontFamily: 'monospace',
              color: '#4da6ff',
            }}
          >
            {match[3]}
          </code>
        );
      } else if (match[4]) {
        // Italic
        tokens.push(<em key={`i-${match.index}`}>{match[4]}</em>);
      } else if (match[5] && match[6]) {
        // Link
        tokens.push(
          <a
            key={`a-${match.index}`}
            href={match[6]}
            target="_blank"
            rel="noopener noreferrer"
            style={{ color: '#4da6ff', textDecoration: 'underline' }}
          >
            {match[5]}
          </a>
        );
      }

      lastIdx = regex.lastIndex;
    }

    if (lastIdx < text.length) {
      tokens.push(text.slice(lastIdx));
    }

    return tokens;
  };

  // Line-by-line block parsing
  const lines = content.replace(/\r\n/g, '\n').split('\n');
  const blocks: ParsedBlock[] = [];

  let currentPara: string[] = [];
  let currentUl: string[] = [];
  let currentOl: string[] = [];
  let currentBq: string[] = [];
  let inCodeBlock = false;
  let codeBlockLines: string[] = [];
  let codeBlockLang = '';

  const flushParagraph = () => {
    if (currentPara.length > 0) {
      blocks.push({ type: 'paragraph', text: currentPara.join(' ') });
      currentPara = [];
    }
  };

  const flushUl = () => {
    if (currentUl.length > 0) {
      blocks.push({ type: 'ul', items: [...currentUl] });
      currentUl = [];
    }
  };

  const flushOl = () => {
    if (currentOl.length > 0) {
      blocks.push({ type: 'ol', items: [...currentOl] });
      currentOl = [];
    }
  };

  const flushBq = () => {
    if (currentBq.length > 0) {
      blocks.push({ type: 'blockquote', text: currentBq.join(' ') });
      currentBq = [];
    }
  };

  const flushAll = () => {
    flushParagraph();
    flushUl();
    flushOl();
    flushBq();
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Fenced code block toggle
    if (line.trim().startsWith('```')) {
      if (inCodeBlock) {
        blocks.push({
          type: 'codeblock',
          code: codeBlockLines.join('\n'),
          lang: codeBlockLang,
        });
        inCodeBlock = false;
        codeBlockLines = [];
        codeBlockLang = '';
      } else {
        flushAll();
        inCodeBlock = true;
        codeBlockLang = line.trim().slice(3).trim();
      }
      continue;
    }

    if (inCodeBlock) {
      codeBlockLines.push(line);
      continue;
    }

    // Blank line
    if (!line.trim()) {
      flushAll();
      continue;
    }

    // Heading: #, ##, ###, etc.
    const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
    if (headingMatch) {
      flushAll();
      const depth = headingMatch[1].length;
      const level = Math.min(depth + baseHeadingLevel - 1, 6);
      blocks.push({ type: 'heading', level, text: headingMatch[2].trim() });
      continue;
    }

    // Blockquote: > text
    const bqMatch = line.match(/^>\s?(.*)$/);
    if (bqMatch) {
      flushParagraph();
      flushUl();
      flushOl();
      currentBq.push(bqMatch[1]);
      continue;
    }

    // Unordered list item: - text or * text
    const ulMatch = line.match(/^\s*[-*]\s+(.+)$/);
    if (ulMatch) {
      flushParagraph();
      flushOl();
      flushBq();
      currentUl.push(ulMatch[1]);
      continue;
    }

    // Ordered list item: 1. text
    const olMatch = line.match(/^\s*\d+\.\s+(.+)$/);
    if (olMatch) {
      flushParagraph();
      flushUl();
      flushBq();
      currentOl.push(olMatch[1]);
      continue;
    }

    // Normal text line
    if (currentUl.length > 0 && line.startsWith('  ')) {
      // Indented continuation of previous list item
      currentUl[currentUl.length - 1] += ' ' + line.trim();
    } else if (currentOl.length > 0 && line.startsWith('  ')) {
      // Indented continuation of previous ordered item
      currentOl[currentOl.length - 1] += ' ' + line.trim();
    } else {
      flushUl();
      flushOl();
      flushBq();
      currentPara.push(line.trim());
    }
  }

  flushAll();

  return (
    <div className="assistant-markdown-body" style={{ lineHeight: '1.6' }}>
      {blocks.map((block, blockIdx) => {
        switch (block.type) {
          case 'heading': {
            const HeadingTag = `h${block.level}` as 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6';
            return (
              <HeadingTag
                key={`h-${blockIdx}`}
                style={{
                  marginTop: '0.8rem',
                  marginBottom: '0.4rem',
                  color: '#ffffff',
                  fontSize: block.level === 3 ? '1.25rem' : block.level === 4 ? '1.1rem' : '1rem',
                  fontWeight: 'bold',
                }}
              >
                {renderInline(block.text)}
              </HeadingTag>
            );
          }

          case 'ul':
            return (
              <ul
                key={`ul-${blockIdx}`}
                style={{
                  paddingLeft: '1.5rem',
                  margin: '0.4rem 0',
                  listStyleType: 'disc',
                }}
              >
                {block.items.map((item, lineIdx) => (
                  <li key={`li-${blockIdx}-${lineIdx}`} style={{ marginBottom: '0.2rem' }}>
                    {renderInline(item)}
                  </li>
                ))}
              </ul>
            );

          case 'ol':
            return (
              <ol
                key={`ol-${blockIdx}`}
                style={{
                  paddingLeft: '1.5rem',
                  margin: '0.4rem 0',
                  listStyleType: 'decimal',
                }}
              >
                {block.items.map((item, lineIdx) => (
                  <li key={`oli-${blockIdx}-${lineIdx}`} style={{ marginBottom: '0.2rem' }}>
                    {renderInline(item)}
                  </li>
                ))}
              </ol>
            );

          case 'blockquote':
            return (
              <blockquote
                key={`bq-${blockIdx}`}
                style={{
                  borderLeft: '4px solid #0066cc',
                  paddingLeft: '0.8rem',
                  margin: '0.5rem 0',
                  color: '#ccc',
                  fontStyle: 'italic',
                  backgroundColor: '#161616',
                  paddingTop: '0.2rem',
                  paddingBottom: '0.2rem',
                }}
              >
                {renderInline(block.text)}
              </blockquote>
            );

          case 'codeblock':
            return (
              <pre
                key={`cb-${blockIdx}`}
                style={{
                  backgroundColor: '#111',
                  border: '1px solid #333',
                  borderRadius: '4px',
                  padding: '0.6rem',
                  overflowX: 'auto',
                  fontFamily: 'monospace',
                  fontSize: '0.85rem',
                }}
              >
                <code>{block.code}</code>
              </pre>
            );

          case 'paragraph':
          default:
            return (
              <p key={`p-${blockIdx}`} style={{ margin: '0.4rem 0' }}>
                {renderInline(block.text)}
              </p>
            );
        }
      })}
    </div>
  );
}
