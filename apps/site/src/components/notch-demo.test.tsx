import { MunaMotionProvider, springs, timings } from '@muna/ui/motion';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { demoMorphTransition, demoSize, demoSizes, hoverOutGraceMs, NotchDemo } from './notch-demo';

const renderDemo = () =>
  render(
    <MunaMotionProvider>
      <NotchDemo />
    </MunaMotionProvider>,
  );

const stage = () => screen.getByRole('button', { name: 'Open the notch' }).closest('.demo');

describe('demo geometry', () => {
  it('sizes the three states like the shell at the default strip height', () => {
    expect(demoSize('collapsed')).toEqual({ width: 200, height: 32 });
    expect(demoSize('reveal')).toEqual({ width: 216, height: 36 });
    expect(demoSize('expanded')).toEqual(demoSizes.panel);
    expect(demoSizes.panel.width).toBeGreaterThanOrEqual(720);
    expect(demoSizes.panel.height).toBeGreaterThanOrEqual(190);
    expect(demoSizes.panel.height).toBeLessThanOrEqual(360);
  });

  it('picks the shell presets: expand in, collapse out after the shape-follow delay, reveal between', () => {
    expect(demoMorphTransition('collapsed', 'expanded', false)).toBe(springs.expand);
    expect(demoMorphTransition('reveal', 'expanded', false)).toBe(springs.expand);
    expect(demoMorphTransition('expanded', 'collapsed', false)).toEqual({
      ...springs.collapse,
      delay: timings.shapeFollowDelayMs / 1000,
    });
    expect(demoMorphTransition('collapsed', 'reveal', false)).toBe(springs.reveal);
    expect(demoMorphTransition('reveal', 'collapsed', false)).toBe(springs.reveal);
  });

  it('replaces every morph with the reduced-motion transition', () => {
    expect(demoMorphTransition('collapsed', 'expanded', true)).toEqual({
      duration: 0.15,
      ease: [0.2, 0, 0, 1],
    });
  });

  it('waits longer before collapsing an open panel than a reveal', () => {
    expect(hoverOutGraceMs('reveal')).toBe(timings.hoverOutGraceRevealMs);
    expect(hoverOutGraceMs('expanded')).toBe(timings.hoverOutGraceExpandedMs);
  });
});

