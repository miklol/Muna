//! Shelf thumbnails (docs/modules/shelf.md): Explorer's own picture of a file through
//! `IShellItemImageFactory` — the cached thumbnail for images, documents and videos, the file
//! type's icon for everything else — handed back as PNG bytes the webview can show as-is.
//!
//! The factory wants an apartment-threaded caller and may render on a cache miss, so the work
//! runs on a fresh STA thread like the other shell operations. Paths are content and never
//! reach a log line.

use std::path::Path;

use windows::Win32::Foundation::SIZE;
use windows::Win32::Graphics::Gdi::{
    BI_RGB, BITMAPINFO, BITMAPINFOHEADER, DIB_RGB_COLORS, DeleteObject, GetDC, GetDIBits, HBITMAP,
    HGDIOBJ, ReleaseDC,
};
use windows::Win32::UI::Shell::{IShellItemImageFactory, SIIGBF_BIGGERSIZEOK, SIIGBF_RESIZETOFIT};
use windows::core::Interface;

use super::file_ops::{on_sta_thread, shell_item};
use super::os_error;
use crate::error::{PlatformError, PlatformResult};

/// Largest side the shell is asked for; bigger requests only cost memory.
const MAX_SIDE: u32 = 512;

/// A `size` × `size` (at most, aspect kept) PNG of `item`.
pub(super) fn thumbnail(item: &Path, size: u32) -> PlatformResult<Vec<u8>> {
    let path = item.to_path_buf();
    let requested = i32::try_from(size.clamp(1, MAX_SIDE)).unwrap_or(64);
    on_sta_thread("muna-thumbnail", move || {
        let factory: IShellItemImageFactory = shell_item(&path)?
            .cast()
            .map_err(|e| os_error("IShellItem::QueryInterface(IShellItemImageFactory)", &e))?;
        // SAFETY: plain COM call on a live interface. The bitmap it returns is ours to delete.
        #[allow(unsafe_code)]
        let bitmap = unsafe {
            factory.GetImage(
                SIZE {
                    cx: requested,
                    cy: requested,
                },
                SIIGBF_RESIZETOFIT | SIIGBF_BIGGERSIZEOK,
            )
        }
        .map_err(|e| os_error("IShellItemImageFactory::GetImage", &e))?;
        let owned = OwnedBitmap(bitmap);
        let pixels = read_bgra(&owned)?;
        encode_png(&pixels)
    })
}

/// Straight (non-premultiplied) RGBA pixels, top-down.
struct Pixels {
    width: u32,
    height: u32,
    rgba: Vec<u8>,
}

struct OwnedBitmap(HBITMAP);

impl Drop for OwnedBitmap {
    fn drop(&mut self) {
        // SAFETY: a bitmap the shell created for us and nobody else holds.
        #[allow(unsafe_code)]
        let _ = unsafe { DeleteObject(HGDIOBJ(self.0.0)) };
    }
}

/// Reads the bitmap as 32-bit BGRA through `GetDIBits` and converts it to straight RGBA. The
/// shell's thumbnails carry premultiplied alpha, which PNG does not have.
fn read_bgra(bitmap: &OwnedBitmap) -> PlatformResult<Pixels> {
    // SAFETY: the screen DC is always available and released below.
    #[allow(unsafe_code)]
    let dc = unsafe { GetDC(None) };
    if dc.is_invalid() {
        return Err(super::last_error("GetDC"));
    }
    let result = read_bgra_with(dc, bitmap);
    // SAFETY: balances `GetDC` above.
    #[allow(unsafe_code)]
    unsafe {
        ReleaseDC(None, dc);
    }
    result
}

