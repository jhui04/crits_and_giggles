import { useMemo } from 'react';
import type { ComponentPropsWithoutRef } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { Components } from 'react-markdown';
import {
  remarkAssetTags,
  customUrlTransform,
  getPlainText,
} from '../utils/markdownUtils';

export interface MarkdownProps {
  /** The markdown or entity-tagged text content */
  content: string;
  /** Callback triggered when a D&D asset button is clicked */
  onAssetClick?: (id: string, tagType: string) => void;
  /** The target heading level (1-6) for the highest-level heading in content (default: 3) */
  baseHeadingLevel?: number;
  /** Color theme variant (default: 'auto') */
  theme?: 'auto' | 'light' | 'dark';
  /** Optional additional CSS class name */
  className?: string;
}

// Hoist plugins array to module scope to avoid re-instantiating the unified pipeline on every render
const REMARK_PLUGINS = [remarkGfm, remarkAssetTags];

function CodeComponent({
  className,
  children,
  style,
  node,
  ...props
}: ComponentPropsWithoutRef<'code'> & { node?: unknown }) {
  void node;
  return (
    <code className={className} style={style} {...props}>
      {children}
    </code>
  );
}

/**
 * Unified Markdown renderer across Crits & Giggles.
 * Combines full GFM table support, keyboard-accessible scroll regions, dynamic heading normalization,
 * and seamless D&D asset tag interaction (@Spell, @Monster, @Item, @World, @Campaign, @Encounter) via remark AST.
 */
