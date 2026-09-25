import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { AlbumArt, paletteVars } from './album-art';

describe('AlbumArt', () => {
  it('publishes up to three palette swatches as custom properties', () => {
    expect(paletteVars(['#111111', '#222222', '#333333', '#444444'])).toEqual({
      '--media-accent-1': '#111111',
      '--media-accent-2': '#222222',
      '--media-accent-3': '#333333',
    });
    expect(paletteVars([])).toEqual({});
  });

  it('renders decorative artwork with the palette bleed when adaptive', () => {
    const { container } = render(
      <AlbumArt src="data:image/png;base64,AA==" palette={['#5ac8fa', '#bf5af2']} />,
    );
    const root = container.querySelector('.muna-album-art');
    expect(root).toHaveAttribute('data-tinted', 'true');
    expect(root).toHaveStyle({ '--media-accent-1': '#5ac8fa', inlineSize: '96px' });
    const image = container.querySelector('img');
    expect(image).toHaveAttribute('alt', '');
    expect(image).toHaveAttribute('draggable', 'false');
  });

  it('drops the bleed when adaptive colours are off or there is no palette', () => {
    const { container, rerender } = render(
      <AlbumArt src="x.png" palette={['#5ac8fa']} adaptive={false} />,
    );
    expect(container.querySelector('.muna-album-art')).not.toHaveAttribute('data-tinted');
    rerender(<AlbumArt src="x.png" />);
    expect(container.querySelector('.muna-album-art')).not.toHaveAttribute('data-tinted');
  });

  it('shows the fallback when there is no artwork and dims when asked', () => {
    const { container } = render(
      <AlbumArt src={null} size={40} dimmed fallback={<svg data-testid="icon" />} />,
    );
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('[data-testid="icon"]')).toBeInTheDocument();
    const root = container.querySelector('.muna-album-art');
    expect(root).toHaveAttribute('data-dimmed', 'true');
    expect(root).toHaveStyle({ inlineSize: '40px', blockSize: '40px' });
  });
});
