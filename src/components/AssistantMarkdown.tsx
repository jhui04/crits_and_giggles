import { Markdown } from './Markdown';

export interface AssistantMarkdownProps {
  content: string;
  baseHeadingLevel?: number;
}

/**
 * Parses markdown into strictly accessible semantic HTML using the unified Markdown pipeline.
 * Ensures blind DMs can navigate responses rapidly via screen reader heading (H), table (T),
 * and list (L/I) shortcuts without skipped heading levels or malformed landmarks.
 */
export function AssistantMarkdown({
  content,
  baseHeadingLevel = 3,
}: AssistantMarkdownProps) {
  return (
    <Markdown
      content={content}
      baseHeadingLevel={baseHeadingLevel}
      theme="dark"
    />
  );
}