export function Markdown({
  content,
  onAssetClick,
  baseHeadingLevel = 3,
  theme = 'auto',
  className,
}: MarkdownProps) {
  // Determine minimum markdown heading depth in content to guarantee no skipped heading levels
  const minDepth = useMemo(() => {
    if (!content) return 1;
    const textWithoutCode = content.replace(/(```[\s\S]*?```|`[^`]+`)/g, '');
    const matches = textWithoutCode.match(/^#{1,6}(?=\s)/gm);
    if (!matches || matches.length === 0) return 1;
    return Math.min(...matches.map((m) => m.length));
  }, [content]);

  const components = useMemo<Partial<Components>>(() => {
    const createHeading = (markdownDepth: number) => {
      const relativeOffset = Math.max(0, markdownDepth - minDepth);
      const level = Math.max(1, Math.min(6, baseHeadingLevel + relativeOffset));
      const HeadingTag = `h${level}` as 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6';
      const fontSize =
        level === 1
          ? '1.6rem'
          : level === 2
          ? '1.4rem'
          : level === 3
          ? '1.25rem'
          : level === 4
          ? '1.1rem'
          : '1rem';

      return ({
        node,
        children,
        style,
        ...props
      }: ComponentPropsWithoutRef<'h1'> & { node?: unknown }) => {
        void node;
        return (
          <HeadingTag
            {...props}
            style={{
              marginTop: '0.8rem',
              marginBottom: '0.4rem',
              fontSize,
              fontWeight: 'bold',
              ...style,
            }}
          >
            {children}
          </HeadingTag>
        );
      };
    };

    return {
      p: ({ node, children, style, ...props }) => {
        void node;
        return (
          <p style={{ margin: '0.4rem 0', ...style }} {...props}>
            {children}
          </p>
        );
      },

      ul: ({ node, children, style, ...props }) => {
        void node;
        return (
          <ul
            style={{
              paddingLeft: '1.5rem',
              margin: '0.4rem 0',
              listStyleType: 'disc',
              ...style,
            }}
            {...props}
          >
            {children}
          </ul>
        );
      },

      ol: ({ node, children, style, ...props }) => {
        void node;
        return (
          <ol
            style={{
              paddingLeft: '1.5rem',
              margin: '0.4rem 0',
              listStyleType: 'decimal',
              ...style,
            }}
            {...props}
          >
            {children}
          </ol>
        );
      },

      li: ({ node, children, style, ...props }) => {
        void node;
        return (
          <li style={{ marginBottom: '0.2rem', ...style }} {...props}>
            {children}
          </li>
        );
      },

      blockquote: ({ node, children, style, ...props }) => {
        void node;
        return (
          <blockquote style={style} {...props}>
            {children}
          </blockquote>
        );
      },

      pre: ({ node, children, style, ...props }) => {
        void node;
        return (
          <pre
            tabIndex={0}
            aria-label="Code block"
            style={style}
            {...props}
          >
            {children}
          </pre>
        );
      },

      code: CodeComponent,

      a: ({ node, href, children, style, ...props }) => {
        void node;
        if (href?.startsWith('asset://')) {
          const match = href.match(/^asset:\/\/([^/]+)\/(.+)$/);
          if (match) {
            const tagType = match[1];
            let entityId: string;
            try {
              entityId = decodeURIComponent(match[2]);
            } catch {
              entityId = match[2];
            }
            const label = getPlainText(children);
            return (
              <button
                type="button"
                className="asset-link-btn"
                onClick={() => onAssetClick?.(entityId, tagType)}
                aria-label={`Open asset: ${label}`}
                style={style}
              >
                {children}
              </button>
            );
          }
        }

        if (href?.startsWith('/?encounter=')) {
          return (
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className="encounter-link"
              style={style}
            >
              {children}
              <span className="sr-only"> (opens in a new tab)</span>
            </a>
          );
        }

        return (
          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            style={style}
            {...props}
          >
            {children}
            <span className="sr-only"> (opens in a new tab)</span>
          </a>
        );
      },

      table: ({ node, children, style, ...props }) => {
        void node;
        return (
          <div
            tabIndex={0}
            role="region"
            aria-label="Table data"
            style={{ overflowX: 'auto', margin: '0.6rem 0', maxWidth: '100%' }}
          >
            <table style={style} {...props}>
              {children}
            </table>
          </div>
        );
      },

      thead: ({ node, children, style, ...props }) => {
        void node;
        return (
          <thead style={style} {...props}>
            {children}
          </thead>
        );
      },

      tbody: ({ node, children, ...props }) => {
        void node;
        return <tbody {...props}>{children}</tbody>;
      },

      tr: ({ node, children, style, ...props }) => {
        void node;
        return (
          <tr style={style} {...props}>
            {children}
          </tr>
        );
      },

      th: ({ node, children, style, scope = 'col', ...props }) => {
        void node;
        return (
          <th
            scope={scope}
            style={style}
            {...props}
          >
            {children}
          </th>
        );
      },

      td: ({ node, children, style, ...props }) => {
        void node;
        return (
          <td style={style} {...props}>
            {children}
          </td>
        );
      },

      del: ({ node, children, style, ...props }) => {
        void node;
        return (
          <del style={style} {...props}>
            <span className="sr-only">[deleted: </span>
            {children}
            <span className="sr-only">]</span>
          </del>
        );
      },

      input: ({ node, type, checked, disabled: _disabled, ...props }) => {
        void node;
        void _disabled;
        if (type === 'checkbox') {
          return (
            <input
              type="checkbox"
              checked={checked}
              disabled
              tabIndex={-1}
              aria-label={checked ? 'Completed item' : 'Incomplete item'}
              style={{ marginRight: '0.4rem', verticalAlign: 'middle', cursor: 'default' }}
              {...props}
            />
          );
        }
        return <input type={type} checked={checked} {...props} />;
      },

      hr: ({ node, style, ...props }) => {
        void node;
        return <hr style={style} {...props} />;
      },

      img: ({ node, alt, style, ...props }) => {
        void node;
        return (
          <img
            alt={alt || ''}
            style={style}
            {...props}
          />
        );
      },

      h1: createHeading(1),
      h2: createHeading(2),
      h3: createHeading(3),
      h4: createHeading(4),
      h5: createHeading(5),
      h6: createHeading(6),
    };
  }, [baseHeadingLevel, minDepth, onAssetClick]);

  if (!content || !content.trim()) return null;

  const classNameCombined = `markdown-body markdown-body--${theme} ${className || ''}`.trim();

  return (
    <div className={classNameCombined}>
      <ReactMarkdown
        remarkPlugins={REMARK_PLUGINS}
        urlTransform={customUrlTransform}
        components={components}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
