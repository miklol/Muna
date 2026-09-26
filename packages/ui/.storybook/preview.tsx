import type { Preview } from '@storybook/react-vite';
import '../src/tokens/fonts.css';
import '../src/tokens/tokens.css';
import './preview.css';
import { munaPreview } from '../src/storybook/preview';

// The shared preview (`@muna/ui/storybook`) carries the backgrounds, the axe gate and the Motion
// and Direction toolbar switches; the desktop app's Storybook layers its providers on top.
// Storybook's config parser needs the default export to resolve to an object literal in this file.
const preview: Preview = { ...munaPreview };

export default preview;
