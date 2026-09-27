import { afterEach, describe, expect, it } from 'vitest';

import { clearLiveAnnouncements } from './preview';

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
