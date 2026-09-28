import { Chip } from '@muna/ui/primitives';

import { catalogAreas, catalogByArea, displayName, tierLabels } from '../content/catalog';
import { Section } from './section';

export function CatalogSection() {
  return (
    <Section
      id="features"
      eyebrow="Modules"
      title="Everything is a module, and every module is optional"
      lede="Turn on what you use, order the bar the way you think, and leave the rest off. Modules marked In 1.0 ship with the first release; the others follow in 1.x updates."
    >
      {catalogAreas.map((area) => {
        const entries = catalogByArea(area.id);
        return (
          <div key={area.id} className="catalog__area">
            <h3 className="catalog__area-title" id={`features-${area.id}`}>
              {area.label}
            </h3>
            <ul className="catalog__grid" aria-labelledby={`features-${area.id}`}>
              {entries.map((entry) => (
                <li key={entry.id} className="catalog__card" data-tier={entry.tier}>
                  <div className="catalog__card-head">
                    <h4 className="catalog__card-title">{displayName(entry)}</h4>
                    <Chip>{tierLabels[entry.tier]}</Chip>
                  </div>
                  <p className="catalog__card-body">{entry.summary}</p>
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </Section>
  );
}
