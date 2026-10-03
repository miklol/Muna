//! Album artwork for the UI (docs/modules/media.md "Adaptive colours", perf budget "artwork
//! ≤ 512 px cached"): decode the bytes an app handed to the OS, cap the size, extract three
//! swatches and hand the UI a data URL plus CSS colours. Pure image work — no platform types —
//! so the same code serves any module that shows a picture.

mod cache;
mod palette;

use std::fmt;

use base64::Engine;
use base64::engine::general_purpose::STANDARD;
use image::{DynamicImage, GenericImageView, ImageFormat};
use serde::{Deserialize, Serialize};
use specta::Type;

pub use cache::ArtCache;
pub use palette::{Rgb, extract_palette};

/// Longest side the UI ever needs (panel art is 96 CSS px at up to 3× scale, with headroom).
pub const MAX_SIDE: u32 = 512;
/// Longest side of the image the palette is computed from.
const PALETTE_SIDE: u32 = 48;

/// Prepared artwork as the UI consumes it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct Artwork {
    /// Cache key ([`art_key`]); the media state refers to artwork by it.
    pub key: String,
    /// `data:image/…;base64,…`, at most [`MAX_SIDE`] px on the longest side.
    pub src: String,
    /// Three CSS colours, dominant first (`--media-accent-1..3`).
    pub palette: Vec<String>,
    pub width: u32,
    pub height: u32,
}

#[derive(Debug)]
pub enum ArtworkError {
    Decode(image::ImageError),
    Encode(image::ImageError),
}

impl fmt::Display for ArtworkError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Decode(error) => write!(f, "artwork could not be decoded: {error}"),
            Self::Encode(error) => write!(f, "artwork could not be re-encoded: {error}"),
        }
    }
}

impl std::error::Error for ArtworkError {}

/// Stable key for one piece of art: FNV-1a of title, artist and album. Independent of the
/// bytes so a re-delivered thumbnail for the same track hits the cache.
#[must_use]
pub fn art_key(title: &str, artist: &str, album: Option<&str>) -> String {
    let mut hash = 0xcbf2_9ce4_8422_2325_u64;
    for part in [title, artist, album.unwrap_or_default()] {
        for byte in part.bytes().chain(std::iter::once(0)) {
            hash = (hash ^ u64::from(byte)).wrapping_mul(0x0100_0000_01b3);
        }
    }
    format!("{hash:016x}")
}

/// Decodes `bytes`, downsizes when larger than [`MAX_SIDE`] and extracts the palette.
/// `content_type` is what the stream declared; the bytes decide when they disagree or it is
/// empty.
pub fn prepare(key: &str, bytes: &[u8], content_type: &str) -> Result<Artwork, ArtworkError> {
    let format = image::guess_format(bytes).ok();
    let image = match format {
        Some(format) => image::load_from_memory_with_format(bytes, format),
        None => image::load_from_memory(bytes),
    }
    .map_err(ArtworkError::Decode)?;

    let (width, height) = image.dimensions();
    let (src, width, height) = if width.max(height) > MAX_SIDE {
        let resized = image.thumbnail(MAX_SIDE, MAX_SIDE);
        let (w, h) = resized.dimensions();
        (data_url(&encode_png(&resized)?, "image/png"), w, h)
    } else {
        let mime = format.and_then(mime_of).unwrap_or(content_type);
        (data_url(bytes, mime), width, height)
    };

    let palette = extract_palette(&image.thumbnail(PALETTE_SIDE, PALETTE_SIDE).to_rgb8())
        .iter()
        .map(Rgb::to_css)
        .collect();
    Ok(Artwork {
        key: key.to_owned(),
        src,
        palette,
        width,
        height,
    })
}

fn mime_of(format: ImageFormat) -> Option<&'static str> {
    match format {
        ImageFormat::Png => Some("image/png"),
        ImageFormat::Jpeg => Some("image/jpeg"),
        _ => None,
    }
}

fn encode_png(image: &DynamicImage) -> Result<Vec<u8>, ArtworkError> {
    let mut out = std::io::Cursor::new(Vec::new());
    image
        .write_to(&mut out, ImageFormat::Png)
        .map_err(ArtworkError::Encode)?;
    Ok(out.into_inner())
}

/// `data:<mime>;base64,…` for `bytes`; the Shelf hands thumbnails to the UI this way too.
#[must_use]
pub fn data_url(bytes: &[u8], mime: &str) -> String {
    let mime = if mime.is_empty() {
        "application/octet-stream"
    } else {
        mime
    };
    format!("data:{mime};base64,{}", STANDARD.encode(bytes))
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::{ImageBuffer, Rgb as ImageRgb};

    fn png(width: u32, height: u32, colour: [u8; 3]) -> Vec<u8> {
        let buffer = ImageBuffer::from_pixel(width, height, ImageRgb(colour));
        let mut out = std::io::Cursor::new(Vec::new());
        DynamicImage::ImageRgb8(buffer)
            .write_to(&mut out, ImageFormat::Png)
            .unwrap();
        out.into_inner()
    }

    #[test]
    fn keys_are_stable_and_distinguish_tracks() {
        assert_eq!(
            art_key("Song", "Artist", Some("Album")),
            art_key("Song", "Artist", Some("Album"))
        );
        assert_ne!(
            art_key("Song", "Artist", None),
            art_key("Song", "Artist", Some("Album"))
        );
        assert_ne!(
            art_key("SongArtist", "", None),
            art_key("Song", "Artist", None)
        );
        assert_eq!(art_key("a", "b", None).len(), 16);
    }

    #[test]
    fn small_art_passes_through_untouched_with_its_real_mime() {
        let bytes = png(64, 32, [200, 30, 30]);
        let art = prepare("k", &bytes, "image/jpeg").unwrap();
        assert_eq!((art.width, art.height), (64, 32));
        // The bytes are PNG whatever the stream claimed.
        assert!(art.src.starts_with("data:image/png;base64,"));
        assert_eq!(art.src, data_url(&bytes, "image/png"));
        assert_eq!(art.palette.len(), 3);
        assert_eq!(art.palette[0], "#c81e1e");
    }

    #[test]
    fn large_art_is_capped_at_the_budget_and_re_encoded() {
        let bytes = png(1000, 500, [10, 20, 30]);
        let art = prepare("k", &bytes, "image/png").unwrap();
        assert_eq!((art.width, art.height), (512, 256));
        assert!(art.src.starts_with("data:image/png;base64,"));
        assert!(art.src.len() < bytes.len() * 2);
    }

    #[test]
    fn garbage_is_a_decode_error() {
        assert!(matches!(
            prepare("k", b"not an image", "image/png"),
            Err(ArtworkError::Decode(_))
        ));
    }

    #[test]
    fn unknown_mime_falls_back_to_octet_stream() {
        assert_eq!(
            data_url(b"x", ""),
            "data:application/octet-stream;base64,eA=="
        );
    }
}
