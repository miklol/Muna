import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { App } from './app';
import { catalog } from './content/catalog';
import { downloads, faq } from './content/site';

describe('App', () => {
  it('has one h1, a skip link to the main landmark and a section per nav item', () => {
    render(<App />);
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    const skip = screen.getByRole('link', { name: 'Skip to content' });
    expect(skip).toHaveAttribute('href', '#main');
    expect(screen.getByRole('main')).toHaveAttribute('id', 'main');

    const nav = screen.getByRole('navigation', { name: 'Sections' });
    for (const label of ['Features', 'Download', 'FAQ', 'Privacy']) {
      const href = within(nav).getByRole('link', { name: label }).getAttribute('href');
      expect(href, label).toMatch(/^#/);
      expect(document.querySelector(href ?? ''), label).not.toBeNull();
    }
  });

  it('lists every shipped module and hides out-of-scope rows', () => {
    render(<App />);
    const features = screen.getByRole('region', { name: /every module is optional/i });
    for (const entry of catalog) {
      const shown = within(features).queryByRole('heading', {
        level: 4,
        name: entry.title ?? entry.name,
      });
      if (entry.tier === 'P3') {
        expect(shown, entry.id).toBeNull();
      } else {
        expect(shown, entry.id).not.toBeNull();
      }
    }
  });

  it('offers both installers with the release link and marks one recommended', () => {
    render(<App />);
    for (const option of downloads) {
      const card = screen.getByRole('article', { name: option.title });
      const link = within(card).getByRole('link', { name: option.action });
      expect(link).toHaveAttribute('href', 'https://github.com/miklol/Muna/releases/latest');
    }
    expect(screen.getAllByText('Recommended')).toHaveLength(1);
  });

  it('answers every FAQ entry in a disclosure', () => {
    render(<App />);
    for (const entry of faq) {
      expect(screen.getByText(entry.question).closest('details')).not.toBeNull();
    }
  });

  it('keeps the copy rules: no exclamation marks anywhere on the page', () => {
    const { container } = render(<App />);
    expect(container.textContent).not.toMatch(/!/);
  });
});
