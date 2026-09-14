# Bluetooth

**Tier P1 · Owner: `muna-shell-engineer` · Status: spec**

## Reference

`demo-08`. Device columns: name, `Disconnected` chip, device glyph (headphones/phone/mouse/
keyboard/controller), battery pill (green + %), ✕ disconnect. Strip: connect/disconnect notice
with battery.

## Platform

- Enumerate paired devices: `DeviceInformation.CreateWatcher` with AQS
  `System.Devices.Aep.ProtocolId:="{e0cbf06c-cd8b-4647-bb8a-263b43f0f974}"` (classic) and
  `{bb7bb05e-5972-42b5-94fc-76eaa7084d49}` (LE); request properties
  `System.Devices.Aep.IsConnected`, `System.Devices.Aep.Bluetooth.Le.IsConnectable`,
  `System.Devices.Aep.SignalStrength`, `System.Devices.Icon`, `System.Devices.Aep.Category`.
- Battery: LE GATT Battery Service `0x180F` (`BluetoothLEDevice.FromIdAsync` →
  `GetGattServicesForUuidAsync`); classic headsets via HFP indicators exposed as
  `{104EA319-6EE2-4701-BD47-8DDBF425BBE5} 2` device property (Windows 10 1809+); AirPods report
  via proprietary BLE adverts — parse `BluetoothLEAdvertisementWatcher` Apple manufacturer data
  (best effort, flagged).
- Connect/disconnect: no public API for classic; use `BluetoothSetServiceState` (bthprops.cpl)
  toggling A2DP/HFP service GUIDs — requires no admin; LE: dispose the `BluetoothLEDevice`.
- Radio toggle: `Windows.Devices.Radios.Radio` (`RequestAccessAsync`).

## Behaviour

Device cards sorted connected-first; low-battery notice at 20/10 %; per-device nickname/icon;
hide devices.

## Acceptance criteria

- Connect AirPods → strip notice with battery within 2 s; device card updates.
- Disconnect button works for A2DP headsets on Win11; graceful "Not supported" on failure.
