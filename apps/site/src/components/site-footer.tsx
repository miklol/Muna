import { links } from '../content/site';
import { Wordmark } from './site-header';

const footerLinks = [
  { href: links.repo, label: 'Source code' },
  { href: links.releases, label: 'Releases' },
  { href: links.issues, label: 'Report a problem' },
  { href: links.discussions, label: 'Discussions' },
  { href: links.docs, label: 'Documentation' },
] as const;

export function SiteFooter() {
  return (
    <footer className="footer">
      <div className="footer__brand">
        <Wordmark />
        <p className="footer__tagline">
          Free and open source, built in the open. Windows is a trademark of Microsoft Corporation;
          Muna is an independent project.
        </p>
      </div>
      <nav className="footer__nav" aria-label="Project links">
        <ul>
          {footerLinks.map((link) => (
            <li key={link.href}>
              <a href={link.href} rel="noreferrer">
                {link.label}
              </a>
            </li>
          ))}
        </ul>
      </nav>
    </footer>
  );
}
