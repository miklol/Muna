import { ChevronDown } from 'lucide-react';

import { faq } from '../content/site';
import { ICON_STROKE } from './demo-content';
import { Section } from './section';

/** Native disclosure widgets: keyboard-operable and readable without JavaScript. */
export function FaqSection() {
  return (
    <Section
      id="faq"
      eyebrow="FAQ"
      title="Questions people ask before installing"
      lede="Windows has no notch and no menu bar, so a few things work differently than you might expect."
    >
      <div className="faq">
        {faq.map((entry) => (
          <details key={entry.id} id={`faq-${entry.id}`} className="faq__item">
            <summary className="faq__question">
              <span>{entry.question}</span>
              <ChevronDown className="faq__chevron" strokeWidth={ICON_STROKE} aria-hidden="true" />
            </summary>
            <div className="faq__answer">
              {entry.answer.map((paragraph) => (
                <p key={paragraph}>{paragraph}</p>
              ))}
            </div>
          </details>
        ))}
      </div>
    </Section>
  );
}
