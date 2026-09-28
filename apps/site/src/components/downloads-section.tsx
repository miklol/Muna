import { Chip } from '@muna/ui/primitives';
import { Download, ShieldCheck } from 'lucide-react';

import { downloads, links, requirements } from '../content/site';
import { ICON_STROKE } from './demo-content';
import { Section } from './section';

export function DownloadsSection() {
  return (
    <Section
      id="download"
      eyebrow="Download"
      title="Get Muna"
      lede="Muna 1.0 is on its way. Every build is published on GitHub, signed, and comes in two flavours."
    >
      <div className="downloads">
        {downloads.map((option) => (
          <article
            key={option.id}
            className="downloads__card"
            data-recommended={option.recommended || undefined}
            aria-labelledby={`download-${option.id}`}
          >
            <div className="downloads__head">
              <h3 id={`download-${option.id}`} className="downloads__title">
                {option.title}
              </h3>
              {option.recommended && <Chip>Recommended</Chip>}
            </div>
            <p className="downloads__summary">{option.summary}</p>
            <ul className="downloads__details">
              {option.details.map((detail) => (
                <li key={detail}>{detail}</li>
              ))}
            </ul>
            <code className="downloads__artefact">{option.artefact}</code>
            <a
              className={option.recommended ? 'cta cta--primary' : 'cta cta--secondary'}
              href={links.latestRelease}
              rel="noreferrer"
            >
              <Download strokeWidth={ICON_STROKE} aria-hidden="true" />
              {option.action}
            </a>
          </article>
        ))}
      </div>

      <div className="downloads__notes">
        <div className="downloads__note">
          <h3 className="downloads__note-title">Requirements</h3>
          <ul>
            {requirements.map((requirement) => (
              <li key={requirement}>{requirement}</li>
            ))}
          </ul>
        </div>
        <div className="downloads__note">
          <h3 className="downloads__note-title">
            <ShieldCheck strokeWidth={ICON_STROKE} aria-hidden="true" />
            If Windows shows a SmartScreen prompt
          </h3>
          <p>
            Both installers are code-signed. A new certificate has no reputation yet, so SmartScreen
            may still warn about an unrecognised app for the first releases. Check that the
            publisher in the prompt is Muna, then choose More info and Run anyway. Every release
            page lists the files it published, so you can compare names before you run anything.
          </p>
        </div>
        <div className="downloads__note">
          <h3 className="downloads__note-title">Staying current</h3>
          <p>
            The installer package updates through App Installer. The setup program checks the
            release feed on launch and every six hours, downloads quietly, and asks before it
            restarts. It never restarts while media plays or a timer runs.
          </p>
          <p>
            <a href={links.releases} rel="noreferrer">
              Release notes and older versions
            </a>
          </p>
        </div>
      </div>
    </Section>
  );
}
