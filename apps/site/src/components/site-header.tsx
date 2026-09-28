import { notchPath } from '@muna/ui/shape';

import { links } from '../content/site';

/** Muna's mark: the notch silhouette from `@muna/ui/shape`, so the logo is the real shape. */
export function Wordmark({ compact = false }: { compact?: boolean }) {
  const path = notchPath({ width: 40, height: 14, topRadius: 6, bottomRadius: 7 });
  return (
    <span className="wordmark">
      <svg
        className="wordmark__mark"
        viewBox="0 0 52 14"
        width="26"
        height="7"
        aria-hidden="true"
        focusable="false"
      >
        <path d={path} fill="currentColor" />
      </svg>
      {!compact && <span className="wordmark__name">Muna</span>}
    </span>
  );
}

const nav = [
  { href: '#features', label: 'Features' },
  { href: '#download', label: 'Download' },
  { href: '#faq', label: 'FAQ' },
  { href: '#privacy', label: 'Privacy' },
] as const;

export function SiteHeader() {
  return (
    <header className="header">
      <a className="header__home" href="#top" aria-label="Muna, back to top">
        <Wordmark />
      </a>
      <nav className="header__nav" aria-label="Sections">
        <ul>
          {nav.map((item) => (
            <li key={item.href}>
              <a href={item.href}>{item.label}</a>
            </li>
          ))}
          <li>
            <a href={links.repo} rel="noreferrer">
              GitHub
            </a>
          </li>
        </ul>
      </nav>
    </header>
  );
}
