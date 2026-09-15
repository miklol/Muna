import type { Preview } from '@storybook/react-vite';

import '../src/tokens/fonts.css';
import '../src/tokens/tokens.css';
import './preview.css';
import { MunaMotionProvider } from '../src/motion/reduced-motion';

const preview: Preview = {
  parameters: {
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
  },
  globalTypes: {
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
  },
  initialGlobals: {
    backgrounds: { value: 'panel' },
    reduceMotion: 'off',
    direction: 'ltr',
  },
  decorators: [
    // Every story runs inside the same provider the app windows use, so pure-CSS states get
    // their `--muna-motion-*` easings and the toolbar switch mirrors the app setting.
    (Story, context) => (
      <MunaMotionProvider reduceMotion={context.globals.reduceMotion === 'on'}>
        <div dir={context.globals.direction === 'rtl' ? 'rtl' : 'ltr'}>
          <Story />
        </div>
      </MunaMotionProvider>
    ),
  ],
};

export default preview;
