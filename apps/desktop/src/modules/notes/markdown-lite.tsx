import type { ReactNode } from 'react';

/**
 * The light Markdown preview docs/modules/notes.md asks for ("plain textarea with light
 * markdown preview toggle (no rich editor in v1)"). A line-oriented reading of the common
 * marks — headings, paragraphs, bullet, numbered and task lists, quotes, fenced code — with
 * bold, italic, inline code and links inside. Output is React elements, never raw HTML, so a
 * note can say anything. Links are shown, not followed: the notch opens nothing on its own.
 */

export type Inline =
  | { kind: 'text'; text: string }
  | { kind: 'strong'; children: Inline[] }
  | { kind: 'em'; children: Inline[] }
  | { kind: 'code'; text: string }
  | { kind: 'link'; text: string; href: string };

export type Block =
  | { kind: 'heading'; level: 1 | 2 | 3 | 4 | 5 | 6; children: Inline[] }
  | { kind: 'paragraph'; children: Inline[] }
  | { kind: 'list'; ordered: boolean; items: ListItem[] }
  | { kind: 'quote'; children: Inline[] }
  | { kind: 'code'; text: string }
  | { kind: 'rule' };

export interface ListItem {
  children: Inline[];
  /** `- [ ]` / `- [x]`: shown as a check glyph, never a control (the file is the truth). */
  task: 'open' | 'done' | null;
}

const HEADING = /^(#{1,6})\s+(.*?)\s*#*\s*$/;
const BULLET = /^[-*+]\s+(.*)$/;
const NUMBERED = /^\d{1,9}[.)]\s+(.*)$/;
const TASK = /^\[([ xX])\]\s+(.*)$/;
const QUOTE = /^>\s?(.*)$/;
const FENCE = /^(`{3,}|~{3,})/;
const RULE = /^(?:-{3,}|\*{3,}|_{3,})\s*$/;

/** Splits a paragraph's text into inline runs: `code`, **strong**, *em* / _em_, [text](url). */
export function parseInline(text: string): Inline[] {
  const out: Inline[] = [];
  let buffer = '';
  const flush = () => {
    if (buffer !== '') {
      out.push({ kind: 'text', text: buffer });
      buffer = '';
    }
  };
  let i = 0;
  while (i < text.length) {
    const rest = text.slice(i);
    const code = /^`([^`\n]+)`/.exec(rest);
    if (code?.[1] !== undefined) {
      flush();
      out.push({ kind: 'code', text: code[1] });
      i += code[0].length;
      continue;
    }
    const strong = /^(\*\*|__)(?=\S)([\s\S]+?\S)\1/.exec(rest);
    if (strong?.[2] !== undefined) {
      flush();
      out.push({ kind: 'strong', children: parseInline(strong[2]) });
      i += strong[0].length;
      continue;
    }
    const em = /^(\*|_)(?=\S)([^*_\n]+?\S)\1(?![*_\w])/.exec(rest);
    if (em?.[2] !== undefined) {
      flush();
      out.push({ kind: 'em', children: parseInline(em[2]) });
      i += em[0].length;
      continue;
    }
    const link = /^\[([^\]\n]+)\]\(([^)\s]+)\)/.exec(rest);
    if (link?.[1] !== undefined && link[2] !== undefined) {
      flush();
      out.push({ kind: 'link', text: link[1], href: link[2] });
      i += link[0].length;
      continue;
    }
    buffer += text[i] ?? '';
    i += 1;
  }
  flush();
  return out;
}

const listItemOf = (text: string): ListItem => {
  const task = TASK.exec(text);
  if (task?.[1] !== undefined && task[2] !== undefined) {
    return { children: parseInline(task[2]), task: task[1] === ' ' ? 'open' : 'done' };
  }
  return { children: parseInline(text), task: null };
};

interface OpenList {
  ordered: boolean;
  items: ListItem[];
}

