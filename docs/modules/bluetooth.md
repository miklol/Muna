# Bluetooth

**Tier P1 · Owner: `muna-shell-engineer` · Status: spec (strip source landed in M1-E2; panel,
connect/disconnect and classic battery follow in M3-E7)**

## Reference

`demo-08`. Device columns: name, `Disconnected` chip, device glyph (headphones/phone/mouse/
keyboard/controller), battery pill (green + %), ✕ disconnect. Strip: connect/disconnect notice
with battery.

## Platform

- Enumerate paired devices: two `DeviceInformation.CreateWatcher`s of kind `AssociationEndpoint`
  over `BluetoothDevice.GetDeviceSelectorFromPairingState(true)` (classic) and
  `BluetoothLEDevice.GetDeviceSelectorFromPairingState(true)` (LE), requesting
  `System.Devices.Aep.IsConnected`, `System.Devices.Aep.ContainerId` and
  `System.Devices.Aep.DeviceAddress`. The panel adds `System.Devices.Aep.Bluetooth.Le.IsConnectable`,
  `System.Devices.Aep.SignalStrength`, `System.Devices.Icon` and `System.Devices.Aep.Category`
  when it lands.
- Battery: LE GATT Battery Service `0x180F` (`BluetoothLEDevice.FromIdAsync` →
  `GetGattServicesForUuidAsync`, read `0x2A19`, subscribe to notifications); classic headsets via
  HFP indicators exposed as the `{104EA319-6EE2-4701-BD47-8DDBF425BBE5} 2` device property
  (Windows 10 1809+, undocumented — behind a feature flag); AirPods report via proprietary BLE
  adverts — parse `BluetoothLEAdvertisementWatcher` Apple manufacturer data (best effort, flagged).
- Connect/disconnect: no public API for classic; use `BluetoothSetServiceState` (bthprops.cpl)
  toggling A2DP/HFP service GUIDs — requires no admin; LE: dispose the `BluetoothLEDevice`.
- Radio toggle: `Windows.Devices.Radios.Radio` (`RequestAccessAsync`).
- Packaging: the MSIX manifest needs `<DeviceCapability Name="bluetooth" />` for GATT access;
  enumeration works without it and unpackaged builds need nothing.

### Implementation notes (M1-E2)

`muna-platform::windows::bluetooth` implements `Bluetooth::devices` and publishes
`PlatformEvent::BluetoothChanged`; `connect`/`disconnect` stay `Unsupported` until M3-E7.

- Windows reports a dual-mode device (most headsets) as two endpoints. They share a
  `System.Devices.Aep.ContainerId`, which becomes `BluetoothDevice.id` (falls back to the
  address, then the endpoint id); a device is connected while either transport is, the name is
  the first non-empty endpoint name (else the address) and the battery comes from the LE side.
- `Updated` fires for every property change; only changes to the merged device are published.
  Unpairing a connected device is published as a disconnect.
- Nothing is published until both watchers report `EnumerationCompleted`; `devices()` waits for
  that (bounded at 2 s, normally tens of milliseconds) so consumers seed from a complete snapshot.
- GATT work runs on one worker thread (`muna-platform-bluetooth`); watcher callbacks never
  block. The LE device, service and characteristic stay open while the endpoint is connected so
  Battery Level notifications keep flowing; the session is released on disconnect and the
  reading cleared. Devices without a Battery Service simply have `batteryPercent: null`.
- Device names are user content and are never logged; debug logs carry the container id only.

## Behaviour

Device cards sorted connected-first; low-battery notice at 20/10 %; per-device nickname/icon;
hide devices.

## Acceptance criteria

- Connect AirPods → strip notice with battery within 2 s; device card updates.
- Disconnect button works for A2DP headsets on Win11; graceful "Not supported" on failure.