describe('NotchDemo', () => {
  it('starts collapsed with the media strip and the strip button', () => {
    renderDemo();
    expect(stage()).toHaveAttribute('data-state', 'collapsed');
    expect(screen.getByRole('button', { name: 'Open the notch' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Notch strip' })).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('opens on click, shows the Media panel and the module bar, and closes from the rail', async () => {
    const user = userEvent.setup();
    renderDemo();
    await user.click(screen.getByRole('button', { name: 'Open the notch' }));
    const dialog = screen.getByRole('dialog', { name: 'Media' });
    expect(dialog).toBeInTheDocument();
    expect(screen.getByRole('tablist', { name: 'Modules' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Collapse the panel' }));
    expect(stage()).toHaveAttribute('data-state', 'collapsed');
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    expect(screen.getByRole('button', { name: 'Open the notch' })).toBeInTheDocument();
  });

  it('switches the module from the bar', async () => {
    const user = userEvent.setup();
    renderDemo();
    await user.click(screen.getByRole('button', { name: 'Open the notch' }));
    await user.click(screen.getByRole('tab', { name: 'Pomodoro' }));
    expect(screen.getByRole('dialog', { name: 'Pomodoro' })).toBeInTheDocument();
    await user.click(screen.getByRole('tab', { name: 'Todo' }));
    expect(screen.getByRole('dialog', { name: 'Todo' })).toBeInTheDocument();
    expect(screen.getByRole('list', { name: 'Tasks' })).toBeInTheDocument();
  });

  it('is keyboard-operable: Enter opens and moves focus into the panel, Escape closes and returns it', async () => {
    const user = userEvent.setup();
    renderDemo();
    const strip = screen.getByRole('button', { name: 'Open the notch' });
    strip.focus();
    await user.keyboard('{Enter}');
    const dialog = screen.getByRole('dialog', { name: 'Media' });
    expect(dialog.contains(document.activeElement)).toBe(true);
    await user.keyboard('{Escape}');
    expect(stage()).toHaveAttribute('data-state', 'collapsed');
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    expect(screen.getByRole('button', { name: 'Open the notch' })).toHaveFocus();
  });

  it('changes what the strip shows and the module it opens on', async () => {
    const user = userEvent.setup();
    renderDemo();
    await user.click(screen.getByRole('radio', { name: 'Timer' }));
    expect(screen.getByRole('region', { name: 'Notch strip' })).toHaveTextContent('24:');
    await user.click(screen.getByRole('button', { name: 'Open the notch' }));
    expect(screen.getByRole('dialog', { name: 'Pomodoro' })).toBeInTheDocument();
  });

  it('switches to the island shape', async () => {
    const user = userEvent.setup();
    renderDemo();
    await user.click(screen.getByRole('radio', { name: 'Island' }));
    expect(stage()).toHaveAttribute('data-shape', 'island');
  });

  describe('hover choreography', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    const hoverZone = () => {
      const zone = document.querySelector('.demo__hover-zone');
      if (zone === null) throw new Error('hover zone missing');
      return zone;
    };

    it('reveals after the hover-intent delay, opens after resting, collapses after the grace', () => {
      renderDemo();
      fireEvent.pointerEnter(hoverZone(), { pointerType: 'mouse' });
      act(() => {
        vi.advanceTimersByTime(timings.hoverIntentMs - 1);
      });
      expect(stage()).toHaveAttribute('data-state', 'collapsed');
      act(() => {
        vi.advanceTimersByTime(1);
      });
      expect(stage()).toHaveAttribute('data-state', 'reveal');
      act(() => {
        vi.advanceTimersByTime(timings.revealToExpandMs);
      });
      expect(screen.getByRole('dialog', { name: 'Media' })).toBeInTheDocument();

      fireEvent.pointerLeave(hoverZone(), { pointerType: 'mouse' });
      act(() => {
        vi.advanceTimersByTime(timings.hoverOutGraceExpandedMs - 1);
      });
      expect(stage()).toHaveAttribute('data-state', 'expanded');
      act(() => {
        vi.advanceTimersByTime(1);
      });
      expect(stage()).toHaveAttribute('data-state', 'collapsed');
    });

    it('cancels a pending reveal when the pointer leaves early', () => {
      renderDemo();
      fireEvent.pointerEnter(hoverZone(), { pointerType: 'mouse' });
      act(() => {
        vi.advanceTimersByTime(timings.hoverIntentMs / 2);
      });
      fireEvent.pointerLeave(hoverZone(), { pointerType: 'mouse' });
      act(() => {
        vi.advanceTimersByTime(timings.revealToExpandMs * 2);
      });
      expect(screen.queryByRole('dialog')).toBeNull();
      expect(stage()).toHaveAttribute('data-state', 'collapsed');
    });

    it('ignores touch and pen hover, which have no hover intent', () => {
      renderDemo();
      fireEvent.pointerEnter(hoverZone(), { pointerType: 'touch' });
      act(() => {
        vi.advanceTimersByTime(timings.hoverIntentMs + timings.revealToExpandMs);
      });
      expect(stage()).toHaveAttribute('data-state', 'collapsed');
    });

    it('stays open while pinned', () => {
      renderDemo();
      fireEvent.click(screen.getByRole('button', { name: 'Open the notch' }));
      fireEvent.click(screen.getByRole('button', { name: 'Pin the panel open' }));
      fireEvent.pointerLeave(hoverZone(), { pointerType: 'mouse' });
      act(() => {
        vi.advanceTimersByTime(timings.hoverOutGraceExpandedMs * 2);
      });
      expect(screen.getByRole('dialog', { name: 'Media' })).toBeInTheDocument();
    });
  });
});
