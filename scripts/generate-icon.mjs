// Generates the 1024×1024 placeholder app icon (black continuous-corner tile with the notch
// strip) and runs `tauri icon` to derive every platform size. Only pure Node: no image deps.
//   node scripts/generate-icon.mjs
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { deflateSync } from 'node:zlib';

import { run } from './lib.mjs';

const size = 1024;
const tile = { inset: 64, radius: 224 };
const strip = { width: 400, height: 76, top: 176, radius: 30 };

const crcTable = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const byte of buf) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const typeAndData = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typeAndData));
  return Buffer.concat([len, typeAndData, crc]);
};

// Signed distance to a rounded rectangle; negative inside.
const roundedRect = (px, py, x, y, w, h, r) => {
  const cx = Math.max(x + r - px, 0, px - (x + w - r));
  const cy = Math.max(y + r - py, 0, py - (y + h - r));
  return Math.hypot(cx, cy) - r;
};
const coverage = (d) => Math.min(1, Math.max(0, 0.5 - d));

const raw = Buffer.alloc((size * 4 + 1) * size);
for (let y = 0; y < size; y += 1) {
  raw[y * (size * 4 + 1)] = 0; // filter: none
  for (let x = 0; x < size; x += 1) {
    const px = x + 0.5;
    const py = y + 0.5;
    const tileA = coverage(
      roundedRect(
        px,
        py,
        tile.inset,
        tile.inset,
        size - 2 * tile.inset,
        size - 2 * tile.inset,
        tile.radius,
      ),
    );
    const stripA = coverage(
      roundedRect(
        px,
        py,
        (size - strip.width) / 2,
        strip.top,
        strip.width,
        strip.height,
        strip.radius,
      ),
    );
    // Tile is near-black (#050506); strip is off-white (#f5f5f7), composited over the tile.
    const grey = 5 + (245 - 5) * stripA;
    const blue = 6 + (247 - 6) * stripA;
    const o = y * (size * 4 + 1) + 1 + x * 4;
    raw[o] = Math.round(grey);
    raw[o + 1] = Math.round(grey);
    raw[o + 2] = Math.round(blue);
    raw[o + 3] = Math.round(255 * tileA);
  }
}

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(size, 0);
ihdr.writeUInt32BE(size, 4);
ihdr[8] = 8; // bit depth
ihdr[9] = 6; // RGBA
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
]);

const source = path.join(mkdtempSync(path.join(tmpdir(), 'muna-icon-')), 'icon.png');
writeFileSync(source, png);
console.log(`wrote ${source} (${png.length} bytes)`);

run('pnpm', ['--filter', '@muna/desktop', 'tauri', 'icon', source, '--output', 'src-tauri/icons']);
