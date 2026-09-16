import type { StripContent } from '@muna/contracts';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { AppProviders } from '../app-providers';
import { Strip } from './strip';

const renderStrip = (content: StripContent) =>
  render(
    <AppProviders>
      <Strip content={content} receivedAt={Date.now()} />
    </AppProviders>,
  );

const region = () => screen.getByRole('region', { name: 'Notch strip' });

describe('Strip', () => {
  it('renders the idle strip as a named region that tells AT the app is running', () => {
    renderStrip({ kind: 'idle' });
    expect(region()).toHaveAttribute('data-kind', 'idle');
    expect(region()).not.toHaveAttribute('data-wide');
    expect(screen.getByRole('status')).toHaveTextContent('Muna is running.');
    expect(region().querySelector('.muna-strip__slot-content')).toBeNull();
  });

  it('maps an activity to its slots, hides them from AT and describes them in the live region', () => {
    renderStrip({
      kind: 'activity',
      wide: false,
      activity: {
        id: 'pomodoro:timer',
        module: 'pomodoro',
        priority: 70,
        leading: { kind: 'icon', glyph: 'timer', tint: 'orange' },
        trailing: { kind: 'timer', remainingMs: 90_000, totalMs: 1_500_000, running: true },
        wide: { kind: 'text', value: 'Focus' },
      },
    });
    expect(region()).toHaveAttribute('data-kind', 'activity');
    // The wide text only shows during the burst the scheduler signals.
    expect(region()).not.toHaveAttribute('data-wide');
    expect(screen.queryByText('Focus')).not.toBeInTheDocument();
    expect(region().querySelector('[data-slot="leading"] svg')).not.toBeNull();
    expect(region().querySelector('[data-slot="trailing"]')).toHaveTextContent('1:30');
    expect(screen.getByRole('status')).toHaveTextContent(/^Focus, 1:30 left$/);
  });

  it('shows the wide text of an activity while the scheduler holds its wide form', () => {
    renderStrip({
      kind: 'activity',
      wide: true,
      activity: {
        id: 'media:now-playing',
        module: 'media',
        priority: 60,
        leading: { kind: 'image', src: 'data:image/gif;base64,R0lGODlhAQABAAAAACw=' },
        trailing: { kind: 'icon', glyph: 'music', tint: null },
        wide: { kind: 'text', value: 'Track — Artist' },
      },
    });
    expect(region()).toHaveAttribute('data-wide', 'true');
    const wide = region().querySelector('.muna-strip__wide');
    expect(wide).toHaveTextContent('Track — Artist');
    expect(wide?.querySelector('[aria-hidden="true"]')).not.toBeNull();
    expect(screen.getByRole('status')).toHaveTextContent(/^Track — Artist$/);
  });

  it('renders a compact power notice from the battery and percent slots alone', () => {
    renderStrip({
      kind: 'notice',
      notice: {
        id: 'power:charging',
        module: 'live-activities',
        priority: 90,
        leading: { kind: 'battery', percent: 57, charging: true },
        trailing: { kind: 'percent', value: 57 },
        wide: null,
        holdMs: 0,
      },
    });
    expect(region()).toHaveAttribute('data-kind', 'notice');
    expect(region()).not.toHaveAttribute('data-wide');
    expect(region().querySelector('[data-slot="leading"] [data-charging]')).not.toBeNull();
    expect(region().querySelector('[data-slot="trailing"]')).toHaveTextContent('57%');
    expect(screen.getByRole('status')).toHaveTextContent(/^Charging, 57%$/);
  });

  it('localises a message notice into the wide form and the live region', () => {
    renderStrip({
      kind: 'notice',
      notice: {
        id: 'power:low:20',
        module: 'live-activities',
        priority: 90,
        leading: { kind: 'battery', percent: 19, charging: false },
        trailing: { kind: 'percent', value: 19 },
        wide: { kind: 'batteryLow', percent: 19 },
        holdMs: 0,
      },
    });
    expect(region()).toHaveAttribute('data-wide', 'true');
    expect(screen.getByText('Low battery')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Low battery, 19%');
  });
});
