//! Three swatches from a small image: k-means in RGB with deterministic seeding, so the same
//! artwork always yields the same colours (a cached palette and a recomputed one agree).

use image::RgbImage;

/// Number of swatches the design system consumes (`--media-accent-1..3`).
pub const SWATCHES: usize = 3;
const ITERATIONS: usize = 10;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Default)]
pub struct Rgb {
    pub r: u8,
    pub g: u8,
    pub b: u8,
}

impl Rgb {
    #[must_use]
    pub const fn new(r: u8, g: u8, b: u8) -> Self {
        Self { r, g, b }
    }

    /// `#rrggbb`.
    #[must_use]
    pub fn to_css(&self) -> String {
        format!("#{:02x}{:02x}{:02x}", self.r, self.g, self.b)
    }

    /// Rec. 601 luma, 0–255.
    fn luma(self) -> u32 {
        (299 * u32::from(self.r) + 587 * u32::from(self.g) + 114 * u32::from(self.b)) / 1000
    }

    fn distance2(self, other: Self) -> u64 {
        let d = |a: u8, b: u8| {
            let delta = i64::from(a) - i64::from(b);
            (delta * delta).unsigned_abs()
        };
        d(self.r, other.r) + d(self.g, other.g) + d(self.b, other.b)
    }
}

/// Dominant colours of `image`, largest cluster first. Always [`SWATCHES`] entries: when the
/// picture has fewer distinct colours the dominant one repeats, so the CSS variables are
/// always defined. Empty images yield black.
#[must_use]
pub fn extract_palette(image: &RgbImage) -> [Rgb; SWATCHES] {
    let pixels: Vec<Rgb> = image
        .pixels()
        .map(|p| Rgb::new(p.0[0], p.0[1], p.0[2]))
        .collect();
    if pixels.is_empty() {
        return [Rgb::default(); SWATCHES];
    }

    // Deterministic seeds: the luma quantiles (dark, mid, light) of the picture.
    let mut by_luma = pixels.clone();
    by_luma.sort_by_key(|p| (p.luma(), p.r, p.g, p.b));
    let n = by_luma.len();
    let mut centres = [
        by_luma[n / 6],
        by_luma[n / 2],
        by_luma[(n * 5 / 6).min(n - 1)],
    ];

    let mut sizes = [0usize; SWATCHES];
    for _ in 0..ITERATIONS {
        let mut sums = [[0u64; 3]; SWATCHES];
        sizes = [0; SWATCHES];
        for pixel in &pixels {
            let nearest = nearest(*pixel, &centres);
            sums[nearest][0] += u64::from(pixel.r);
            sums[nearest][1] += u64::from(pixel.g);
            sums[nearest][2] += u64::from(pixel.b);
            sizes[nearest] += 1;
        }
        let mut moved = false;
        for (index, centre) in centres.iter_mut().enumerate() {
            if sizes[index] == 0 {
                continue;
            }
            let count = sizes[index] as u64;
            let next = Rgb::new(
                mean(sums[index][0], count),
                mean(sums[index][1], count),
                mean(sums[index][2], count),
            );
            moved |= next != *centre;
            *centre = next;
        }
        if !moved {
            break;
        }
    }

    let mut order: Vec<usize> = (0..SWATCHES).collect();
    order.sort_by(|a, b| sizes[*b].cmp(&sizes[*a]).then_with(|| a.cmp(b)));
    let dominant = centres[order[0]];
    let mut palette = [dominant; SWATCHES];
    for (slot, index) in order.iter().enumerate() {
        palette[slot] = if sizes[*index] == 0 {
            dominant
        } else {
            centres[*index]
        };
    }
    palette
}

fn nearest(pixel: Rgb, centres: &[Rgb; SWATCHES]) -> usize {
    let mut best = 0;
    let mut best_distance = u64::MAX;
    for (index, centre) in centres.iter().enumerate() {
        let distance = pixel.distance2(*centre);
        if distance < best_distance {
            best = index;
            best_distance = distance;
        }
    }
    best
}

fn mean(sum: u64, count: u64) -> u8 {
    u8::try_from((sum + count / 2) / count).unwrap_or(u8::MAX)
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::Rgb as ImageRgb;

    #[test]
    fn a_solid_image_repeats_its_colour() {
        let image = RgbImage::from_pixel(8, 8, ImageRgb([10, 200, 30]));
        let palette = extract_palette(&image);
        assert_eq!(palette, [Rgb::new(10, 200, 30); 3]);
        assert_eq!(palette[0].to_css(), "#0ac81e");
    }

    #[test]
    fn three_blocks_come_out_largest_first() {
        let mut image = RgbImage::new(10, 1);
        for x in 0..10 {
            let colour = match x {
                0..=4 => [255, 0, 0],
                5..=7 => [0, 0, 255],
                _ => [0, 255, 0],
            };
            image.put_pixel(x, 0, ImageRgb(colour));
        }
        let palette = extract_palette(&image);
        assert_eq!(
            palette,
            [
                Rgb::new(255, 0, 0),
                Rgb::new(0, 0, 255),
                Rgb::new(0, 255, 0)
            ]
        );
    }

    #[test]
    fn the_palette_is_deterministic() {
        let mut image = RgbImage::new(16, 16);
        for (x, y, pixel) in image.enumerate_pixels_mut() {
            // Bounded by the 16 px image, so the casts cannot truncate.
            #[allow(clippy::cast_possible_truncation)]
            let (x, y) = (x as u8, y as u8);
            *pixel = ImageRgb([x * 16, y * 16, 128]);
        }
        assert_eq!(extract_palette(&image), extract_palette(&image));
    }

    #[test]
    fn an_empty_image_is_black() {
        assert_eq!(extract_palette(&RgbImage::new(0, 0)), [Rgb::default(); 3]);
    }
}
