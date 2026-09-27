import { afterEach, describe, expect, it, vi } from 'vitest';

import { clearLiveAnnouncements, settleAnimations } from './preview';

// The markup React Aria's LiveAnnouncer builds: a hidden wrapper holding one log per politeness.
function mountLiveRegion(): HTMLDivElement {
  const region = document.createElement('div');
  region.dataset.liveAnnouncer = 'true';
  for (const politeness of ['assertive', 'polite']) {
    const log = document.createElement('div');
    log.setAttribute('role', 'log');
    log.setAttribute('aria-live', politeness);
    const announcement = document.createElement('div');
    announcement.setAttribute('role', 'img');
    announcement.setAttribute('aria-labelledby', 'gone-button');
    log.append(announcement);
    region.append(log);
  }
  document.body.prepend(region);
  return region;
}

describe('clearLiveAnnouncements', () => {
  afterEach(() => {
    document.body.replaceChildren();
  });

  it('empties every live-region log but keeps the region itself', () => {
    const region = mountLiveRegion();
    const app = document.createElement('div');
    app.setAttribute('role', 'log');
    app.append(document.createElement('p'));
    document.body.append(app);

    clearLiveAnnouncements();

    expect(region.isConnected).toBe(true);
    expect(region.querySelectorAll('[role="log"]')).toHaveLength(2);
    expect(region.querySelectorAll('[role="img"]')).toHaveLength(0);
    expect(app.childElementCount).toBe(1);
  });

  it('is a no-op when nothing has been announced', () => {
    expect(() => {
      clearLiveAnnouncements();
    }).not.toThrow();
  });
});

// jsdom has no Web Animations API; a stub of `document.getAnimations` stands in for it.
function fakeAnimation(iterations: number, finish: Promise<unknown>): Animation {
  return {
    playState: 'running',
    effect: { getTiming: () => ({ iterations }) },
    finished: finish,
  } as unknown as Animation;
}

describe('settleAnimations', () => {
  afterEach(() => {
    Reflect.deleteProperty(document, 'getAnimations');
    vi.useRealTimers();
  });

  it('returns once the running finite animations have finished', async () => {
    let finish: (() => void) | undefined;
    const enter = fakeAnimation(
      1,
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
    );
    let calls = 0;
    document.getAnimations = () => {
      calls += 1;
      return calls === 1 ? [enter] : [];
    };

    let settled = false;
    const wait = settleAnimations().then(() => {
      settled = true;
    });
    // Past the warm-up the animation is found and awaited.
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(settled).toBe(false);
    finish?.();
    await wait;
    expect(settled).toBe(true);
  });

  it('skips looping animations and settles at once', async () => {
    document.getAnimations = () => [fakeAnimation(Infinity, new Promise(() => undefined))];
    await expect(settleAnimations()).resolves.toBeUndefined();
  });

  it('gives up after the limit when an animation never finishes', async () => {
    vi.useFakeTimers();
    document.getAnimations = () => [fakeAnimation(1, new Promise(() => undefined))];
    const wait = settleAnimations(200);
    // The warm-up, then the whole limit.
    await vi.advanceTimersByTimeAsync(400);
    await expect(wait).resolves.toBeUndefined();
  });

  it('does nothing where the Web Animations API is missing', async () => {
    await expect(settleAnimations()).resolves.toBeUndefined();
  });
});
