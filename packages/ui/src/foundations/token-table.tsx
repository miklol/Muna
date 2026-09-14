import type { CSSProperties } from 'react';

import { type Token, type TokenGroup, tokensByGroup } from '../tokens';

export interface TokenTableProps {
  group: TokenGroup;
  title: string;
}

const previewFor = (token: Token): CSSProperties | undefined => {
  switch (token.group) {
    case 'colour':
      return { background: `var(${token.name})` };
    case 'material':
      return { background: `var(${token.name})`, boxShadow: `var(${token.name})` };
    case 'shadow':
      return { background: 'var(--panel-top)', boxShadow: `var(${token.name})` };
    case 'radius':
      return { background: 'var(--surface-4)', borderRadius: `var(${token.name})` };
    case 'space':
    case 'size':
      return { background: 'var(--accent)', width: `var(${token.name})`, height: 8 };
    case 'focus':
      return { outline: 'var(--focus-ring)', outlineOffset: 'var(--focus-ring-offset)' };
    case 'type':
      return undefined;
  }
};

/**
 * Lists one token group with a live preview of each value. Foundations-only: not a
 * primitive, not exported from the package root.
 */
export function TokenTable({ group, title }: TokenTableProps) {
  const rows = tokensByGroup(group);
  return (
    <section aria-labelledby={`tokens-${group}`} className="token-table">
      <h2 id={`tokens-${group}`}>{title}</h2>
      <table>
        <thead>
          <tr>
            <th scope="col">Token</th>
            <th scope="col">Value</th>
            <th scope="col">Preview</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((token) => (
            <tr key={token.name}>
              <th scope="row">
                <code>{token.name}</code>
              </th>
              <td>
                <code>{token.value}</code>
              </td>
              <td>
                {token.group === 'type' ? (
                  <TypePreview token={token} />
                ) : (
                  <span aria-hidden="true" className="token-preview" style={previewFor(token)} />
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

const typeScaleName = /^--text-([a-z0-9]+)$/;

function TypePreview({ token }: { token: Token }) {
  const match = typeScaleName.exec(token.name);
  if (match?.[1] === undefined) return null;
  const step = match[1];
  return (
    <span
      style={{
        fontFamily: 'var(--font-sans)',
        fontSize: `var(--text-${step})`,
        lineHeight: `var(--text-${step}--line-height)`,
        fontWeight: `var(--text-${step}--font-weight)`,
        letterSpacing: `var(--text-${step}--letter-spacing)`,
      }}
    >
      Now playing
    </span>
  );
}
