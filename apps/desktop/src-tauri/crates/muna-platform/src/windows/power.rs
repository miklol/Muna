//! `GetSystemPowerStatus` wrapper.

use windows::Win32::System::Power::{GetSystemPowerStatus, SYSTEM_POWER_STATUS};

use crate::error::{PlatformError, PlatformResult};
use crate::types::{BatteryState, PowerSource};

const AC_LINE_OFFLINE: u8 = 0;
const AC_LINE_ONLINE: u8 = 1;
const BATTERY_FLAG_CHARGING: u8 = 8;
const BATTERY_FLAG_NO_BATTERY: u8 = 128;
const BATTERY_PERCENT_UNKNOWN: u8 = 255;

pub(super) fn battery() -> PlatformResult<BatteryState> {
    let mut status = SYSTEM_POWER_STATUS::default();
    // SAFETY: `status` is a valid, writable `SYSTEM_POWER_STATUS` that outlives the call, which
    // is the only requirement of `GetSystemPowerStatus`. The result is checked below.
    #[allow(unsafe_code)]
    let result = unsafe { GetSystemPowerStatus(&raw mut status) };
    result.map_err(|error| PlatformError::Os {
        api: "GetSystemPowerStatus",
        code: error.code().0.cast_unsigned(),
    })?;
    Ok(interpret(&status))
}

fn interpret(status: &SYSTEM_POWER_STATUS) -> BatteryState {
    let no_battery = status.BatteryFlag & BATTERY_FLAG_NO_BATTERY != 0;
    let percent = if no_battery || status.BatteryLifePercent == BATTERY_PERCENT_UNKNOWN {
        None
    } else {
        Some(status.BatteryLifePercent.min(100))
    };
    let source = match status.ACLineStatus {
        AC_LINE_OFFLINE => PowerSource::Battery,
        AC_LINE_ONLINE => PowerSource::Ac,
        _ => PowerSource::Unknown,
    };
    BatteryState {
        percent,
        source,
        charging: status.BatteryFlag & BATTERY_FLAG_CHARGING != 0,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn status(ac: u8, flag: u8, percent: u8) -> SYSTEM_POWER_STATUS {
        SYSTEM_POWER_STATUS {
            ACLineStatus: ac,
            BatteryFlag: flag,
            BatteryLifePercent: percent,
            ..Default::default()
        }
    }

    #[test]
    fn desktop_without_battery() {
        let state = interpret(&status(AC_LINE_ONLINE, BATTERY_FLAG_NO_BATTERY, 255));
        assert_eq!(
            state,
            BatteryState {
                percent: None,
                source: PowerSource::Ac,
                charging: false
            }
        );
    }

    #[test]
    fn laptop_charging() {
        let state = interpret(&status(AC_LINE_ONLINE, BATTERY_FLAG_CHARGING, 63));
        assert_eq!(state.percent, Some(63));
        assert_eq!(state.source, PowerSource::Ac);
        assert!(state.charging);
    }

    #[test]
    fn unknown_ac_line_and_out_of_range_percent_are_normalised() {
        let state = interpret(&status(255, 0, 120));
        assert_eq!(state.percent, Some(100));
        assert_eq!(state.source, PowerSource::Unknown);
    }
}
