import React, { createContext, useContext, useMemo } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { Components } from 'react-markdown';

export interface AssistantMarkdownProps {
  content: string;
  baseHeadingLevel?: number;
}

const PreContext = createContext<boolean>(false);

// Hoist plugins array to module scope to avoid re-instantiating the unified pipeline on every render
const REMARK_PLUGINS = [remarkGfm];

function CodeComponent({
  className,
  children,
  style,
  node,
  ...props
}: React.ComponentPropsWithoutRef<'code'> & { node?: unknown }) {
  void node;
  const isInsidePre = useContext(PreContext);
  if (isInsidePre) {
    return (
      <code className={className} style={{ fontFamily: 'monospace', ...style }} {...props}>
        {children}
      </code>
    );
  }

  return (
    <code
      style={{
        backgroundColor: '#2a2a2a',
        padding: '0.1rem 0.35rem',
        borderRadius: '3px',
        fontFamily: 'monospace',
        color: '#4da6ff',
        ...style,
      }}
      {...props}
    >
      {children}
    </code>
  );
}

// Static component definitions to prevent re-creation during re-renders
const STATIC_COMPONENTS: Partial<Components> = {
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
      <blockquote
        style={{
          borderLeft: '4px solid #0066cc',
          paddingLeft: '0.8rem',
          margin: '0.5rem 0',
          color: '#ccc',
          fontStyle: 'italic',
          backgroundColor: '#161616',
          paddingTop: '0.2rem',
          paddingBottom: '0.2rem',
          ...style,
        }}
        {...props}
      >
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
        style={{
          backgroundColor: '#111',
          border: '1px solid #333',
          borderRadius: '4px',
          padding: '0.6rem',
          overflowX: 'auto',
          fontFamily: 'monospace',
          fontSize: '0.85rem',
          margin: '0.5rem 0',
          ...style,
        }}
        {...props}
      >
        <PreContext.Provider value={true}>{children}</PreContext.Provider>
      </pre>
    );
  },

  code: CodeComponent,

  a: ({ node, children, href, style, ...props }) => {
    void node;
    return (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        style={{ color: '#4da6ff', textDecoration: 'underline', ...style }}
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
        style={{ overflowX: 'auto', margin: '0.6rem 0' }}
      >
        <table
          style={{
            width: '100%',
            borderCollapse: 'collapse',
            border: '1px solid #444',
            fontSize: '0.9rem',
            ...style,
          }}
          {...props}
        >
          {children}
        </table>
      </div>
    );
  },

  thead: ({ node, children, style, ...props }) => {
    void node;
    return (
      <thead
        style={{
          backgroundColor: '#222',
          borderBottom: '2px solid #555',
          ...style,
        }}
        {...props}
      >
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
      <tr style={{ borderBottom: '1px solid #333', ...style }} {...props}>
        {children}
      </tr>
    );
  },

  th: ({ node, children, style, scope = 'col', ...props }) => {
    void node;
    return (
      <th
        scope={scope}
        style={{
          padding: '0.4rem 0.6rem',
          border: '1px solid #444',
          textAlign: 'left',
          fontWeight: 'bold',
          color: '#ffffff',
          ...style,
        }}
        {...props}
      >
        {children}
      </th>
    );
  },

  td: ({ node, children, style, ...props }) => {
    void node;
    return (
      <td
        style={{
          padding: '0.4rem 0.6rem',
          border: '1px solid #333',
          color: '#dddddd',
          ...style,
        }}
        {...props}
      >
        {children}
      </td>
    );
  },

  del: ({ node, children, style, ...props }) => {
    void node;
    return (
      <del
        style={{
          textDecoration: 'line-through',
          color: '#a0a0a0', // Meets 4.5:1 WCAG AA contrast ratio on dark #222 background (6.2:1)
          ...style,
        }}
        {...props}
      >
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
    return (
      <hr
        style={{
          borderColor: '#444',
          borderStyle: 'solid',
          borderWidth: '1px 0 0 0',
          margin: '0.8rem 0',
          ...style,
        }}
        {...props}
      />
    );
  },

  img: ({ node, alt, style, ...props }) => {
    void node;
    return (
      <img
        alt={alt || ''}
        style={{
          maxWidth: '100%',
          height: 'auto',
          borderRadius: '4px',
          ...style,
        }}
        {...props}
      />
    );
  },
};

/**
 * Parses markdown into strictly accessible semantic HTML using react-markdown and remark-gfm.
 * Ensures blind DMs can navigate responses rapidly via screen reader heading (H), table (T),
 * and list (L/I) shortcuts without skipped heading levels or malformed landmarks.
 */
export function AssistantMarkdown({
  content,
  baseHeadingLevel = 3,
}: AssistantMarkdownProps) {
  // Determine minimum markdown heading depth in content to guarantee no skipped heading levels under modal H2
  const minDepth = useMemo(() => {
    if (!content) return 1;
    const textWithoutCode = content.replace(/```[\s\S]*?```/g, '');
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
      }: React.ComponentPropsWithoutRef<'h1'> & { node?: unknown }) => {
        void node;
        return (
          <HeadingTag
            {...props}
            style={{
              marginTop: '0.8rem',
              marginBottom: '0.4rem',
              color: '#ffffff',
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
      ...STATIC_COMPONENTS,
      h1: createHeading(1),
      h2: createHeading(2),
      h3: createHeading(3),
      h4: createHeading(4),
      h5: createHeading(5),
      h6: createHeading(6),
    };
  }, [baseHeadingLevel, minDepth]);

  if (!content || !content.trim()) return null;

  return (
    <div className="assistant-markdown-body" style={{ lineHeight: '1.6' }}>
      <Markdown remarkPlugins={REMARK_PLUGINS} components={components}>
        {content}
      </Markdown>
    </div>
  );
}
