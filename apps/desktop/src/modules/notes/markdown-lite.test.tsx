import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { parseInline, parseMarkdown, renderMarkdown } from './markdown-lite';

describe('parseMarkdown', () => {
  it('reads headings, paragraphs and rules', () => {
    const blocks = parseMarkdown('# Title\n\nFirst line\nsecond line\n\n---\n\n## Sub ##');
    expect(blocks).toEqual([
      { kind: 'heading', level: 1, children: [{ kind: 'text', text: 'Title' }] },
      { kind: 'paragraph', children: [{ kind: 'text', text: 'First line second line' }] },
      { kind: 'rule' },
      { kind: 'heading', level: 2, children: [{ kind: 'text', text: 'Sub' }] },
    ]);
  });

  it('groups bullet, numbered and task items into lists', () => {
    const blocks = parseMarkdown('- milk\n* eggs\n1. first\n2) second\n- [ ] open\n- [x] done');
    expect(blocks).toEqual([
      {
        kind: 'list',
        ordered: false,
        items: [
          { children: [{ kind: 'text', text: 'milk' }], task: null },
          { children: [{ kind: 'text', text: 'eggs' }], task: null },
        ],
      },
      {
        kind: 'list',
        ordered: true,
        items: [
          { children: [{ kind: 'text', text: 'first' }], task: null },
          { children: [{ kind: 'text', text: 'second' }], task: null },
        ],
      },
      {
        kind: 'list',
        ordered: false,
        items: [
          { children: [{ kind: 'text', text: 'open' }], task: 'open' },
          { children: [{ kind: 'text', text: 'done' }], task: 'done' },
        ],
      },
    ]);
  });

  it('keeps fenced code verbatim and joins quote lines', () => {
    const blocks = parseMarkdown(
      '> a quote\n> continues\n\n```js\nconst x = **not bold**;\n\n  indented\n```\nafter',
    );
    expect(blocks).toEqual([
      { kind: 'quote', children: [{ kind: 'text', text: 'a quote continues' }] },
      { kind: 'code', text: 'const x = **not bold**;\n\n  indented' },
      { kind: 'paragraph', children: [{ kind: 'text', text: 'after' }] },
    ]);
  });

  it('closes an unterminated fence at the end of the note and reads CRLF bodies', () => {
    expect(parseMarkdown('```\r\nline\r\n')).toEqual([{ kind: 'code', text: 'line\n' }]);
  });
});

describe('parseInline', () => {
  it('reads code, strong, emphasis and links', () => {
    expect(parseInline('say `hi` to **you** and _me_ at [Muna](https://example.com/x)')).toEqual([
      { kind: 'text', text: 'say ' },
      { kind: 'code', text: 'hi' },
      { kind: 'text', text: ' to ' },
      { kind: 'strong', children: [{ kind: 'text', text: 'you' }] },
      { kind: 'text', text: ' and ' },
      { kind: 'em', children: [{ kind: 'text', text: 'me' }] },
      { kind: 'text', text: ' at ' },
      { kind: 'link', text: 'Muna', href: 'https://example.com/x' },
    ]);
  });

  it('leaves stray marks and underscores inside words alone', () => {
    expect(parseInline('snake_case_name and 2 * 3 * 4 and ** loose')).toEqual([
      { kind: 'text', text: 'snake_case_name and 2 * 3 * 4 and ** loose' },
    ]);
  });
});

describe('renderMarkdown', () => {
  it('renders elements, never raw HTML, and shows links without following them', () => {
    const { container } = render(
      <div>{renderMarkdown('# <b>Hi</b>\n\n[docs](https://example.com) `<i>`\n- [x] done')}</div>,
    );
    expect(container.querySelector('h1')?.textContent).toBe('<b>Hi</b>');
    expect(container.querySelector('b')).toBeNull();
    expect(container.querySelector('a')).toBeNull();
    const link = container.querySelector('.notes-md__link');
    expect(link?.textContent).toBe('docs');
    expect(link?.getAttribute('title')).toBe('https://example.com');
    expect(container.querySelector('li')?.getAttribute('data-task')).toBe('done');
  });
});
