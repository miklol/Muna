import type {
  MorphReport,
  ShapeRect,
  ShellLayout,
  StripContent,
  YieldState,
} from '@muna/contracts';
import type * as Contracts from '@muna/contracts';
import { STRIP_HEIGHT_PX } from '@muna/contracts';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AppProviders } from '../app-providers';
import { useAppStore } from '../store/app-store';
import { NotchWindow } from './notch-window';
import { shellSizes } from './shell-geometry';

/**
 * The notch shell scenario suite (docs/09-testing-qa.md, "Notch shell scenario suite"), UI
 * half: the real component and the real springs, with the shell's IPC faked. Rust's half of
 * each scenario lives in `src-tauri/tests/shell_model.rs`.
 *
 * Motion binds its frame loop to `requestAnimationFrame` when it loads, so the fake clock is
 * installed before any import and kept for the whole file: springs then run in fake time and a
 * morph settles inside `settle()`, which is what the material switch and the at-rest rects
 * hang off.
 */
vi.hoisted(() => {
  vi.useFakeTimers();
});

type Listener<T> = (event: { payload: T }) => void;

const ipc = vi.hoisted(() => {
  const ok = () => Promise.resolve({ status: 'ok' as const, data: null });
  const channel = <T,>() => {
    const listeners: Listener<T>[] = [];
    return {
      listen: vi.fn((callback: Listener<T>) => {
        listeners.push(callback);
        return Promise.resolve(() => {
          listeners.splice(listeners.indexOf(callback), 1);
        });
      }),
      emit: (payload: T) => {
        for (const listener of [...listeners]) {
          listener({ payload });
        }
      },
    };
  };
  return {
    commands: {
      getShellLayout: vi.fn(ok),
      shellReady: vi.fn(ok),
      publishShapeRects: vi.fn((_rects: ShapeRect[]) => ok()),
      setNotchFocusable: vi.fn((_focusable: boolean) => ok()),
      reportMorph: vi.fn((_report: MorphReport) => ok()),
    },
    content: channel<{ content: StripContent }>(),
    layout: channel<{ layout: ShellLayout }>(),
    yield: channel<{ label: string; state: YieldState }>(),
    toggle: channel<{ label: string }>(),
    pressOutside: channel<{ label: string }>(),
  };
});

vi.mock('@muna/contracts', async (importOriginal) => ({
  ...(await importOriginal<typeof Contracts>()),
  commands: ipc.commands,
  events: {
    stripContentChanged: { listen: ipc.content.listen },
    shellLayoutChanged: { listen: ipc.layout.listen },
    shellYieldChanged: { listen: ipc.yield.listen },
    shellToggleRequested: { listen: ipc.toggle.listen },
    shellPointerDownOutside: { listen: ipc.pressOutside.listen },
  },
}));

// --- geometry: jsdom lays nothing out, so the window and the shell node get their boxes here --

const WINDOW_WIDTH = 1120;
const CENTRE_X = WINDOW_WIDTH / 2;
const STRIP = { width: shellSizes.stripWidth, height: STRIP_HEIGHT_PX.default };
/** The strip at rest, centred: what every publish must start with. */
const STRIP_REST: ShapeRect = { x: CENTRE_X - STRIP.width / 2, y: 0, ...STRIP };
/** Points in window client coordinates. */
const ON_STRIP = { x: CENTRE_X, y: STRIP.height / 2 };
const FAR_AWAY = { x: 900, y: 450 };
/** Longer than any morph spring takes to settle. */
const SETTLE_MS = 2000;

const px = (value: string, fallback: number): number => {
  const parsed = Number.parseFloat(value);
  return Number.isNaN(parsed) ? fallback : parsed;
};

/** The shell node's box follows the size Motion has written to its inline style. */
const shellBox = (shell: HTMLElement): DOMRect => {
  const width = px(shell.style.width, STRIP.width);
  const height = px(shell.style.height, STRIP.height);
  const left = CENTRE_X - width / 2;
  return {
    x: left,
    y: 0,
    left,
    top: 0,
    width,
    height,
    right: left + width,
    bottom: height,
    toJSON: () => ({}),
  };
};