fn read_bgra_with(
    dc: windows::Win32::Graphics::Gdi::HDC,
    bitmap: &OwnedBitmap,
) -> PlatformResult<Pixels> {
    let mut info = BITMAPINFO {
        bmiHeader: BITMAPINFOHEADER {
            biSize: u32::try_from(std::mem::size_of::<BITMAPINFOHEADER>()).unwrap_or(40),
            ..Default::default()
        },
        ..Default::default()
    };
    // SAFETY: with a null bits pointer `GetDIBits` only fills in the header; `info` is a
    // valid, writable `BITMAPINFO` sized for it.
    #[allow(unsafe_code)]
    let described = unsafe { GetDIBits(dc, bitmap.0, 0, 0, None, &raw mut info, DIB_RGB_COLORS) };
    if described == 0 {
        return Err(super::last_error("GetDIBits(header)"));
    }
    let width = u32::try_from(info.bmiHeader.biWidth).unwrap_or(0);
    let height = u32::try_from(info.bmiHeader.biHeight.abs()).unwrap_or(0);
    if width == 0 || height == 0 || width > MAX_SIDE * 4 || height > MAX_SIDE * 4 {
        return Err(PlatformError::Unsupported("thumbnail bitmap size"));
    }
    // Ask for top-down 32-bit BGRA regardless of how the bitmap is stored.
    info.bmiHeader.biPlanes = 1;
    info.bmiHeader.biBitCount = 32;
    info.bmiHeader.biCompression = BI_RGB.0;
    info.bmiHeader.biHeight = -i32::try_from(height).unwrap_or(i32::MAX);
    info.bmiHeader.biSizeImage = 0;
    let mut bgra = vec![0_u8; (width * height * 4) as usize];
    // SAFETY: `bgra` holds exactly width × height × 4 bytes, which is what a 32-bit DIB of
    // that size needs; `info` describes that format.
    #[allow(unsafe_code)]
    let copied = unsafe {
        GetDIBits(
            dc,
            bitmap.0,
            0,
            height,
            Some(bgra.as_mut_ptr().cast()),
            &raw mut info,
            DIB_RGB_COLORS,
        )
    };
    if copied == 0 {
        return Err(super::last_error("GetDIBits(pixels)"));
    }
    Ok(Pixels {
        width,
        height,
        rgba: to_straight_rgba(&bgra),
    })
}

/// BGRA with premultiplied alpha → RGBA with straight alpha. A bitmap without an alpha channel
/// (every pixel 0) is treated as opaque, which is what the shell means by it.
fn to_straight_rgba(bgra: &[u8]) -> Vec<u8> {
    let (pixels, _) = bgra.as_chunks::<4>();
    let opaque = pixels.iter().all(|px| px[3] == 0);
    pixels
        .iter()
        .flat_map(|px| {
            let a = if opaque { 255 } else { px[3] };
            let un = |c: u8| -> u8 {
                if a == 0 || a == 255 {
                    c
                } else {
                    u8::try_from((u32::from(c) * 255 + u32::from(a) / 2) / u32::from(a))
                        .unwrap_or(255)
                }
            };
            [un(px[2]), un(px[1]), un(px[0]), a]
        })
        .collect()
}

fn encode_png(pixels: &Pixels) -> PlatformResult<Vec<u8>> {
    let mut out = std::io::Cursor::new(Vec::new());
    image::write_buffer_with_format(
        &mut out,
        &pixels.rgba,
        pixels.width,
        pixels.height,
        image::ColorType::Rgba8,
        image::ImageFormat::Png,
    )
    .map_err(|_| PlatformError::Unsupported("thumbnail png encoding"))?;
    Ok(out.into_inner())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn premultiplied_bgra_becomes_straight_rgba() {
        // Half-transparent pure red, premultiplied: B=0 G=0 R=128 A=128 → R=255 A=128.
        assert_eq!(to_straight_rgba(&[0, 0, 128, 128]), vec![255, 0, 0, 128]);
        // Opaque blue keeps its channels and swaps to RGBA order.
        assert_eq!(to_straight_rgba(&[255, 0, 0, 255]), vec![0, 0, 255, 255]);
    }

    #[test]
    fn a_bitmap_without_alpha_is_opaque() {
        assert_eq!(
            to_straight_rgba(&[10, 20, 30, 0, 40, 50, 60, 0]),
            vec![30, 20, 10, 255, 60, 50, 40, 255]
        );
    }

    #[test]
    fn pixels_encode_as_png() {
        let png = encode_png(&Pixels {
            width: 2,
            height: 1,
            rgba: vec![255, 0, 0, 255, 0, 0, 255, 128],
        })
        .unwrap();
        assert_eq!(&png[..8], b"\x89PNG\r\n\x1a\n");
    }

    #[test]
    #[cfg_attr(
        not(feature = "platform-tests"),
        ignore = "touches the shell's thumbnail cache"
    )]
    fn the_shell_renders_a_thumbnail_for_a_real_file() {
        let png = thumbnail(Path::new(r"C:\Windows\System32\notepad.exe"), 64).unwrap();
        assert_eq!(&png[..8], b"\x89PNG\r\n\x1a\n");
    }
}
