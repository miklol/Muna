import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { AppProviders } from '../app-providers';
import { Strip, wideText } from './strip';

const renderStrip = (content: Parameters<typeof Strip>[0]['content']) =>
  render(
    <AppProviders>
      <Strip content={content} />
    </AppProviders>,
  );

describe('Strip', () => {
  it('renders the idle strip as a named region with a screen-reader placeholder', () => {
    renderStrip({ kind: 'idle' });
    const strip = screen.getByRole('region', { name: 'Notch strip' });
    expect(strip).toHaveAttribute('data-kind', 'idle');
    expect(strip).toHaveAttribute('data-wide', 'false');
    expect(screen.getByText('Muna is running.')).toHaveClass('sr-only');
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('exposes the slot descriptors of a live activity and hides the slots from AT', () => {
    renderStrip({
      kind: 'activity',
      activity: {
        id: 'a1',
        module: 'media',
        priority: 50,
        leading: 'image',
        trailing: 'icon:waveform',
        wideText: null,
      },
    });
    const strip = screen.getByRole('region', { name: 'Notch strip' });
    expect(strip).toHaveAttribute('data-kind', 'activity');
    expect(strip).toHaveAttribute('data-wide', 'false');
    const leading = strip.querySelector('[data-slot="leading"]');
    const trailing = strip.querySelector('[data-slot="trailing"]');
    expect(leading).toHaveAttribute('data-descriptor', 'image');
    expect(leading).toHaveAttribute('aria-hidden', 'true');
    expect(trailing).toHaveAttribute('data-descriptor', 'icon:waveform');
  });

  it('shows wide-form text as a live status line, truncated to one line', () => {
    renderStrip({
      kind: 'notice',
      notice: { id: 'n1', module: 'clipboard', priority: 60, text: 'Copied', holdMs: 4000 },
    });
    const strip = screen.getByRole('region', { name: 'Notch strip' });
    expect(strip).toHaveAttribute('data-wide', 'true');
    expect(screen.getByRole('status')).toHaveTextContent('Copied');
    expect(screen.queryByText('Muna is running.')).not.toBeInTheDocument();
  });

  it('derives the wide text from notices and activities only', () => {
    expect(wideText({ kind: 'idle' })).toBeNull();
    expect(
      wideText({
        kind: 'activity',
        activity: {
          id: 'a1',
          module: 'media',
          priority: 50,
          leading: null,
          trailing: null,
          wideText: 'Track — Artist',
        },
      }),
    ).toBe('Track — Artist');
    expect(
      wideText({
        kind: 'notice',
        notice: { id: 'n1', module: 'clipboard', priority: 60, text: 'Copied', holdMs: 4000 },
      }),
    ).toBe('Copied');
  });
});
