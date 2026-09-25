//! Bluetooth connect and disconnect notices.
//!
//! Devices are keyed by id so a watcher that reports the same state twice (Windows does, on
//! every property change) produces one notice per transition. The name is user content and is
//! never logged; the battery level rides along when the device advertises one.

use std::collections::HashMap;

use muna_core::{Glyph, Leading, Notice, StripMessage, Trailing, activities::priority};
use muna_platform::{BluetoothDevice, BluetoothDeviceKind};

const MODULE: &str = "live-activities";

#[derive(Debug, Default)]
pub struct BluetoothSource {
    connected: HashMap<String, BluetoothDevice>,
}

impl BluetoothSource {
    /// Seeds the connected set so devices already paired at start-up do not announce
    /// themselves.
    #[must_use]
    pub fn new(devices: impl IntoIterator<Item = BluetoothDevice>) -> Self {
        Self {
            connected: devices
                .into_iter()
                .filter(|device| device.connected)
                .map(|device| (device.id.clone(), device))
                .collect(),
        }
    }

    /// Records a device report and returns a notice when its connection state changed.
    pub fn observe(&mut self, device: &BluetoothDevice) -> Option<Notice> {
        if device.connected {
            // A battery reading arriving after the connect notice refreshes it silently.
            let already = self
                .connected
                .insert(device.id.clone(), device.clone())
                .is_some();
            (!already).then(|| connected(device))
        } else {
            self.connected.remove(&device.id)?;
            Some(disconnected(device))
        }
    }
}

/// The strip has two Bluetooth glyphs: headphones for anything worn on the head, the Bluetooth
/// rune for the rest. The platform's kind decides; a device it could not classify is still
/// judged by its name.
fn glyph_for(device: &BluetoothDevice) -> Glyph {
    let kind = match device.kind {
        BluetoothDeviceKind::Other => BluetoothDeviceKind::from_name(&device.name),
        kind => kind,
    };
    if kind == BluetoothDeviceKind::Headphones {
        Glyph::Headphones
    } else {
        Glyph::Bluetooth
    }
}

fn connected(device: &BluetoothDevice) -> Notice {
    Notice {
        id: format!("bluetooth:{}", device.id),
        module: MODULE.into(),
        priority: priority::BLUETOOTH,
        leading: Some(Leading::Icon {
            glyph: glyph_for(device),
            tint: Some(muna_core::Tint::Blue),
        }),
        trailing: device.battery_percent.map(|percent| Trailing::Battery {
            percent,
            charging: false,
        }),
        wide: Some(StripMessage::BluetoothConnected {
            name: device.name.clone(),
            battery_percent: device.battery_percent,
        }),
        hold_ms: 0,
    }
}

fn disconnected(device: &BluetoothDevice) -> Notice {
    Notice {
        id: format!("bluetooth:{}", device.id),
        module: MODULE.into(),
        priority: priority::BLUETOOTH,
        leading: Some(Leading::Icon {
            glyph: glyph_for(device),
            tint: None,
        }),
        trailing: None,
        wide: Some(StripMessage::BluetoothDisconnected {
            name: device.name.clone(),
        }),
        hold_ms: 0,
    }
}
