import { Lock } from 'lucide-react';

import { links, privacy } from '../content/site';
import { ICON_STROKE } from './demo-content';
import { Section } from './section';

export function PrivacySection() {
  return (
    <Section
      id="privacy"
      eyebrow="Privacy"
      title="Local first. Nothing leaves your PC unless you connect something."
      lede="Muna is a utility that lives on your machine, not a service. That is a design rule, not a setting."
    >
      <ul className="privacy">
        {privacy.map((point) => (
          <li key={point.title} className="privacy__point">
            <Lock className="privacy__icon" strokeWidth={ICON_STROKE} aria-hidden="true" />
            <div>
              <h3 className="privacy__title">{point.title}</h3>
              <p className="privacy__body">{point.body}</p>
            </div>
          </li>
        ))}
      </ul>
      <p className="privacy__more">
        The source is public, so you can check every claim on this page.{' '}
        <a href={links.repo} rel="noreferrer">
          Read the code on GitHub
        </a>
        .
      </p>
    </Section>
  );
}
