//! The module's settings namespace, `settings.modules.drop-actions` (docs/modules/
//! drop-actions.md "Behaviour": order, folders, dividers and width live in Settings). A missing
//! or malformed entry yields the defaults instead of failing the whole document, and unknown
//! keys are ignored so an older build can read a newer file (docs/03-architecture.md).
//!
//! Folder paths are personal data: they are content, never logged.

use muna_core::Settings;
use muna_platform::TransferMode;
use serde::{Deserialize, Serialize};
use specta::Type;

/// Most configured folders; the tile row has to stay readable.
pub const MAX_FOLDERS: usize = 8;
/// Tiles per row with *Expand notch* off / on (docs/modules/drop-actions.md "Behaviour").
pub const TILES_PER_ROW: u8 = 4;
pub const TILES_PER_ROW_EXPANDED: u8 = 8;

/// A folder tile: copy or move the dropped items into `path` (a cloud folder, a project…).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct DropFolder {
    /// Stable id the tile order refers to.
    pub id: String,
    /// The tile's title; defaults to the folder's name when empty.
    pub name: String,
    pub path: String,
    pub mode: TransferMode,
}

/// One tile in the row, in display order (docs/modules/drop-actions.md "Tiles"). *Convert*
/// and *Music* arrive with their modules.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum DropTile {
    NearbyShare,
    /// Park the items on the Shelf (docs/modules/shelf.md).
    Shelf,
    Folder {
        id: String,
    },
    CopyTo,
    MoveTo,
    OpenWith,
    Zip,
    Unzip,
    Reveal,
    Trash,
    Eject,
    /// A layout helper: a hairline gap between two groups of tiles.
    Divider,
}

impl DropTile {
    /// Whether two tiles are the same tile (dividers are never duplicates).
    fn same_as(&self, other: &Self) -> bool {
        !matches!(self, Self::Divider) && self == other
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase", default)]
pub struct DropActionsSettings {
    /// The row, in order. A folder tile refers to an entry in `folders`.
    pub tiles: Vec<DropTile>,
    pub folders: Vec<DropFolder>,
    /// Lets a row hold [`TILES_PER_ROW_EXPANDED`] tiles instead of [`TILES_PER_ROW`].
    pub expand_notch: bool,
}

impl Default for DropActionsSettings {
    /// Every built-in tile: share first, the Shelf beside it, the two destructive ones last.
    fn default() -> Self {
        Self {
            tiles: vec![
                DropTile::NearbyShare,
                DropTile::Shelf,
                DropTile::CopyTo,
                DropTile::MoveTo,
                DropTile::OpenWith,
                DropTile::Zip,
                DropTile::Unzip,
                DropTile::Reveal,
                DropTile::Trash,
                DropTile::Eject,
            ],
            folders: Vec::new(),
            expand_notch: false,
        }
    }
}

impl DropActionsSettings {
    /// The key under `settings.modules`; also the module id.
    pub const KEY: &'static str = super::ID;

    /// Reads the namespace from a settings document, repaired to a valid row.
    #[must_use]
    pub fn from_document(settings: &Settings) -> Self {
        let Some(value) = settings.modules.get(Self::KEY) else {
            return Self::default();
        };
        serde_json::from_value::<Self>(value.clone())
            .unwrap_or_else(|error| {
                tracing::warn!(%error, "drop-actions settings malformed; using defaults");
                Self::default()
            })
            .normalised()
    }

    /// Writes the namespace back into a settings document.
    pub fn write(&self, settings: &mut Settings) -> Result<(), serde_json::Error> {
        settings
            .modules
            .insert(Self::KEY.to_owned(), serde_json::to_value(self)?);
        Ok(())
    }

    /// Drops folders without a path or with a repeated id (first wins), caps them at
    /// [`MAX_FOLDERS`], names unnamed ones after their last path segment, removes duplicate
    /// tiles and folder tiles that point nowhere, and appends a tile for every folder that has
    /// none so a configured folder is always reachable.
    #[must_use]
    pub fn normalised(self) -> Self {
        let mut folders: Vec<DropFolder> = Vec::new();
        for folder in self.folders {
            let id = folder.id.trim();
            let path = folder.path.trim();
            if id.is_empty() || path.is_empty() || folders.iter().any(|f| f.id == id) {
                continue;
            }
            if folders.len() == MAX_FOLDERS {
                break;
            }
            let name = match folder.name.trim() {
                "" => folder_name(path),
                name => name.to_owned(),
            };
            folders.push(DropFolder {
                id: id.to_owned(),
                name,
                path: path.to_owned(),
                mode: folder.mode,
            });
        }
        let mut tiles: Vec<DropTile> = Vec::new();
        for tile in self.tiles {
            if let DropTile::Folder { id } = &tile
                && !folders.iter().any(|f| &f.id == id)
            {
                continue;
            }
            if tiles.iter().any(|t| t.same_as(&tile)) {
                continue;
            }
            tiles.push(tile);
        }
        for folder in &folders {
            let tile = DropTile::Folder {
                id: folder.id.clone(),
            };
            if !tiles.contains(&tile) {
                tiles.push(tile);
            }
        }
        Self {
            tiles,
            folders,
            expand_notch: self.expand_notch,
        }
    }

    /// The folder behind a tile id.
    #[must_use]
    pub fn folder(&self, id: &str) -> Option<&DropFolder> {
        self.folders.iter().find(|folder| folder.id == id)
    }

    /// How many tiles fit in one row.
    #[must_use]
    pub const fn tiles_per_row(&self) -> u8 {
        if self.expand_notch {
            TILES_PER_ROW_EXPANDED
        } else {
            TILES_PER_ROW
        }
    }
}

/// The last segment of a path as a display name (`C:\Users\me\OneDrive` → `OneDrive`).
fn folder_name(path: &str) -> String {
    path.trim_end_matches(['\\', '/'])
        .rsplit(['\\', '/'])
        .next()
        .filter(|segment| !segment.is_empty())
        .unwrap_or(path)
        .to_owned()
}
