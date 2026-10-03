# Bluetooth

**Tier P1 · Owner: `muna-shell-engineer` · Status: implemented (strip source landed in M1-E2;
panel, connect/disconnect, device kinds, low-battery notices and the radio toggle in M3-E7;
classic HFP battery, AirPods adverts and nicknames deferred, see below)**

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
- Connect/disconnect: no public API for classic. Disconnect sends `IOCTL_BTH_DISCONNECT_DEVICE`
  to the radio (drops the baseband link; every profile follows, nothing is persisted, no admin).
  Connect is best effort: paging the device through `BluetoothDevice.FromIdAsync` +
  `GetRfcommServicesWithCacheModeAsync(Uncached)` (LE: `GetGattServicesWithCacheModeAsync`) and
  reading `ConnectionStatus` afterwards; a device that does not come up is reported as
  `Unsupported`. `BluetoothSetServiceState` (A2DP/HFP service toggling) is **not** used: the
  disabled state is persistent and journaling it across crashes is not worth the risk
  (docs/04-windows-platform-apis.md).
- Radio toggle: `Windows.Devices.Radios.Radio` (`RequestAccessAsync`, then `SetStateAsync`);
  `StateChanged` publishes `PlatformEvent::BluetoothRadioChanged`.
- Packaging: the MSIX manifest needs `<DeviceCapability Name="bluetooth" />` for GATT access
  and `<DeviceCapability Name="radios" />` for the radio toggle; enumeration works without
  either and unpackaged builds need nothing.

### Implementation notes (M1-E2)

`muna-platform::windows::bluetooth` implements `Bluetooth::devices` and publishes
`PlatformEvent::BluetoothChanged`; `connect`/`disconnect` and the radio landed in M3-E7 (below).

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

### Implementation notes (M3-E7)

The module is `src-tauri/src/modules/bluetooth` + `src/modules/bluetooth`; the connect and
disconnect notices stay with `live-activities` (one source of truth for those transitions).

- **Contract.** `get_bluetooth_snapshot` → `BluetoothSnapshot { radio, available, devices }`;
  `bluetooth_command(Connect { id } | Disconnect { id } | SetRadio { on })` returns the snapshot
  as it stands afterwards or an `IpcError` (`platform.unsupported`, `platform.notFound`,
  `platform.accessDenied`, `platform.os`); `BluetoothChanged { snapshot }` follows every
  platform report, command and settings change. Devices are sorted connected-first, then by
  name; hidden devices are included with `hidden: true` so the settings pane can show them
  again, and the panel leaves them out. `available: false` means the watchers never came up
  (the panel then says Bluetooth is not available instead of showing an empty list).
- **Kinds.** `BluetoothDeviceKind` comes from `System.Devices.Aep.Category`, matched by
  dotted-path segment (`Communication.Headset.Bluetooth` → headphones, `Input.Mouse` → mouse,
  `Audio.*` → speaker, and so on); a dual-mode device takes the first endpoint that names one,
  and an unclassified device is still judged by its name. The panel and the strip pick their
  glyph from it.
- **Commands are blocking.** Connect pages the device and can take seconds when it is out of
  range, so `bluetooth_command` is `async` and runs the platform call on a blocking thread; the
  UI marks the row pending meanwhile and the row says "Not supported for this device" (or the
  matching refusal) in place when Windows says no. On success the module updates the device at
  once; the platform's own report confirms it moments later.
- **Low battery.** A connected device with a reading earns `bluetooth:low:<id>` (priority
  `BLUETOOTH` 85, `StripMessage::DeviceBatteryLow`, the device glyph tinted orange at 20 % and
  red at 10 %, the level on the right). Each threshold is announced once per connection;
  climbing back above 20 % or a disconnect re-arms both, and nothing already true at start-up
  is announced. `settings.modules.bluetooth.lowBatteryNotices` turns them off.
- **Settings.** `settings.modules.bluetooth = { lowBatteryNotices: true, hiddenDevices: [] }`.
  Hiding is a plain setting written by the pane; Rust re-emits the snapshot with the flag.
- **Radio.** `RadioWatch` finds the Bluetooth radio lazily (and retries when none was found),
  publishes `StateChanged`, and `set_radio` asks for access first; `Disabled`/`Unknown` and a
  missing radio read as `unavailable`, which disables the switch and says why under it.
- **Deferred.** Classic HFP battery (undocumented DEVPKEY, flagged), AirPods advert parsing,
  per-device nicknames and icons, and opening Windows Settings from the empty state (needs an
  opener command). The `BluetoothSetServiceState` path stays documented as the alternative
  should the IOCTL disconnect prove unreliable on some stacks.

## Behaviour

Device rows sorted connected-first; low-battery notice at 20/10 %; hide devices. Per-device
nickname/icon deferred (see above).

## Acceptance criteria

- Connect AirPods → strip notice with battery within 2 s; device card updates.
- Disconnect button works for A2DP headsets on Win11; graceful "Not supported" on failure.
