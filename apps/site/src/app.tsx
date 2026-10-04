import { MunaMotionProvider } from '@muna/ui/motion';

import { CatalogSection } from './components/catalog-section';
import { DownloadsSection } from './components/downloads-section';
import { FaqSection } from './components/faq-section';
import { Hero } from './components/hero';
import { PrivacySection } from './components/privacy-section';
import { SiteFooter } from './components/site-footer';
import { SiteHeader } from './components/site-header';

/**
 * One page, anchor navigation. The motion provider follows the OS reduced-motion setting, so
 * the demo and every hover state on the page slow down or stop when the visitor asked for that.
 */
export function App() {
  return (
    <MunaMotionProvider>
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <div id="top" className="page">
        <SiteHeader />
        <main id="main" className="page__main">
          <Hero />
          <CatalogSection />
          <DownloadsSection />
          <FaqSection />
          <PrivacySection />
        </main>
        <SiteFooter />
      </div>
    </MunaMotionProvider>
  );
}