const layout = (overrides: Partial<ShellLayout> = {}): ShellLayout => ({
  label: 'notch',
  monitorId: '\\\\.\\DISPLAY1',
  isPrimary: true,
  enabled: true,
  mode: 'overlay',
  shape: 'notch',
  stripHeight: STRIP.height,
  stripTopOffset: 0,
  panelMaxWidth: 1000,
  scalePercent: 100,
  yieldState: 'none',
  ...overrides,
});

const notice: StripContent = {
  kind: 'notice',
  notice: { id: 'n1', module: 'clipboard', priority: 60, text: 'Copied', holdMs: 4000 },
};

// --- driving the component -----------------------------------------------------------------

/** Advances the fake clock: machine timers, animation frames and the promises between them. */
const advance = async (ms: number) => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
};

const settle = () => advance(SETTLE_MS);

/** A pointer sample with an explicit timestamp, so the velocity gate sees real motion. */
const pointer = (
  target: Element,
  type: 'pointermove' | 'pointerdown',
  point: { x: number; y: number },
  timeStamp: number,
) => {
  const event = new PointerEvent(type, {
    bubbles: true,
    cancelable: true,
    clientX: point.x,
    clientY: point.y,
    pointerType: 'mouse',
    isPrimary: true,
  });
  Object.defineProperty(event, 'timeStamp', { value: timeStamp });
  fireEvent(target, event);
};

const lastRects = (): ShapeRect[] => {
  const rects = ipc.commands.publishShapeRects.mock.lastCall?.[0];
  if (rects === undefined) {
    throw new Error('nothing published');
  }
  return rects;
};

const stateOf = (main: HTMLElement) => main.getAttribute('data-state');

/** The material the surface paints and whether it is mid-morph (`NotchSurface` classes). */
const surfaceOf = (main: HTMLElement) => {
  const surface = main.querySelector('.muna-notch-surface');
  if (surface === null) {
    throw new Error('no surface');
  }
  return {
    material: surface.classList.contains('muna-notch-surface--expanded') ? 'panel' : 'strip',
    morphing: surface.classList.contains('muna-notch-surface--morphing'),
  };
};

const renderNotch = (panelBody?: ReactNode) => {
  render(
    <AppProviders>
      <NotchWindow panelBody={panelBody} />
    </AppProviders>,
  );
  const main = screen.getByRole('main');
  const shell = screen.getByTestId('shell');
  vi.spyOn(shell, 'getBoundingClientRect').mockImplementation(() => shellBox(shell));
  return { main, shell };
};

const openWithHotkey = (main: HTMLElement) => {
  act(() => {
    ipc.toggle.emit({ label: 'notch' });
  });
  expect(stateOf(main)).toBe('expanded');
};

