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
};

export const munaInitialGlobals: NonNullable<Preview['initialGlobals']> = {
  backgrounds: { value: 'panel' },
  reduceMotion: 'off',
  direction: 'ltr',
};

/**
 * Every story runs inside the same provider the app windows use, so pure-CSS states get their
 * `--muna-motion-*` easings and the toolbar switch mirrors the app setting.
 */
export const withMunaGlobals: Decorator = (Story, context) => (
  <MunaMotionProvider reduceMotion={context.globals.reduceMotion === 'on'}>
    <div dir={context.globals.direction === 'rtl' ? 'rtl' : 'ltr'}>
      <Story />
    </div>
  </MunaMotionProvider>
);

export const munaPreview = {
  parameters: munaParameters,
  globalTypes: munaGlobalTypes,
  initialGlobals: munaInitialGlobals,
  decorators: [withMunaGlobals],
} satisfies Preview;
