import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { MunaMotionProvider } from '../motion/reduced-motion';
import { StripView } from './strip-view';

const icon = <svg data-testid="icon" aria-hidden="true" />;

describe('StripView', () => {
  it('is a named region with a polite description and empty slots when idle', () => {
    render(
      <StripView
        aria-label="Notch strip"
        itemId={null}
        kind="idle"
        description="Muna is running."
      />,
    );
    const region = screen.getByRole('region', { name: 'Notch strip' });
    expect(region).toHaveAttribute('data-kind', 'idle');
    expect(region).not.toHaveAttribute('data-wide');
    expect(screen.getByRole('status')).toHaveTextContent('Muna is running.');
    expect(region.querySelectorAll('.muna-strip__slot-content')).toHaveLength(0);
  });

  it('renders every slot form', () => {
    const { rerender } = render(
      <StripView
        aria-label="Notch strip"
        itemId="power:charging"
        kind="notice"
        leading={{ kind: 'battery', percent: 57, charging: true }}
        trailing={{ kind: 'text', value: '57%' }}
        description="Charging, 57%"
      />,
    );
    const region = screen.getByRole('region', { name: 'Notch strip' });
    expect(region.querySelector('[data-slot="leading"] .muna-battery')).not.toBeNull();
    expect(region.querySelector('[data-slot="trailing"]')).toHaveTextContent('57%');

    rerender(
      <StripView
        aria-label="Notch strip"
        itemId="pomodoro:timer"
        kind="activity"
        leading={{ kind: 'icon', icon, tint: 'orange' }}
        trailing={{
          kind: 'timer',
          remainingMs: 90_000,
          totalMs: 1_500_000,
          running: false,
          receivedAt: 0,
        }}
        description="Focus, 1:30 left"
      />,
    );
    const tinted = region.querySelector<HTMLElement>('.muna-strip__icon--tinted')!;
    expect(tinted.style.getPropertyValue('--muna-tint')).toBe('var(--accent-orange)');
    expect(screen.getByTestId('icon')).toBeInTheDocument();
    expect(region.querySelector('[data-slot="trailing"]')).toHaveTextContent('1:30');

    rerender(
      <StripView
        aria-label="Notch strip"
        itemId="media:now-playing"
        kind="activity"
        leading={{ kind: 'image', src: 'data:image/png;base64,AA==' }}
        trailing={{ kind: 'progress', percent: 40 }}
        description="Playing"
      />,
    );
    expect(region.querySelector('img.muna-strip__image')).toHaveAttribute('alt', '');
    expect(region.querySelector('.muna-ring')).not.toBeNull();
  });

  it('shows the wide text only in the wide form and keeps it out of the accessibility tree', () => {
    const { rerender } = render(
      <StripView
        aria-label="Notch strip"
        itemId="bluetooth:1"
        kind="notice"
        text="Galaxy Buds connected"
        wide={false}
        description="Galaxy Buds connected"
      />,
    );
    const region = screen.getByRole('region', { name: 'Notch strip' });
    expect(region.querySelector('.muna-strip__wide')).toBeNull();
    expect(region).not.toHaveAttribute('data-wide');

    rerender(
      <StripView
        aria-label="Notch strip"
        itemId="bluetooth:1"
        kind="notice"
        text="Galaxy Buds connected"
        wide
        description="Galaxy Buds connected"
      />,
    );
    expect(region).toHaveAttribute('data-wide', 'true');
    const wide = region.querySelector('.muna-strip__wide')!;
    expect(wide).toHaveTextContent('Galaxy Buds connected');
    expect(wide.querySelector('[aria-hidden="true"]')).not.toBeNull();
    // Announced once, through the live region.
    expect(screen.getAllByText('Galaxy Buds connected')).toHaveLength(2);
    expect(screen.getByRole('status')).toHaveTextContent('Galaxy Buds connected');
  });

  it('renders under reduced motion', () => {
    render(
      <MunaMotionProvider reduceMotion>
        <StripView
          aria-label="Notch strip"
          itemId="session:locked"
          kind="notice"
          leading={{ kind: 'icon', icon }}
          description="Locked"
        />
      </MunaMotionProvider>,
    );
    expect(screen.getByTestId('icon')).toBeInTheDocument();
  });
});
