import React from 'react';
import type { ReactNode } from 'react';
import { defaultUrlTransform } from 'react-markdown';
import { visit } from 'unist-util-visit';

interface AstNode {
  type: string;
  value?: string;
  url?: string;
  children?: AstNode[];
  [key: string]: unknown;
}

/**
 * Recursively extracts the text content of the last leaf node in an AST tree.
 */
function getLastText(node: AstNode): string {
  if (!node) return '';
  if (typeof node.value === 'string') return node.value;
  if (Array.isArray(node.children) && node.children.length > 0) {
    for (let i = node.children.length - 1; i >= 0; i--) {
      const text = getLastText(node.children[i]);
      if (text) return text;
    }
  }
  return '';
}

/**
 * Recursively extracts the text content of the first leaf node in an AST tree.
 */
function getFirstText(node: AstNode): string {
  if (!node) return '';
  if (typeof node.value === 'string') return node.value;
  if (Array.isArray(node.children) && node.children.length > 0) {
    for (let i = 0; i < node.children.length; i++) {
      const text = getFirstText(node.children[i]);
      if (text) return text;
    }
  }
  return '';
}

/**
 * Remark AST plugin that traverses text nodes in the markdown AST and transforms D&D entity tags:
 *   @(Spell|Monster|Item|World|Campaign|Encounter)[id]{displayName}
 * or
 *   @(Spell|Monster|Item|World|Campaign|Encounter)[id]
 *
 * into standard AST link nodes:
 *   - asset://Type/id for Spell, Monster, Item, World, Campaign
 *   - /?encounter=id for Encounter
 *
 * Benefits of AST processing:
 * 1. Bypasses code blocks (```...```) and inline code (`...`) naturally since mdast classifies them as 'code' and 'inlineCode' nodes, not 'text' nodes.
 * 2. Completely eliminates placeholder string masking (no __CODEBLOCK_n__ vulnerabilities).
 * 3. Normalizes accidental double-nesting, intra-node tag spacing, and sibling boundary spacing (e.g. adjacent to strong/em).
 */
export function remarkAssetTags() {
  return (tree: AstNode) => {
    visit(tree, 'text', (node: AstNode, index: number | undefined, parent: AstNode | undefined) => {
      if (!parent || typeof index !== 'number' || !Array.isArray(parent.children)) {
        return;
      }
      // Never transform tags inside an existing link to prevent invalid nested anchor tags
      if (parent.type === 'link') {
        return;
      }

      let text = node.value || '';

      // Check boundary with preceding sibling (e.g. **strong**@Monster or *italic*@Spell)
      if (/^@(Spell|Monster|Item|World|Campaign|Encounter)\[/.test(text) && index > 0) {
        const prevSibling = parent.children[index - 1];
        const lastText = getLastText(prevSibling);
        if (/[a-zA-Z0-9,.:;?!]$/.test(lastText)) {
          text = ' ' + text;
        }
      }

      // Check boundary with following sibling (e.g. @Monster**strong** or @Monster*italic*)
      if (
        /@(Spell|Monster|Item|World|Campaign|Encounter)\[[^\]]+\](?:\{[^}]+\})?$/.test(text) &&
        index < parent.children.length - 1
      ) {
        const nextSibling = parent.children[index + 1];
        const firstText = getFirstText(nextSibling);
        if (/^[a-zA-Z0-9(@]/.test(firstText)) {
          text = text + ' ';
        }
      }

      // 1. Unwrap accidental double-nested tags: @Tag[id]{@Tag[id]{name}} -> @Tag[id]{name}
      text = text.replace(
        /@(Spell|Monster|Item|World|Campaign|Encounter)\[([^\]]+)\]\{@(Spell|Monster|Item|World|Campaign|Encounter)\[\2\]\{([^}]+)\}\}/g,
        '@$1[$2]{$4}'
      );

      // 2. Add space before tag if preceded by alphanumeric char or sentence punctuation (,.!?;:)
      text = text.replace(
        /([a-zA-Z0-9,.:;?!])(@(?:Spell|Monster|Item|World|Campaign|Encounter)\[)/g,
        '$1 $2'
      );

      // 3. Add space after tag if followed by alphanumeric char, opening parenthesis, or another tag
      text = text.replace(
        /(@(?:Spell|Monster|Item|World|Campaign|Encounter)\[[^\]]+\](?:\{[^}]+\})?)([a-zA-Z0-9(@])/g,
        '$1 $2'
      );

      const tagRegex = /@(Spell|Monster|Item|World|Campaign|Encounter)\[([^\]]+)\](?:\{([^}]+)\})?/g;
      if (!tagRegex.test(text)) {
        node.value = text;
        return;
      }

      tagRegex.lastIndex = 0;
      const replacementNodes: AstNode[] = [];
      let lastIndex = 0;
      let match: RegExpExecArray | null;

      while ((match = tagRegex.exec(text)) !== null) {
        if (match.index > lastIndex) {
          replacementNodes.push({
            type: 'text',
            value: text.slice(lastIndex, match.index),
          });
        }

        const [, tagType, id, displayName] = match;
        const label = displayName || id;
        const url =
          tagType === 'Encounter'
            ? `/?encounter=${encodeURIComponent(id)}`
            : `asset://${tagType}/${encodeURIComponent(id)}`;

        replacementNodes.push({
          type: 'link',
          url,
          children: [
            {
              type: 'text',
              value: label,
            },
          ],
        });

        lastIndex = match.index + match[0].length;
      }

      if (lastIndex < text.length) {
        replacementNodes.push({
          type: 'text',
          value: text.slice(lastIndex),
        });
      }

      parent.children.splice(index, 1, ...replacementNodes);
      return index + replacementNodes.length;
    });
  };
}

/**
 * Custom URL transformer for react-markdown that permits custom asset:// and relative /?encounter= protocols
 * while safely sanitizing unsafe protocols (e.g. javascript:) via defaultUrlTransform.
 */
export function customUrlTransform(url: string): string {
  if (url.startsWith('asset://') || url.startsWith('/?encounter=')) {
    return url;
  }
  return defaultUrlTransform(url);
}

/**
 * Helper to recursively extract plain text content from ReactNode trees for accessible labels.
 */
export function getPlainText(node: ReactNode): string {
  if (node === null || node === undefined || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(getPlainText).join('');
  if (React.isValidElement(node)) {
    const children = (node.props as { children?: ReactNode }).children;
    if (children !== null && children !== undefined) {
      return getPlainText(children);
    }
  }
  return '';
}
