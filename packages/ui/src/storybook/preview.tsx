import type { Decorator, Preview } from '@storybook/react-vite';

import { MunaMotionProvider } from '../motion/reduced-motion';

/**
 * The Storybook preview every Muna project shares (the design system's own stories and the
 * desktop module states): canvas backgrounds, axe as a failing test, the Motion and Direction
 * toolbar switches and the provider that binds them. Projects spread `munaPreview` into their
 * `.storybook/preview.tsx` and add their own decorators after `withMunaGlobals`.
 */
export const munaParameters: NonNullable<Preview['parameters']> = {
  backgrounds: {
    options: {
      panel: { name: 'Panel', value: '#050506' },
      notch: { name: 'Notch black', value: '#000000' },
      desktop: { name: 'Desktop', value: '#3a3f4b' },
    },
  },
  a11y: {
    // Every story is an accessibility test; violations fail `storybook:ci`.
    test: 'error',
  },
};

export const munaGlobalTypes: NonNullable<Preview['globalTypes']> = {
  reduceMotion: {
    description: 'Settings → Appearance → Reduce motion',
    toolbar: {
      title: 'Motion',
      icon: 'accessibility',
      items: [
        { value: 'off', title: 'Full motion' },
        { value: 'on', title: 'Reduce motion' },
      ],
      dynamicTitle: true,
    },
  },
  direction: {
    description: 'Text direction',
    toolbar: {
      title: 'Direction',
      icon: 'transfer',
      items: [
        { value: 'ltr', title: 'LTR' },
        { value: 'rtl', title: 'RTL' },
      ],
      dynamicTitle: true,
    },
  },
  contrast: {
    description: 'Settings → Appearance → Increase contrast',
    toolbar: {
      title: 'Contrast',
      icon: 'contrast',
      items: [
        { value: 'system', title: 'Standard contrast' },
        { value: 'more', title: 'Increase contrast' },
      ],
      dynamicTitle: true,
    },
  },
};

export const munaInitialGlobals: NonNullable<Preview['initialGlobals']> = {
  backgrounds: { value: 'panel' },
  reduceMotion: 'off',
  direction: 'ltr',
  contrast: 'system',
};

/**
 * Every story runs inside the same provider the app windows use, so pure-CSS states get their
 * `--muna-motion-*` easings and the toolbar switches mirror the app settings: Reduce motion
 * through the provider, Increase contrast as `data-contrast` on `<html>` (where the app puts
 * it), so the token overrides apply to the story and to anything portalled out of it.
 */
export const withMunaGlobals: Decorator = (Story, context) => {
  if (context.globals.contrast === 'more') {
    document.documentElement.dataset.contrast = 'more';
  } else {
    delete document.documentElement.dataset.contrast;
  }
  return (
    <MunaMotionProvider reduceMotion={context.globals.reduceMotion === 'on'}>
      <div dir={context.globals.direction === 'rtl' ? 'rtl' : 'ltr'}>
        <Story />
      </div>
    </MunaMotionProvider>
  );
};

/**
 * Empties React Aria's live announcer before a story renders. A focused button that toggles
 * `isPending` is announced through `role="img"` nodes that reference the button's id, appended
 * to a body-level live region and kept for seven seconds. The test runner plays a file's stories
 * back to back in one page, so the previous story's nodes would dangle (their button is gone)
 * inside the next story's axe run, which checks the whole body. Clearing the logs keeps stories
 * isolated without touching a rule; it mirrors `clearAnnouncer()` through the DOM so it works
 * for whichever `react-aria` instance owns the region.
 */
export function clearLiveAnnouncements(root: ParentNode = document): void {
  for (const log of root.querySelectorAll('[data-live-announcer] [role="log"]')) {
    log.replaceChildren();
  }
}

const resetLiveRegion: NonNullable<Preview['beforeEach']> = () => {
  clearLiveAnnouncements();
};

/** The longest a story waits for its enter transitions before the audit runs anyway. */
export const SETTLE_MS = 3000;

/** Motion creates its Web Animations a frame or two after the commit; wait for them to show up. */
const WARMUP_MS = 100;

/**
 * Waits for the page's finite Web Animations to finish, `limit` milliseconds at most.
 *
 * Motion drives enter transitions through WAAPI. The test runner pauses CSS animations and
 * transitions before a story's `afterEach` hooks run but leaves WAAPI alone, and axe reads
 * computed styles: a story audited during a fade blends every foreground into the glass and
 * reports a contrast ratio no one ever sees at rest. Looping animations (shimmer) are skipped;
 * `finished` rejects for a cancelled animation, which counts as settled too.
 */
export async function settleAnimations(limit = SETTLE_MS): Promise<void> {
  if (typeof document.getAnimations !== 'function') return;
  const deadline = performance.now() + limit;
  await new Promise((resolve) => setTimeout(resolve, WARMUP_MS));
  const running = () =>
    document
      .getAnimations()
      .filter(
        (animation) =>
          animation.playState === 'running' &&
          animation.effect?.getTiming().iterations !== Infinity,
      );
  for (let active = running(); active.length > 0; active = running()) {
    const remaining = deadline - performance.now();
    if (remaining <= 0) return;
    await Promise.race([
      Promise.allSettled(active.map((animation) => animation.finished)),
      new Promise((resolve) => setTimeout(resolve, remaining)),
    ]);
  }
}

// Storybook runs `afterEach` hooks in reverse: the project's come before the a11y addon's audit.
const settleBeforeAudit: NonNullable<Preview['afterEach']> = async () => {
  await settleAnimations();
};

export const munaPreview = {
  parameters: munaParameters,
  globalTypes: munaGlobalTypes,
  initialGlobals: munaInitialGlobals,
  decorators: [withMunaGlobals],
  beforeEach: [resetLiveRegion],
  afterEach: [settleBeforeAudit],
} satisfies Preview;