/** Reads a note body into blocks. Blank lines separate paragraphs; a fence swallows lines. */
export function parseMarkdown(body: string): Block[] {
  const lines = body.replace(/\r\n?/g, '\n').split('\n');
  const blocks: Block[] = [];
  let paragraph: string[] = [];
  let list: OpenList | null = null;
  let quote: string[] = [];
  // Read through a call so the closures' assignments do not narrow `list` to `null` here.
  const openList = (): OpenList | null => list;

  const closeParagraph = () => {
    if (paragraph.length > 0) {
      blocks.push({ kind: 'paragraph', children: parseInline(paragraph.join(' ')) });
      paragraph = [];
    }
  };
  const closeList = () => {
    if (list !== null) {
      blocks.push({ kind: 'list', ordered: list.ordered, items: list.items });
      list = null;
    }
  };
  const closeQuote = () => {
    if (quote.length > 0) {
      blocks.push({ kind: 'quote', children: parseInline(quote.join(' ')) });
      quote = [];
    }
  };
  const closeAll = () => {
    closeParagraph();
    closeList();
    closeQuote();
  };

  let i = 0;
  while (i < lines.length) {
    const raw = lines[i] ?? '';
    const line = raw.trimEnd();
    const trimmed = line.trim();

    const fence = FENCE.exec(trimmed);
    if (fence?.[1] !== undefined) {
      closeAll();
      const marker = fence[1];
      const code: string[] = [];
      i += 1;
      while (i < lines.length && !(lines[i] ?? '').trim().startsWith(marker)) {
        code.push(lines[i] ?? '');
        i += 1;
      }
      blocks.push({ kind: 'code', text: code.join('\n') });
      i += 1;
      continue;
    }

    if (trimmed === '') {
      closeAll();
      i += 1;
      continue;
    }

    const heading = HEADING.exec(trimmed);
    if (heading?.[1] !== undefined && heading[2] !== undefined) {
      closeAll();
      const level = Math.min(heading[1].length, 6) as 1 | 2 | 3 | 4 | 5 | 6;
      blocks.push({ kind: 'heading', level, children: parseInline(heading[2]) });
      i += 1;
      continue;
    }

    if (RULE.test(trimmed)) {
      closeAll();
      blocks.push({ kind: 'rule' });
      i += 1;
      continue;
    }

    const bullet = BULLET.exec(trimmed);
    const numbered = NUMBERED.exec(trimmed);
    const item = bullet?.[1] ?? numbered?.[1];
    if (item !== undefined) {
      closeParagraph();
      closeQuote();
      const ordered = bullet === null;
      let current = openList();
      if (current?.ordered !== ordered) {
        closeList();
        current = { ordered, items: [] };
        list = current;
      }
      current.items.push(listItemOf(item));
      i += 1;
      continue;
    }

    const quoted = QUOTE.exec(trimmed);
    if (quoted?.[1] !== undefined) {
      closeParagraph();
      closeList();
      quote.push(quoted[1]);
      i += 1;
      continue;
    }

    closeList();
    closeQuote();
    paragraph.push(trimmed);
    i += 1;
  }
  closeAll();
  return blocks;
}

const renderInline = (nodes: readonly Inline[], keyPrefix: string): ReactNode[] =>
  nodes.map((node, index) => {
    const key = `${keyPrefix}-${String(index)}`;
    switch (node.kind) {
      case 'text':
        return node.text;
      case 'strong':
        return <strong key={key}>{renderInline(node.children, key)}</strong>;
      case 'em':
        return <em key={key}>{renderInline(node.children, key)}</em>;
      case 'code':
        return (
          <code key={key} className="notes-md__code">
            {node.text}
          </code>
        );
      case 'link':
        // Shown as a link, not followed: the notch never opens addresses from a file.
        return (
          <span key={key} className="notes-md__link" title={node.href}>
            {node.text}
          </span>
        );
    }
  });

const HEADING_TAGS = { 1: 'h1', 2: 'h2', 3: 'h3', 4: 'h4', 5: 'h5', 6: 'h6' } as const;

/** The blocks of `body` as React elements, for the preview pane. */
export function renderMarkdown(body: string): ReactNode[] {
  return parseMarkdown(body).map((block, index) => {
    const key = `b${String(index)}`;
    switch (block.kind) {
      case 'heading': {
        const Tag = HEADING_TAGS[block.level];
        return (
          <Tag key={key} className="notes-md__heading" data-level={block.level}>
            {renderInline(block.children, key)}
          </Tag>
        );
      }
      case 'paragraph':
        return (
          <p key={key} className="notes-md__paragraph">
            {renderInline(block.children, key)}
          </p>
        );
      case 'list': {
        const Tag = block.ordered ? 'ol' : 'ul';
        return (
          <Tag key={key} className="notes-md__list">
            {block.items.map((item, itemIndex) => {
              const itemKey = `${key}-${String(itemIndex)}`;
              return (
                <li key={itemKey} className="notes-md__item" data-task={item.task ?? undefined}>
                  {item.task !== null && (
                    <span className="notes-md__check" aria-hidden>
                      {item.task === 'done' ? '☑' : '☐'}
                    </span>
                  )}
                  {renderInline(item.children, itemKey)}
                </li>
              );
            })}
          </Tag>
        );
      }
      case 'quote':
        return (
          <blockquote key={key} className="notes-md__quote">
            {renderInline(block.children, key)}
          </blockquote>
        );
      case 'code':
        return (
          <pre key={key} className="notes-md__pre">
            <code>{block.text}</code>
          </pre>
        );
      case 'rule':
        return <hr key={key} className="notes-md__rule" />;
    }
  });
}
