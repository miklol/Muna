import type { ReactNode } from 'react';

export interface SectionProps {
  /** Anchor the header links to (`features`, `download`, …). */
  id: string;
  eyebrow?: string;
  title: string;
  lede?: string;
  children: ReactNode;
  className?: string;
}

/** A page section with a linkable heading; the header's nav points at these ids. */
export function Section({ id, eyebrow, title, lede, children, className }: SectionProps) {
  const headingId = `${id}-heading`;
  return (
    <section
      id={id}
      className={className ? `section ${className}` : 'section'}
      aria-labelledby={headingId}
    >
      <div className="section__head">
        {eyebrow !== undefined && <p className="section__eyebrow">{eyebrow}</p>}
        <h2 id={headingId} className="section__title">
          {title}
        </h2>
        {lede !== undefined && <p className="section__lede">{lede}</p>}
      </div>
      {children}
    </section>
  );
}
