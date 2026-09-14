import type { Preview } from '@storybook/react-vite';

import '../src/tokens/tokens.css';
import './preview.css';

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
  initialGlobals: {
    backgrounds: { value: 'panel' },
  },
};

export default preview;