describe('NotchWindow scenario suite', () => {
  beforeEach(() => {
    vi.spyOn(Element.prototype, 'clientWidth', 'get').mockImplementation(function (this: Element) {
      return this.tagName === 'MAIN' ? WINDOW_WIDTH : 0;
    });
    useAppStore.setState({ stripContent: { kind: 'idle' }, shellLayout: null, yieldState: 'none' });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  it('mounts collapsed, publishes the strip at rest as its only rect, then reports ready', async () => {
    const { main } = renderNotch();
    expect(stateOf(main)).toBe('collapsed');
    expect(screen.getByRole('region', { name: 'Notch strip' })).toHaveAttribute(
      'data-kind',
      'idle',
    );
    expect(surfaceOf(main)).toEqual({ material: 'strip', morphing: false });
    expect(ipc.commands.publishShapeRects).toHaveBeenCalledTimes(1);
    expect(lastRects()).toEqual([STRIP_REST]);
    expect(ipc.commands.shellReady).not.toHaveBeenCalled();

    // Two animation frames after mount.
    await advance(40);
    expect(ipc.commands.shellReady).toHaveBeenCalledTimes(1);
    expect(ipc.commands.publishShapeRects).toHaveBeenCalledTimes(1);
    expect(ipc.commands.getShellLayout).toHaveBeenCalledTimes(1);
    expect(ipc.commands.reportMorph).not.toHaveBeenCalled();
  });

  it('S1: a pointer resting on the strip reveals after 250 ms and the interactive rect grows', async () => {
    const { main } = renderNotch();
    pointer(main, 'pointermove', ON_STRIP, 0);
    await advance(249);
    expect(stateOf(main)).toBe('collapsed');
    expect(ipc.commands.publishShapeRects).toHaveBeenCalledTimes(1);

    await advance(1);
    expect(stateOf(main)).toBe('hoverReveal');
    expect(surfaceOf(main)).toEqual({ material: 'strip', morphing: true });
    const rects = lastRects();
    expect(rects).toHaveLength(2);
    expect(rects[0]).toEqual(STRIP_REST);
    // The padded reveal: (200 + 16) + 2 × 30 wide, (32 + 4) + 2 × 30 tall, at least.
    expect(rects[1]!.width).toBeGreaterThanOrEqual(276);
    expect(rects[1]!.height).toBeGreaterThanOrEqual(96);
  });

  it('S2: a pointer crossing the strip at 1200 px/s never reveals', async () => {
    const { main } = renderNotch();
    // 440 → 680 in 12 px steps every 10 ms: over the strip (460–660) for about 170 ms.
    for (let step = 0; step <= 20; step += 1) {
      pointer(main, 'pointermove', { x: 440 + step * 12, y: ON_STRIP.y }, step * 10);
      await advance(10);
    }
    expect(stateOf(main)).toBe('collapsed');
    await advance(300);
    expect(stateOf(main)).toBe('collapsed');
    expect(ipc.commands.publishShapeRects).toHaveBeenCalledTimes(1);
  });

  it('S3: resting through the reveal opens the panel at 600 ms without taking focus', async () => {
    const { main } = renderNotch();
    pointer(main, 'pointermove', ON_STRIP, 0);
    await advance(599);
    expect(stateOf(main)).toBe('hoverReveal');
    await advance(1);
    expect(stateOf(main)).toBe('expanded');
    expect(within(main).getByRole('region', { name: 'Notch panel' })).toBeInTheDocument();
    expect(screen.getByText('Nothing to show yet')).toBeInTheDocument();
    expect(ipc.commands.setNotchFocusable).not.toHaveBeenCalled();
    // The panel's material from the first frame of the morph.
    expect(surfaceOf(main)).toEqual({ material: 'panel', morphing: true });

    const rects = lastRects();
    expect(rects).toHaveLength(2);
    expect(rects[0]).toEqual(STRIP_REST);
    // The padded panel: clamp(720, monitor − 80, 1000) wide and at least 190 tall, plus 2 × 30.
    expect(rects[1]!.width).toBeGreaterThanOrEqual(shellSizes.panelMinWidth + 60);
    expect(rects[1]!.height).toBeGreaterThanOrEqual(shellSizes.panelMinHeight + 60);

    // The spring settles: the mask comes back, one frame report reaches the shell's log and
    // the rects are the panel's at rest.
    await settle();
    expect(surfaceOf(main)).toEqual({ material: 'panel', morphing: false });
    expect(ipc.commands.reportMorph.mock.calls.at(-1)?.[0]).toMatchObject({ expanded: true });
    expect(lastRects()).toEqual([
      STRIP_REST,
      { x: CENTRE_X - 500 - 30, y: -30, width: 1000 + 60, height: 190 + 60 },
    ]);
  });

  it('S3: leaving during the reveal collapses after the short grace', async () => {
    const { main } = renderNotch();
    pointer(main, 'pointermove', ON_STRIP, 0);
    await advance(250);
    expect(stateOf(main)).toBe('hoverReveal');
    pointer(main, 'pointermove', FAR_AWAY, 300);
    await advance(149);
    expect(stateOf(main)).toBe('hoverReveal');
    await advance(1);
    expect(stateOf(main)).toBe('collapsed');
    await settle();
    expect(lastRects()).toEqual([STRIP_REST]);
    expect(surfaceOf(main)).toEqual({ material: 'strip', morphing: false });
  });

  it('S4: a press outside — on the padding, or reported by the shell — collapses the panel', async () => {
    const { main } = renderNotch();
    openWithHotkey(main);
    await settle();
    pointer(main, 'pointerdown', FAR_AWAY, 100);
    expect(stateOf(main)).toBe('collapsed');
    // Content leaves first; the shape keeps the panel's material until it has settled.
    expect(surfaceOf(main)).toEqual({ material: 'panel', morphing: true });
    await settle();
    expect(surfaceOf(main)).toEqual({ material: 'strip', morphing: false });
    expect(lastRects()).toEqual([STRIP_REST]);
    expect(ipc.commands.reportMorph.mock.calls.at(-1)?.[0]).toMatchObject({ expanded: false });

    openWithHotkey(main);
    act(() => {
      ipc.pressOutside.emit({ label: 'notch-1' });
    });
    expect(stateOf(main)).toBe('expanded');
    act(() => {
      ipc.pressOutside.emit({ label: 'notch' });
    });
    expect(stateOf(main)).toBe('collapsed');
  });

  it('a press or a scroll-down on the strip opens the panel', async () => {
    const { main, shell } = renderNotch();
    pointer(main, 'pointerdown', ON_STRIP, 0);
    expect(stateOf(main)).toBe('expanded');

    act(() => {
      ipc.toggle.emit({ label: 'notch' });
    });
    expect(stateOf(main)).toBe('collapsed');
    await settle();
    fireEvent.wheel(shell, { deltaY: -40 });
    expect(stateOf(main)).toBe('collapsed');
    fireEvent.wheel(shell, { deltaY: 40 });
    expect(stateOf(main)).toBe('expanded');
  });

  it('the hotkey toggles this window only, and a panel it opened waits for the pointer', async () => {
    const { main } = renderNotch();
    act(() => {
      ipc.toggle.emit({ label: 'notch-1' });
    });
    expect(stateOf(main)).toBe('collapsed');

    openWithHotkey(main);
    await advance(5000);
    expect(stateOf(main)).toBe('expanded');

    // The pointer visits and leaves: the 300 ms grace applies.
    pointer(main, 'pointermove', ON_STRIP, 0);
    pointer(main, 'pointermove', FAR_AWAY, 100);
    await advance(299);
    expect(stateOf(main)).toBe('expanded');
    await advance(1);
    expect(stateOf(main)).toBe('collapsed');

    openWithHotkey(main);
    act(() => {
      ipc.toggle.emit({ label: 'notch' });
    });
    expect(stateOf(main)).toBe('collapsed');
  });

  it('S11: a text field pins the panel and asks for keyboard focus; Esc hands it back, then closes', async () => {
    const { main } = renderNotch(<input aria-label="Search" />);
    openWithHotkey(main);
    await settle();
    const field = screen.getByRole('textbox', { name: 'Search' });
    act(() => {
      field.focus();
    });
    expect(field).toHaveFocus();
    expect(stateOf(main)).toBe('pinned');
    expect(ipc.commands.setNotchFocusable).toHaveBeenCalledTimes(1);
    expect(ipc.commands.setNotchFocusable).toHaveBeenLastCalledWith(true);

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(field).not.toHaveFocus();
    expect(ipc.commands.setNotchFocusable).toHaveBeenLastCalledWith(false);
    expect(stateOf(main)).toBe('expanded');

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(stateOf(main)).toBe('collapsed');
  });

  it('S11: collapsing while a field has focus blurs it and hands focus back', () => {
    const { main } = renderNotch(<input aria-label="Search" />);
    openWithHotkey(main);
    const field = screen.getByRole('textbox', { name: 'Search' });
    act(() => {
      field.focus();
    });
    expect(stateOf(main)).toBe('pinned');

    fireEvent.click(screen.getByRole('button', { name: 'Collapse to the strip' }));
    expect(stateOf(main)).toBe('collapsed');
    expect(field).not.toHaveFocus();
    expect(ipc.commands.setNotchFocusable).toHaveBeenLastCalledWith(false);
  });

  it('the pin keeps the panel open when the pointer leaves; unpinning resumes auto-collapse', async () => {
    const { main } = renderNotch();
    openWithHotkey(main);
    fireEvent.click(screen.getByRole('button', { name: 'Keep the panel open' }));
    expect(stateOf(main)).toBe('pinned');
    const unpin = screen.getByRole('button', { name: 'Let the panel close by itself' });
    expect(unpin).toHaveAttribute('aria-pressed', 'true');

    pointer(main, 'pointermove', ON_STRIP, 0);
    pointer(main, 'pointermove', FAR_AWAY, 100);
    await advance(5000);
    expect(stateOf(main)).toBe('pinned');

    fireEvent.click(unpin);
    expect(stateOf(main)).toBe('expanded');
    await advance(300);
    expect(stateOf(main)).toBe('collapsed');
  });

  it('S5–S7: peek and parked follow the shell for this window only; parked hides everything', async () => {
    const { main } = renderNotch();
    act(() => {
      ipc.yield.emit({ label: 'notch-1', state: 'peek' });
    });
    expect(main).toHaveAttribute('data-yield', 'none');
    expect(stateOf(main)).toBe('collapsed');

    act(() => {
      ipc.yield.emit({ label: 'notch', state: 'peek' });
    });
    expect(main).toHaveAttribute('data-yield', 'peek');
    expect(stateOf(main)).toBe('peek');
    expect(screen.getByRole('region', { name: 'Notch strip' })).toBeVisible();
    await settle();
    // The strip at rest stays the reference for the yield rules, even while peeking.
    expect(lastRects()).toEqual([STRIP_REST]);

    act(() => {
      ipc.yield.emit({ label: 'notch', state: 'parked' });
    });
    expect(stateOf(main)).toBe('parked');
    expect(main).not.toBeVisible();
    expect(screen.queryByTestId('shell')).not.toBeInTheDocument();

    const published = ipc.commands.publishShapeRects.mock.calls.length;
    act(() => {
      ipc.yield.emit({ label: 'notch', state: 'none' });
    });
    expect(stateOf(main)).toBe('collapsed');
    expect(main).toBeVisible();
    expect(screen.getByTestId('shell')).toBeInTheDocument();
    // Nothing changed while parked, so the shell still holds the right rects.
    expect(ipc.commands.publishShapeRects).toHaveBeenCalledTimes(published);
    expect(surfaceOf(main)).toEqual({ material: 'strip', morphing: false });
  });

  it('S6: parking an open panel closes it and drops its timers', async () => {
    const { main } = renderNotch();
    pointer(main, 'pointermove', ON_STRIP, 0);
    await advance(600);
    expect(stateOf(main)).toBe('expanded');

    act(() => {
      ipc.yield.emit({ label: 'notch', state: 'parked' });
    });
    expect(stateOf(main)).toBe('parked');
    act(() => {
      ipc.yield.emit({ label: 'notch', state: 'none' });
    });
    expect(stateOf(main)).toBe('collapsed');
    await advance(5000);
    expect(stateOf(main)).toBe('collapsed');
  });

  it('S13: a new layout re-publishes the strip at its new size and offset', async () => {
    const { main } = renderNotch();
    act(() => {
      ipc.layout.emit({
        layout: layout({ label: 'notch-1', shape: 'island', stripHeight: 38 }),
      });
    });
    expect(main).toHaveAttribute('data-shape', 'notch');
    expect(ipc.commands.publishShapeRects).toHaveBeenCalledTimes(1);

    act(() => {
      ipc.layout.emit({
        layout: layout({ shape: 'island', stripHeight: 38, stripTopOffset: 8 }),
      });
    });
    expect(main).toHaveAttribute('data-shape', 'island');
    const stripRest = { x: STRIP_REST.x, y: 8, width: STRIP.width, height: 38 };
    expect(lastRects()[0]).toEqual(stripRest);
    await settle();
    expect(lastRects()).toEqual([stripRest]);
  });

  it('the wide form widens the strip rect the yield rules measure against', async () => {
    const { main } = renderNotch();
    act(() => {
      ipc.content.emit({ content: notice });
    });
    expect(screen.getByRole('status')).toHaveTextContent('Copied');
    expect(stateOf(main)).toBe('collapsed');
    const wideRest = {
      x: CENTRE_X - shellSizes.stripWideWidth / 2,
      y: 0,
      width: shellSizes.stripWideWidth,
      height: STRIP.height,
    };
    expect(lastRects()[0]).toEqual(wideRest);
    // At rest the wide strip is a single rect, so the shell keeps its idle poll rate.
    await settle();
    expect(lastRects()).toEqual([wideRest]);
  });
});
