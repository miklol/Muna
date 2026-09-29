import type {
  MorphReport,
  Settings,
  ShapeRect,
  ShellLayout,
  StripContent,
  YieldState,
} from '@muna/contracts';
import type * as Contracts from '@muna/contracts';
import {
  defaultSettings,
  HUD_NOTICE_IDS,
  STRIP_HEIGHT_PX,
  writeHudSettings,
} from '@muna/contracts';
import type { MessageKey } from '@muna/i18n';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AppProviders } from '../app-providers';
import { queryClient } from '../lib/query-client';
import { cacheSettings } from '../lib/settings';
import type { ModuleDefinition } from '../modules/registry';
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
      setStripSuspended: vi.fn((_suspended: boolean) => ok()),
      getSettings: vi.fn(() => Promise.resolve(defaultSettings())),
      updateSettings: vi.fn((settings: Settings) =>
        Promise.resolve({ status: 'ok' as const, data: settings }),
      ),
      hudNudgeVolume: vi.fn((_delta: number) => ok()),
      hudSetVolume: vi.fn((_percent: number) => ok()),
      hudSetBrightness: vi.fn((_monitorId: string, _percent: number) => ok()),
      getHudSnapshot: vi.fn(() =>
        Promise.resolve({
          volume: { percent: 40, muted: false },
          micMuted: null,
          monitors: [{ id: 'panel', name: 'Built-in display', percent: 70, kind: 'internal' }],
          osd: 'suppressed',
        }),
      ),
    },
    content: channel<{ content: StripContent }>(),
    layout: channel<{ layout: ShellLayout }>(),
    yield: channel<{ label: string; state: YieldState }>(),
    toggle: channel<{ label: string }>(),
    pressOutside: channel<{ label: string }>(),
    settings: channel<{ settings: Settings }>(),
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
    settingsChanged: { listen: ipc.settings.listen },
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
  notice: {
    id: 'bluetooth:buds',
    module: 'live-activities',
    priority: 85,
    leading: { kind: 'icon', glyph: 'headphones', tint: 'blue' },
    trailing: { kind: 'battery', percent: 80, charging: false },
    wide: { kind: 'bluetoothConnected', name: 'Buds', batteryPercent: 80 },
    holdMs: 4000,
  },
};

/** The HUD's volume or brightness notice, glyph plus level track (docs/modules/hud.md). */
const hudNotice = (control: 'volume' | 'brightness', percent: number): StripContent => ({
  kind: 'notice',
  notice: {
    id: HUD_NOTICE_IDS[control],
    module: 'hud',
    priority: 80,
    leading: { kind: 'icon', glyph: control === 'volume' ? 'volumeMedium' : 'sun', tint: null },
    trailing: { kind: 'level', percent, muted: false },
    wide: null,
    holdMs: 1500,
  },
});

// --- driving the component -----------------------------------------------------------------

/** Advances the fake clock: machine timers, animation frames and the promises between them. */
const advance = async (ms: number) => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
};

const settle = () => advance(SETTLE_MS);

/** Advances in small steps until the surface reports the morph has settled. */
const settleShape = async (main: HTMLElement) => {
  for (let elapsed = 0; elapsed < SETTLE_MS; elapsed += 10) {
    if (!surfaceOf(main).morphing) {
      return;
    }
    await advance(10);
  }
  throw new Error('the morph never settled');
};

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

/**
 * Shell scenarios run without real modules (registered modules bring their own IPC and
 * timers); the module-bar cases pass `fakeModules` explicitly.
 */
const renderNotch = (panelBody?: ReactNode, modules: readonly ModuleDefinition[] = []) => {
  render(
    <AppProviders>
      <NotchWindow panelBody={panelBody} modules={modules} />
    </AppProviders>,
  );
  const main = screen.getByRole('main');
  const shell = screen.getByTestId('shell');
  vi.spyOn(shell, 'getBoundingClientRect').mockImplementation(() => shellBox(shell));
  return { main, shell };
};

