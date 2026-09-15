<#
.SYNOPSIS
  Display topology helpers for the W2/W9/W10 measurements (per-monitor scale, resolution).
.DESCRIPTION
  Dot-source after common.ps1. Scale changes use the same DisplayConfig device-info packets the
  Settings app uses (types -3 / -4, undocumented but stable since Windows 10 1703); resolution
  changes use ChangeDisplaySettingsExW with flags 0 (dynamic, not written to the registry).
  Every setter has a matching restore; callers wrap runs in try/finally.
#>
Set-StrictMode -Version Latest

Add-Type -Namespace MunaSpike -Name Display -MemberDefinition @'
[StructLayout(LayoutKind.Sequential)] public struct LUID { public uint LowPart; public int HighPart; }
[StructLayout(LayoutKind.Sequential)] public struct PATH_SOURCE_INFO { public LUID adapterId; public uint id; public uint modeInfoIdx; public uint statusFlags; }
[StructLayout(LayoutKind.Sequential)] public struct RATIONAL { public uint Numerator; public uint Denominator; }
[StructLayout(LayoutKind.Sequential)] public struct PATH_TARGET_INFO { public LUID adapterId; public uint id; public uint modeInfoIdx; public uint outputTechnology; public uint rotation; public uint scaling; public RATIONAL refreshRate; public uint scanLineOrdering; public int targetAvailable; public uint statusFlags; }
[StructLayout(LayoutKind.Sequential)] public struct PATH_INFO { public PATH_SOURCE_INFO sourceInfo; public PATH_TARGET_INFO targetInfo; public uint flags; }
[StructLayout(LayoutKind.Sequential, Size = 64)] public struct MODE_INFO { public uint infoType; public uint id; public LUID adapterId; }
[StructLayout(LayoutKind.Sequential)] public struct DEVICE_INFO_HEADER { public int type; public uint size; public LUID adapterId; public uint id; }
[StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)] public struct SOURCE_DEVICE_NAME { public DEVICE_INFO_HEADER header; [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)] public string viewGdiDeviceName; }
[StructLayout(LayoutKind.Sequential)] public struct GET_DPI { public DEVICE_INFO_HEADER header; public int minScaleRel; public int curScaleRel; public int maxScaleRel; }
[StructLayout(LayoutKind.Sequential)] public struct SET_DPI { public DEVICE_INFO_HEADER header; public int scaleRel; }
[StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
public struct DEVMODE {
  [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)] public string dmDeviceName;
  public ushort dmSpecVersion; public ushort dmDriverVersion; public ushort dmSize; public ushort dmDriverExtra; public uint dmFields;
  public int dmPositionX; public int dmPositionY; public uint dmDisplayOrientation; public uint dmDisplayFixedOutput;
  public short dmColor; public short dmDuplex; public short dmYResolution; public short dmTTOption; public short dmCollate;
  [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)] public string dmFormName;
  public ushort dmLogPixels; public uint dmBitsPerPel; public uint dmPelsWidth; public uint dmPelsHeight; public uint dmDisplayFlags; public uint dmDisplayFrequency;
  public uint dmICMMethod; public uint dmICMIntent; public uint dmMediaType; public uint dmDitherType; public uint dmReserved1; public uint dmReserved2; public uint dmPanningWidth; public uint dmPanningHeight;
}
[DllImport("user32.dll")] public static extern int GetDisplayConfigBufferSizes(uint flags, out uint numPaths, out uint numModes);
[DllImport("user32.dll")] public static extern int QueryDisplayConfig(uint flags, ref uint numPaths, [Out] PATH_INFO[] paths, ref uint numModes, [Out] MODE_INFO[] modes, IntPtr currentTopologyId);
[DllImport("user32.dll", EntryPoint = "DisplayConfigGetDeviceInfo")] public static extern int GetSourceName(ref SOURCE_DEVICE_NAME packet);
[DllImport("user32.dll", EntryPoint = "DisplayConfigGetDeviceInfo")] public static extern int GetDpi(ref GET_DPI packet);
[DllImport("user32.dll", EntryPoint = "DisplayConfigSetDeviceInfo")] public static extern int SetDpi(ref SET_DPI packet);
[DllImport("user32.dll")] public static extern int SetDisplayConfig(uint numPathArrayElements, IntPtr pathArray, uint numModeInfoArrayElements, IntPtr modeInfoArray, uint flags);
[DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern bool EnumDisplaySettingsW(string deviceName, int modeNum, ref DEVMODE devMode);
[DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int ChangeDisplaySettingsExW(string deviceName, ref DEVMODE devMode, IntPtr hwnd, uint flags, IntPtr lParam);
[DllImport("user32.dll", CharSet = CharSet.Unicode, EntryPoint = "ChangeDisplaySettingsExW")] public static extern int ResetDisplaySettingsExW(string deviceName, IntPtr devMode, IntPtr hwnd, uint flags, IntPtr lParam);
'@

# The scale steps Settings offers; DisplayConfig reports scale as an index relative to the recommended one.
$script:DpiSteps = @(100, 125, 150, 175, 200, 225, 250, 300, 350, 400, 450, 500)

<# PowerShell copies nested structs on property access, so headers are built whole and assigned once. #>
function New-DeviceInfoHeader([int]$Type, [type]$PacketType, $AdapterId, [uint32]$Id) {
  $header = New-Object MunaSpike.Display+DEVICE_INFO_HEADER
  $header.type = $Type
  $header.size = [System.Runtime.InteropServices.Marshal]::SizeOf([type]$PacketType)
  $header.adapterId = $AdapterId
  $header.id = $Id
  $header
}

<# Active display paths: GDI name (\\.\DISPLAY1) → source adapterId/id. #>
function Get-DisplayPaths {
  $numPaths = [uint32]0; $numModes = [uint32]0
  $rc = [MunaSpike.Display]::GetDisplayConfigBufferSizes(2, [ref]$numPaths, [ref]$numModes)
  if ($rc -ne 0) { throw "GetDisplayConfigBufferSizes failed ($rc)" }
  $paths = New-Object 'MunaSpike.Display+PATH_INFO[]' $numPaths
  $modes = New-Object 'MunaSpike.Display+MODE_INFO[]' $numModes
  $rc = [MunaSpike.Display]::QueryDisplayConfig(2, [ref]$numPaths, $paths, [ref]$numModes, $modes, [IntPtr]::Zero)
  if ($rc -ne 0) { throw "QueryDisplayConfig failed ($rc)" }
  for ($i = 0; $i -lt $numPaths; $i++) {
    $name = New-Object MunaSpike.Display+SOURCE_DEVICE_NAME
    $name.header = New-DeviceInfoHeader 1 ([type][MunaSpike.Display+SOURCE_DEVICE_NAME]) $paths[$i].sourceInfo.adapterId $paths[$i].sourceInfo.id
    $rc = [MunaSpike.Display]::GetSourceName([ref]$name)
    if ($rc -ne 0) { continue }
    [pscustomobject]@{ Name = $name.viewGdiDeviceName; AdapterId = $paths[$i].sourceInfo.adapterId; SourceId = $paths[$i].sourceInfo.id }
  }
}

<# Current, recommended and maximum scale (percent) of one display. #>
function Get-DisplayScale([string]$Name) {
  $path = Get-DisplayPaths | Where-Object { $_.Name -eq $Name } | Select-Object -First 1
  if ($null -eq $path) { throw "display $Name not found" }
  $packet = New-Object MunaSpike.Display+GET_DPI
  $packet.header = New-DeviceInfoHeader -3 ([type][MunaSpike.Display+GET_DPI]) $path.AdapterId $path.SourceId
  $rc = [MunaSpike.Display]::GetDpi([ref]$packet)
  if ($rc -ne 0) { throw "DisplayConfigGetDeviceInfo(GET_DPI) failed ($rc)" }
  $recommendedIndex = [math]::Abs($packet.minScaleRel)
  [pscustomobject]@{
    Name = $Name
    Current = $script:DpiSteps[$recommendedIndex + $packet.curScaleRel]
    Recommended = $script:DpiSteps[$recommendedIndex]
    Maximum = $script:DpiSteps[[math]::Min($script:DpiSteps.Count - 1, $recommendedIndex + $packet.maxScaleRel)]
    MinScaleRel = $packet.minScaleRel; CurScaleRel = $packet.curScaleRel; MaxScaleRel = $packet.maxScaleRel
  }
}

<# Sets one display's scale (percent, one of the Settings steps). Applies live, no sign-out. #>
function Set-DisplayScale([string]$Name, [int]$Percent) {
  $info = Get-DisplayScale $Name
  $index = [array]::IndexOf($script:DpiSteps, $Percent)
  if ($index -lt 0) { throw "$Percent % is not a scale step" }
  $rel = $index - [math]::Abs($info.MinScaleRel)
  if ($rel -lt $info.MinScaleRel -or $rel -gt $info.MaxScaleRel) { throw "$Percent % is outside the range for $Name" }
  $path = Get-DisplayPaths | Where-Object { $_.Name -eq $Name } | Select-Object -First 1
  $packet = New-Object MunaSpike.Display+SET_DPI
  $packet.header = New-DeviceInfoHeader -4 ([type][MunaSpike.Display+SET_DPI]) $path.AdapterId $path.SourceId
  $packet.scaleRel = $rel
  $rc = [MunaSpike.Display]::SetDpi([ref]$packet)
  if ($rc -ne 0) { throw "DisplayConfigSetDeviceInfo(SET_DPI) failed ($rc)" }
}

function Get-DisplayMode([string]$Name) {
  $mode = New-Object MunaSpike.Display+DEVMODE
  $mode.dmSize = [uint16][System.Runtime.InteropServices.Marshal]::SizeOf([type][MunaSpike.Display+DEVMODE])
  if (-not [MunaSpike.Display]::EnumDisplaySettingsW($Name, -1, [ref]$mode)) { throw "EnumDisplaySettings($Name) failed" }
  $mode
}

<# All modes the display supports, as width/height/frequency triples. #>
function Get-DisplayModes([string]$Name) {
  $i = 0
  while ($true) {
    $mode = New-Object MunaSpike.Display+DEVMODE
    $mode.dmSize = [uint16][System.Runtime.InteropServices.Marshal]::SizeOf([type][MunaSpike.Display+DEVMODE])
    if (-not [MunaSpike.Display]::EnumDisplaySettingsW($Name, $i, [ref]$mode)) { break }
    [pscustomobject]@{ Width = $mode.dmPelsWidth; Height = $mode.dmPelsHeight; Frequency = $mode.dmDisplayFrequency; Bpp = $mode.dmBitsPerPel }
    $i++
  }
}

<# Switches resolution dynamically (flags 0: not saved). Position and frequency are kept. #>
function Set-DisplayResolution([string]$Name, [int]$Width, [int]$Height) {
  $mode = Get-DisplayMode $Name
  $mode.dmPelsWidth = $Width
  $mode.dmPelsHeight = $Height
  $mode.dmFields = 0x80000 -bor 0x100000
  $rc = [MunaSpike.Display]::ChangeDisplaySettingsExW($Name, [ref]$mode, [IntPtr]::Zero, 0, [IntPtr]::Zero)
  if ($rc -ne 0) { throw "ChangeDisplaySettingsEx($Name, ${Width}x${Height}) returned $rc" }
}

<# Back to the registry (saved) mode. #>
function Restore-DisplayResolution([string]$Name) {
  $rc = [MunaSpike.Display]::ResetDisplaySettingsExW($Name, [IntPtr]::Zero, [IntPtr]::Zero, 0, [IntPtr]::Zero)
  if ($rc -ne 0) { throw "ChangeDisplaySettingsEx($Name, restore) returned $rc" }
}

<# Presentation topology (what Win+P / DisplaySwitch.exe set): internal = PC screen only, extend. #>
function Set-DisplayTopology([ValidateSet('internal', 'extend', 'clone', 'external')][string]$Mode) {
  $topology = @{ internal = 0x1; clone = 0x2; extend = 0x4; external = 0x8 }[$Mode]
  $SDC_APPLY = 0x80
  $rc = [MunaSpike.Display]::SetDisplayConfig(0, [IntPtr]::Zero, 0, [IntPtr]::Zero, $SDC_APPLY -bor $topology)
  if ($rc -ne 0) { throw "SetDisplayConfig(topology $Mode) returned $rc" }
}
