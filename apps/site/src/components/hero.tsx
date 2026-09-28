import { Chip } from '@muna/ui/primitives';
import { ArrowUpRight, Download } from 'lucide-react';

import { links } from '../content/site';
import { ICON_STROKE } from './demo-content';
import { NotchDemo } from './notch-demo';

const proofs = ['Free and open source', 'No telemetry', 'Windows 10 22H2 and 11'] as const;

const distances = [
  {
    title: 'Glance',
    body: 'A track changes and the strip widens with the art and title for a moment, then settles to an icon and a visualiser.',
  },
  {
    title: 'Peek',
    body: 'Rest the cursor on the strip for a quarter second and it reveals the transport, or the timer\u2019s controls.',
  },
  {
    title: 'Open',
    body: 'Rest a little longer, or click, and the strip springs into a panel with the module you were after.',
  },
  {
    title: 'Drop',
    body: 'Drag files or a window toward the top and the notch offers actions, a shelf or snap zones.',
  },
] as const;

export function Hero() {
  return (
    <section className="hero" aria-labelledby="hero-heading">
      <div className="hero__copy">
        <h1 id="hero-heading" className="hero__title">
          A notch for Windows
        </h1>
        <p className="hero__lede">
          Muna puts live activities, media controls, timers and quick actions in the dead space
          above your windows, with spring-driven motion and the footprint of a tray utility.
        </p>
        <div className="hero__actions">
          <a className="cta cta--primary" href="#download">
            <Download strokeWidth={ICON_STROKE} aria-hidden="true" />
            Download for Windows
          </a>
          <a className="cta cta--secondary" href={links.repo} rel="noreferrer">
            View on GitHub
            <ArrowUpRight strokeWidth={ICON_STROKE} aria-hidden="true" />
          </a>
        </div>
        <ul className="hero__proofs" aria-label="In short">
          {proofs.map((proof) => (
            <li key={proof}>
              <Chip>{proof}</Chip>
            </li>
          ))}
        </ul>
      </div>

      <NotchDemo />

      <ol className="distances" aria-label="How the notch responds">
        {distances.map((step, index) => (
          <li key={step.title} className="distances__step">
            <span className="distances__index" aria-hidden="true">
              {index + 1}
            </span>
            <h2 className="distances__title">{step.title}</h2>
            <p className="distances__body">{step.body}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}
