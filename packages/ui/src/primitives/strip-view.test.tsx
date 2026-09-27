import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

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

  it('shows the HUD level as a draggable track and keeps it mounted across value changes', () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <StripView
        aria-label="Notch strip"
        itemId="hud:volume"
        kind="notice"
        leading={{ kind: 'icon', icon, id: 'volumeMedium' }}
        trailing={{ kind: 'level', percent: 45, muted: false, label: 'Volume', onChange }}
        description="Volume, 45%"
      />,
    );
    const region = screen.getByRole('region', { name: 'Notch strip' });
    const slider = screen.getByRole('slider', { name: 'Volume' });
    expect(slider).toHaveValue('45');
    const mounted = region.querySelector('[data-slot="trailing"] .muna-strip__slot-content');
    expect(region.querySelector('.muna-strip__glyph-frame')).not.toBeNull();

    // The same notice with a new level: the track updates in place, no re-entry.
    rerender(
      <StripView
        aria-label="Notch strip"
        itemId="hud:volume"
        kind="notice"
        leading={{ kind: 'icon', icon, id: 'volumeHigh' }}
        trailing={{
          kind: 'level',
          percent: 70,
          muted: false,
          label: 'Volume',
          valueText: '70%',
          onChange,
        }}
        description="Volume, 70%"
      />,
    );
    expect(screen.getByRole('slider', { name: 'Volume' })).toHaveValue('70');
    expect(region.querySelector('[data-slot="trailing"] .muna-strip__slot-content')).toBe(mounted);
    expect(region.querySelector('.muna-level-track__value')).toHaveTextContent('70%');
  });

  it('shows a decision as two pressable pills beside the wide text', async () => {
    const user = userEvent.setup();
    const onAllow = vi.fn();
    const onDeny = vi.fn();
    render(
      <StripView
        aria-label="Notch strip"
        itemId="ai-coding:waiting:claude:s1"
        kind="activity"
        leading={{ kind: 'icon', icon, tint: 'orange' }}
        trailing={{
          kind: 'decision',
          label: 'Allow or deny',
          allowLabel: 'Allow',
          denyLabel: 'Deny',
          onAllow,
          onDeny,
        }}
        text="Claude Code wants to run Bash"
        wide
        description="Claude Code wants to run Bash, allow or deny"
      />,
    );
    const region = screen.getByRole('region', { name: 'Notch strip' });
    expect(region).toHaveAttribute('data-wide', 'true');
    expect(region.querySelector('.muna-strip__wide')).toHaveTextContent(
      'Claude Code wants to run Bash',
    );
    const group = screen.getByRole('group', { name: 'Allow or deny' });
    expect(group.closest('[data-slot="trailing"]')).not.toBeNull();
    await user.click(screen.getByRole('button', { name: 'Allow' }));
    expect(onAllow).toHaveBeenCalledTimes(1);
    expect(onDeny).not.toHaveBeenCalled();
  });
});