/** Fake modules: real keys from the catalog stand in for titles, the bodies name themselves. */
const fakeModule = (id: string, titleKey: MessageKey): ModuleDefinition => ({
  id,
  titleKey,
  icon: () => <svg data-testid={`icon-${id}`} />,
  panel: () => <p>{`${id} body`}</p>,
});
const fakeModules: readonly ModuleDefinition[] = [
  fakeModule('strip', 'notch.strip'),
  fakeModule('settings', 'settings.title'),
  fakeModule('spike', 'spike.label'),
];

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
    useAppStore.setState({
      stripContent: { kind: 'idle' },
      shellLayout: null,
      yieldState: 'none',
      activeModuleId: null,
    });
    // The settings document is read once per window; seed it so the bar order is known at mount.
    queryClient.clear();
    cacheSettings(queryClient, defaultSettings());
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
    expect(within(main).getByRole('dialog', { name: 'Muna' })).toBeInTheDocument();
    expect(screen.getByText('Nothing to show yet')).toBeInTheDocument();
    // No module registered: no module bar, and the interactive rect is the panel alone.
    expect(screen.queryByRole('tablist')).toBeNull();
    expect(ipc.commands.setNotchFocusable).not.toHaveBeenCalled();
    // The panel's material from the first frame of the morph.
    expect(surfaceOf(main)).toEqual({ material: 'panel', morphing: true });

    const rects = lastRects();
    expect(rects).toHaveLength(2);
    expect(rects[0]).toEqual(STRIP_REST);
    // The padded panel: the shell's bound (1000 here) wide and at least 190 tall, plus 2 × 30.
    expect(rects[1]!.width).toBeGreaterThanOrEqual(shellSizes.panelWidth + 60);
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

  it('HUD: the wheel moves the volume while its notice shows, one step per notch, and the panel stays closed', async () => {
    const { main, shell } = renderNotch();
    act(() => {
      ipc.content.emit({ content: hudNotice('volume', 40) });
    });
    await settle();
    expect(screen.getByRole('slider', { name: 'Volume' })).toHaveValue('40');

    fireEvent.wheel(shell, { deltaY: 40 });
    fireEvent.wheel(shell, { deltaY: -120 });
    expect(ipc.commands.hudNudgeVolume.mock.calls).toEqual([[-2], [2]]);
    expect(stateOf(main)).toBe('collapsed');

    // Any other content: the wheel is the shell's again.
    act(() => {
      ipc.content.emit({ content: notice });
    });
    fireEvent.wheel(shell, { deltaY: 40 });
    expect(ipc.commands.hudNudgeVolume).toHaveBeenCalledTimes(2);
    expect(stateOf(main)).toBe('expanded');
  });

  it('HUD: "Scroll on strip: volume" makes the wheel a volume control over any closed strip', async () => {
    cacheSettings(
      queryClient,
      writeHudSettings(defaultSettings(), {
        replaceSystemFlyout: true,
        scrollOnStrip: 'volume',
        showLevelText: true,
      }),
    );
    const { main, shell } = renderNotch();
    await advance(40);
    fireEvent.wheel(shell, { deltaY: 40 });
    expect(ipc.commands.hudNudgeVolume).toHaveBeenLastCalledWith(-2);
    expect(stateOf(main)).toBe('collapsed');

    // The level text follows the setting.
    act(() => {
      ipc.content.emit({ content: hudNotice('volume', 40) });
    });
    await settle();
    expect(screen.getByRole('region', { name: 'Notch strip' })).toHaveTextContent('40%');

    // A press still opens the panel, and inside it the wheel scrolls content, not the volume.
    pointer(main, 'pointerdown', ON_STRIP, 0);
    expect(stateOf(main)).toBe('expanded');
    fireEvent.wheel(shell, { deltaY: 40 });
    expect(ipc.commands.hudNudgeVolume).toHaveBeenCalledTimes(1);
  });

  it('HUD: a press on the level track drags the level instead of opening the panel', async () => {
    const { main } = renderNotch();
    act(() => {
      ipc.content.emit({ content: hudNotice('volume', 40) });
    });
    await settle();
    const slider = screen.getByRole('slider', { name: 'Volume' });
    const track = slider.closest('.muna-level-track');
    if (track === null) {
      throw new Error('the level track is missing');
    }

    // Hovering the track is not hover intent for the panel.
    pointer(track, 'pointermove', ON_STRIP, 0);
    pointer(track, 'pointermove', ON_STRIP, 100);
    await advance(700);
    expect(stateOf(main)).toBe('collapsed');

    pointer(track, 'pointerdown', ON_STRIP, 800);
    expect(stateOf(main)).toBe('collapsed');

    // Keyboard steps count as a drag: volume follows live.
    fireEvent.keyDown(slider, { key: 'ArrowRight' });
    expect(ipc.commands.hudSetVolume).toHaveBeenLastCalledWith(41);
    expect(ipc.commands.hudSetBrightness).not.toHaveBeenCalled();
  });

  it('HUD: brightness is written once on release, to the only adjustable display', async () => {
    renderNotch();
    act(() => {
      ipc.content.emit({ content: hudNotice('brightness', 70) });
    });
    await settle();
    const slider = screen.getByRole('slider', { name: 'Brightness' });
    fireEvent.keyDown(slider, { key: 'ArrowRight' });
    expect(ipc.commands.hudSetVolume).not.toHaveBeenCalled();
    fireEvent.keyUp(slider, { key: 'ArrowRight' });
    await advance(10);
    expect(ipc.commands.getHudSnapshot).toHaveBeenCalledTimes(1);
    expect(ipc.commands.hudSetBrightness).toHaveBeenCalledWith('panel', 71);
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
    expect(screen.getByRole('status')).toHaveTextContent('Buds connected, battery 80%');
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

  it('S8: the strip pauses while the panel is open and resumes 150 ms after the collapse settles', async () => {
    const { main } = renderNotch();
    expect(ipc.commands.setStripSuspended).not.toHaveBeenCalled();
    openWithHotkey(main);
    expect(ipc.commands.setStripSuspended).toHaveBeenCalledTimes(1);
    expect(ipc.commands.setStripSuspended).toHaveBeenLastCalledWith(true);
    await settle();
    expect(ipc.commands.setStripSuspended).toHaveBeenCalledTimes(1);

    act(() => {
      ipc.toggle.emit({ label: 'notch' });
    });
    expect(stateOf(main)).toBe('collapsed');
    // Still paused while the shape is collapsing, and for a beat after it settles.
    await settleShape(main);
    expect(ipc.commands.setStripSuspended).toHaveBeenCalledTimes(1);
    await advance(99);
    expect(ipc.commands.setStripSuspended).toHaveBeenCalledTimes(1);
    await advance(51);
    expect(ipc.commands.setStripSuspended).toHaveBeenCalledTimes(2);
    expect(ipc.commands.setStripSuspended).toHaveBeenLastCalledWith(false);

    // Parking an open panel skips the morph: the strip still resumes.
    openWithHotkey(main);
    expect(ipc.commands.setStripSuspended).toHaveBeenLastCalledWith(true);
    act(() => {
      ipc.yield.emit({ label: 'notch', state: 'parked' });
    });
    await advance(150);
    expect(ipc.commands.setStripSuspended).toHaveBeenCalledTimes(4);
    expect(ipc.commands.setStripSuspended).toHaveBeenLastCalledWith(false);
  });

  describe('module bar and panel chrome (M1-E4)', () => {
    it('opens on the first module, names the dialog after it and hangs the bar 12 px under the panel', async () => {
      const { main } = renderNotch(undefined, fakeModules);
      expect(screen.queryByRole('tablist')).toBeNull();
      openWithHotkey(main);

      expect(within(main).getByRole('dialog', { name: 'Notch strip' })).toBeInTheDocument();
      expect(screen.getByText('strip body')).toBeInTheDocument();
      const bar = screen.getByRole('tablist', { name: 'Modules' });
      const tabs = within(bar).getAllByRole('tab');
      expect(tabs.map((tab) => tab.getAttribute('aria-label'))).toEqual([
        'Notch strip',
        'Muna settings',
        'Muna window spike',
      ]);
      expect(tabs[0]).toHaveAttribute('aria-selected', 'true');

      // The interactive rect spans panel and bar: 190 + 12 + 40 tall before the 30 px padding.
      await settle();
      expect(lastRects()).toEqual([
        STRIP_REST,
        {
          x: CENTRE_X - 500 - 30,
          y: -30,
          width: 1000 + 60,
          height: 190 + shellSizes.moduleBarGap + shellSizes.moduleBarHeight + 60,
        },
      ]);
    });

    it('switches modules from the bar and with Ctrl+Tab, keeping the panel open', async () => {
      const { main } = renderNotch(undefined, fakeModules);
      openWithHotkey(main);
      await settle();

      fireEvent.click(screen.getByRole('tab', { name: 'Muna settings' }));
      expect(useAppStore.getState().activeModuleId).toBe('settings');
      expect(within(main).getByRole('dialog', { name: 'Muna settings' })).toBeInTheDocument();
      expect(screen.getByRole('tab', { name: 'Muna settings' })).toHaveAttribute(
        'aria-selected',
        'true',
      );
      await settle();
      expect(screen.getByText('settings body')).toBeInTheDocument();
      expect(screen.queryByText('strip body')).toBeNull();
      expect(stateOf(main)).toBe('expanded');

      fireEvent.keyDown(window, { key: 'Tab', ctrlKey: true });
      expect(useAppStore.getState().activeModuleId).toBe('spike');
      fireEvent.keyDown(window, { key: 'Tab', ctrlKey: true, shiftKey: true });
      fireEvent.keyDown(window, { key: 'Tab', ctrlKey: true, shiftKey: true });
      expect(useAppStore.getState().activeModuleId).toBe('strip');
      // Plain Tab is left to the browser's focus order.
      fireEvent.keyDown(window, { key: 'Tab' });
      expect(useAppStore.getState().activeModuleId).toBe('strip');
    });

    it('reorders with Ctrl+Arrow and follows a saved order, dropping ids it does not know', async () => {
      const base = defaultSettings();
      cacheSettings(queryClient, {
        ...base,
        shell: { ...base.shell, moduleOrder: ['spike', 'gone', 'strip'] },
      });
      const { main } = renderNotch(undefined, fakeModules);
      openWithHotkey(main);
      const labels = () =>
        within(screen.getByRole('tablist'))
          .getAllByRole('tab')
          .map((tab) => tab.getAttribute('aria-label'));
      expect(labels()).toEqual(['Muna window spike', 'Notch strip', 'Muna settings']);

      fireEvent.keyDown(screen.getByRole('tab', { name: 'Muna window spike' }), {
        key: 'ArrowRight',
        ctrlKey: true,
      });
      // The new order goes into the settings cache (notified on the next tick) and to Rust.
      await settle();
      expect(labels()).toEqual(['Notch strip', 'Muna window spike', 'Muna settings']);
      expect(ipc.commands.updateSettings).toHaveBeenCalledTimes(1);
      expect(ipc.commands.updateSettings.mock.calls[0]?.[0].shell.moduleOrder).toEqual([
        'strip',
        'spike',
        'settings',
      ]);
      expect(stateOf(main)).toBe('expanded');
    });

    it('leaves disabled modules out of the bar and the Ctrl+Tab cycle', () => {
      const base = defaultSettings();
      cacheSettings(queryClient, {
        ...base,
        shell: { ...base.shell, disabledModules: ['settings'] },
      });
      const { main } = renderNotch(undefined, fakeModules);
      openWithHotkey(main);
      const labels = within(screen.getByRole('tablist'))
        .getAllByRole('tab')
        .map((tab) => tab.getAttribute('aria-label'));
      expect(labels).toEqual(['Notch strip', 'Muna window spike']);

      fireEvent.keyDown(window, { key: 'Tab', ctrlKey: true });
      expect(useAppStore.getState().activeModuleId).toBe('spike');
      fireEvent.keyDown(window, { key: 'Tab', ctrlKey: true });
      expect(useAppStore.getState().activeModuleId).toBe('strip');
    });

    it('the bar leaves with the panel and the rects shrink back to the strip', async () => {
      const { main } = renderNotch(undefined, fakeModules);
      openWithHotkey(main);
      await settle();
      expect(screen.getByRole('tablist')).toBeInTheDocument();

      fireEvent.keyDown(window, { key: 'Escape' });
      expect(stateOf(main)).toBe('collapsed');
      await settle();
      expect(screen.queryByRole('tablist')).toBeNull();
      expect(lastRects()).toEqual([STRIP_REST]);
    });
  });
});
