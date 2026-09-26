import {
  AppWindow,
  Copy,
  Eject,
  Ellipsis,
  FileArchive,
  Folder,
  FolderInput,
  FolderOpen,
  FolderSearch,
  Share2,
  Trash2,
} from 'lucide-react';

import type { TileIcon } from './tiles';

/** Tile glyphs are outline icons at 40 px, stroke 1.5 (docs/reference/ui-observations.md). */
export const TILE_ICON_SIZE = 40;
const TILE_ICON_STROKE = 1.5;

interface TileGlyphProps {
  readonly icon: TileIcon;
  /** 40 in the row; settings rows ask for 20. */
  readonly size?: number;
}

/** The Lucide glyph for a tile; exhaustive so a new `TileIcon` cannot ship without one. */
export function TileGlyph({ icon, size = TILE_ICON_SIZE }: TileGlyphProps) {
  const props = {
    size,
    strokeWidth: TILE_ICON_STROKE,
    'aria-hidden': true,
    focusable: false,
  } as const;
  switch (icon) {
    case 'share':
      return <Share2 {...props} />;
    case 'folderCopy':
      return <Folder {...props} />;
    case 'folderMove':
      return <FolderInput {...props} />;
    case 'copyTo':
      return <Copy {...props} />;
    case 'moveTo':
      return <FolderInput {...props} />;
    case 'openWith':
      return <AppWindow {...props} />;
    case 'zip':
      return <FileArchive {...props} />;
    case 'unzip':
      return <FolderOpen {...props} />;
    case 'reveal':
      return <FolderSearch {...props} />;
    case 'trash':
      return <Trash2 {...props} />;
    case 'eject':
      return <Eject {...props} />;
    case 'more':
      return <Ellipsis {...props} />;
  }
}
