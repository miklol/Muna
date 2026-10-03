//! Files & sharing (docs/04-windows-platform-apis.md, docs/modules/drop-actions.md): the
//! shell's own operations behind the Drop actions tiles.
//!
//! Copy, move, recycle, open, reveal and eject each run on a short-lived STA thread of their
//! own: `IFileOperation` is apartment-threaded, its conflict and progress dialogs block for as
//! long as the user takes, and two drops must never queue behind each other. The share sheet
//! and the folder picker are modal to the window they belong to, so they run on the caller's
//! thread — the trait says which (the module hops to the main thread first).
//!
//! Paths are content: they travel in arguments and never reach a log line.

use std::ffi::c_void;
use std::path::{Path, PathBuf};

use parking_lot::Mutex;
use tracing::{debug, warn};
use windows::ApplicationModel::DataTransfer::{DataRequestedEventArgs, DataTransferManager};
use windows::Foundation::TypedEventHandler;
use windows::Storage::{IStorageItem, StorageFile, StorageFolder};
use windows::Win32::Devices::DeviceAndDriverInstallation::{
    CM_Get_Parent, CM_Request_Device_EjectW, CR_SUCCESS, DIGCF_DEVICEINTERFACE, DIGCF_PRESENT,
    HDEVINFO, SP_DEVICE_INTERFACE_DATA, SP_DEVICE_INTERFACE_DETAIL_DATA_W, SP_DEVINFO_DATA,
    SetupDiDestroyDeviceInfoList, SetupDiEnumDeviceInterfaces, SetupDiGetClassDevsW,
    SetupDiGetDeviceInterfaceDetailW,
};
use windows::Win32::Foundation::{CloseHandle, ERROR_CANCELLED, HANDLE, HWND, RPC_E_CHANGED_MODE};
use windows::Win32::Storage::FileSystem::{
    CreateFileW, FILE_ATTRIBUTE_NORMAL, FILE_SHARE_READ, FILE_SHARE_WRITE, GetDriveTypeW,
    GetVolumePathNameW, OPEN_EXISTING,
};
use windows::Win32::System::Com::{
    CLSCTX_INPROC_SERVER, COINIT_APARTMENTTHREADED, COINIT_DISABLE_OLE1DDE, CoCreateInstance,
    CoInitializeEx, CoTaskMemFree, CoUninitialize,
};
use windows::Win32::System::IO::DeviceIoControl;
use windows::Win32::System::Ioctl::{
    GUID_DEVINTERFACE_DISK, IOCTL_STORAGE_GET_DEVICE_NUMBER, STORAGE_DEVICE_NUMBER,
};
use windows::Win32::UI::Shell::Common::ITEMIDLIST;
use windows::Win32::UI::Shell::{
    FOF_ALLOWUNDO, FOF_NOCONFIRMMKDIR, FOFX_RECYCLEONDELETE, FOS_FORCEFILESYSTEM, FOS_PICKFOLDERS,
    FileOpenDialog, FileOperation, IDataTransferManagerInterop, IFileOpenDialog, IFileOperation,
    ILFindLastID, ILFree, IShellItem, SEE_MASK_INVOKEIDLIST, SEE_MASK_NOASYNC,
    SHCreateItemFromParsingName, SHELLEXECUTEINFOW, SHOpenFolderAndSelectItems, SHParseDisplayName,
    SIGDN_FILESYSPATH, ShellExecuteExW,
};
use windows::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL;
use windows::core::{AgileReference, HSTRING, Interface, PCWSTR, Ref};
use windows_collections::IIterable;

use super::os_error;
use crate::error::{PlatformError, PlatformResult};
use crate::types::{TransferMode, WindowHandle};

/// `GetDriveTypeW` for a removable drive (`winbase.h`); the constant sits behind a feature the
/// crate does not otherwise need.
const DRIVE_REMOVABLE: u32 = 2;
/// `HRESULT_FROM_WIN32(ERROR_CANCELLED)`: the user closed a shell dialog without choosing.
const CANCELLED: windows::core::HRESULT = windows::core::HRESULT::from_win32(ERROR_CANCELLED.0);
/// `COPYENGINE_E_USER_CANCELLED`: the user cancelled a copy engine operation.
const COPY_CANCELLED: windows::core::HRESULT =
    windows::core::HRESULT(0x8027_0000_u32.cast_signed());
/// Longest device path `SetupAPI` hands back, in UTF-16 units.
const DEVICE_PATH_CAPACITY: usize = 1024;

/// The share sheet's `DataTransferManager` and our handler on it. Kept until the next share
/// so the sheet can still ask for the items after `ShowShareUIForWindow` returned. Agile so
/// the platform struct stays `Send + Sync`; it is only ever resolved on the window's thread.
struct ShareSession {
    manager: AgileReference<DataTransferManager>,
    token: i64,
}

impl Drop for ShareSession {
    fn drop(&mut self) {
        if let Err(error) = self
            .manager
            .resolve()
            .and_then(|manager| manager.RemoveDataRequested(self.token))
        {
            debug!(%error, "DataTransferManager.RemoveDataRequested failed");
        }
    }
}

/// The share sheet: the one operation with state, because the sheet keeps asking for its
/// items after the call that showed it has returned.
#[derive(Default)]
pub(super) struct ShareSheet {
    session: Mutex<Option<ShareSession>>,
}

impl std::fmt::Debug for ShareSheet {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("ShareSheet")
            .field("showing", &self.session.lock().is_some())
            .finish()
    }
}

pub(super) fn transfer(
    items: &[PathBuf],
    destination: &Path,
    mode: TransferMode,
) -> PlatformResult<()> {
    let items = items.to_vec();
    let destination = destination.to_path_buf();
    on_sta_thread("muna-platform-transfer", move || {
        let operation = file_operation()?;
        // SAFETY: the interface is alive and the flags are the documented set.
        #[allow(unsafe_code)]
        unsafe { operation.SetOperationFlags(FOF_ALLOWUNDO | FOF_NOCONFIRMMKDIR) }
            .map_err(|e| os_error("IFileOperation::SetOperationFlags", &e))?;
        let folder = shell_item(&destination)?;
        for item in &items {
            let item = shell_item(item)?;
            // SAFETY: both items are alive; a null name keeps the source name and no progress
            // sink is registered.
            #[allow(unsafe_code)]
            let queued = unsafe {
                match mode {
                    TransferMode::Copy => operation.CopyItem(&item, &folder, None, None),
                    TransferMode::Move => operation.MoveItem(&item, &folder, None, None),
                }
            };
            queued.map_err(|e| os_error("IFileOperation::CopyItem", &e))?;
        }
        perform(&operation)
    })
}

pub(super) fn recycle(items: &[PathBuf]) -> PlatformResult<()> {
    let items = items.to_vec();
    on_sta_thread("muna-platform-recycle", move || {
        let operation = file_operation()?;
        // SAFETY: the interface is alive. `FOFX_RECYCLEONDELETE` with `FOF_ALLOWUNDO` sends to
        // the Recycle Bin and never deletes permanently, even for items too large for it (the
        // shell asks first).
        #[allow(unsafe_code)]
        unsafe { operation.SetOperationFlags(FOF_ALLOWUNDO | FOFX_RECYCLEONDELETE) }
            .map_err(|e| os_error("IFileOperation::SetOperationFlags", &e))?;
        for item in &items {
            let item = shell_item(item)?;
            // SAFETY: the item is alive and no progress sink is registered.
            #[allow(unsafe_code)]
            unsafe { operation.DeleteItem(&item, None) }
                .map_err(|e| os_error("IFileOperation::DeleteItem", &e))?;
        }
        perform(&operation)
    })
}

pub(super) fn open(item: &Path) -> PlatformResult<()> {
    let item = item.to_path_buf();
    on_sta_thread("muna-platform-open", move || shell_execute(&item, None))
}

pub(super) fn open_with(item: &Path) -> PlatformResult<()> {
    let item = item.to_path_buf();
    on_sta_thread("muna-platform-open-with", move || {
        shell_execute(&item, Some(&HSTRING::from("openas")))
    })
}

pub(super) fn reveal(items: &[PathBuf]) -> PlatformResult<()> {
    let Some(first) = items.first() else {
        return Ok(());
    };
    let Some(folder) = first
        .parent()
        .filter(|parent| !parent.as_os_str().is_empty())
    else {
        return Err(PlatformError::NotFound("parent folder".into()));
    };
    let folder = folder.to_path_buf();
    let items: Vec<PathBuf> = items
        .iter()
        .filter(|item| item.parent() == Some(folder.as_path()))
        .cloned()
        .collect();
    on_sta_thread("muna-platform-reveal", move || {
        let folder_id = ItemId::parse(&folder)?;
        let item_ids = items
            .iter()
            .map(|item| ItemId::parse(item))
            .collect::<PlatformResult<Vec<_>>>()?;
        let children: Vec<*const ITEMIDLIST> = item_ids
            .iter()
            .map(|id| {
                // SAFETY: `id` holds a valid absolute id list; the child pointer it returns
                // points into that allocation and lives as long as `item_ids`.
                #[allow(unsafe_code)]
                unsafe {
                    ILFindLastID(id.0).cast_const()
                }
            })
            .collect();
        // SAFETY: the folder id and every child pointer are valid for the call.
        #[allow(unsafe_code)]
        unsafe { SHOpenFolderAndSelectItems(folder_id.0, Some(&children), 0) }
            .map_err(|e| os_error("SHOpenFolderAndSelectItems", &e))
    })
}

pub(super) fn eject(item: &Path) -> PlatformResult<()> {
    let item = item.to_path_buf();
    on_sta_thread("muna-platform-eject", move || eject_volume_of(&item))
}

/// The picker runs its modal loop on its own STA thread; `window` (`0` for none) only owns
/// the dialog, so the caller's thread — the main thread included — is never blocked by it.
pub(super) fn pick_folder(window: WindowHandle, title: &str) -> PlatformResult<Option<PathBuf>> {
    let title = HSTRING::from(title);
    on_sta_thread("muna-platform-pick-folder", move || {
        // SAFETY: plain COM activation with a documented CLSID.
        #[allow(unsafe_code)]
        let dialog: IFileOpenDialog =
            unsafe { CoCreateInstance(&FileOpenDialog, None, CLSCTX_INPROC_SERVER) }
                .map_err(|e| os_error("CoCreateInstance(FileOpenDialog)", &e))?;
        let owner = (window != 0).then(|| hwnd(window));
        // SAFETY: the dialog is alive; `title` outlives the call; `Show` blocks in its own
        // modal loop on this thread with `owner` disabled meanwhile.
        #[allow(unsafe_code)]
        let shown = unsafe {
            dialog
                .SetOptions(FOS_PICKFOLDERS | FOS_FORCEFILESYSTEM)
                .map_err(|e| os_error("IFileDialog::SetOptions", &e))?;
            dialog
                .SetTitle(PCWSTR(title.as_ptr()))
                .map_err(|e| os_error("IFileDialog::SetTitle", &e))?;
            dialog.Show(owner)
        };
        match shown {
            Ok(()) => {}
            Err(error) if error.code() == CANCELLED => return Ok(None),
            Err(error) => return Err(os_error("IFileDialog::Show", &error)),
        }
        // SAFETY: `Show` succeeded, so a result exists.
        #[allow(unsafe_code)]
        let picked =
            unsafe { dialog.GetResult() }.map_err(|e| os_error("IFileDialog::GetResult", &e))?;
        file_system_path(&picked).map(Some)
    })
}

impl ShareSheet {
    /// Runs on the caller's thread, which must own `window` (the share UI is bound to its
    /// message loop).
    pub(super) fn show(&self, window: WindowHandle, items: &[PathBuf]) -> PlatformResult<()> {
        let Some(first) = items.first() else {
            return Ok(());
        };
        let storage_items = items
            .iter()
            .map(|item| storage_item(item))
            .collect::<PlatformResult<Vec<_>>>()?;
        let title = share_title(first, items.len());

        let interop = windows::core::factory::<DataTransferManager, IDataTransferManagerInterop>()
            .map_err(|e| os_error("IDataTransferManagerInterop", &e))?;
        // SAFETY: `window` is a live top-level window owned by this thread.
        #[allow(unsafe_code)]
        let manager: DataTransferManager = unsafe { interop.GetForWindow(hwnd(window)) }
            .map_err(|e| os_error("IDataTransferManagerInterop::GetForWindow", &e))?;

        // One handler per window: drop the previous share's before adding ours.
        self.session.lock().take();
        let handler = TypedEventHandler::<DataTransferManager, DataRequestedEventArgs>::new(
            move |_, args: Ref<DataRequestedEventArgs>| {
                let request = args.ok()?.Request()?;
                let data = request.Data()?;
                data.Properties()?.SetTitle(&title)?;
                let items = storage_items
                    .iter()
                    .map(|item| item.resolve().map(Some))
                    .collect::<windows::core::Result<Vec<_>>>()?;
                data.SetStorageItemsReadOnly(&IIterable::<IStorageItem>::from(items))?;
                Ok(())
            },
        );
        let token = manager
            .DataRequested(&handler)
            .map_err(|e| os_error("DataTransferManager.DataRequested", &e))?;
        *self.session.lock() = Some(ShareSession {
            manager: AgileReference::new(&manager)
                .map_err(|e| os_error("AgileReference(DataTransferManager)", &e))?,
            token,
        });
        // SAFETY: same window as above.
        #[allow(unsafe_code)]
        unsafe { interop.ShowShareUIForWindow(hwnd(window)) }
            .map_err(|e| os_error("IDataTransferManagerInterop::ShowShareUIForWindow", &e))
    }
}

// --- helpers -----------------------------------------------------------------------------

fn hwnd(window: WindowHandle) -> HWND {
    HWND(window as *mut c_void)
}

/// Runs `job` to completion on a fresh apartment-threaded COM thread and returns its result.
fn on_sta_thread<T: Send + 'static>(
    name: &'static str,
    job: impl FnOnce() -> PlatformResult<T> + Send + 'static,
) -> PlatformResult<T> {
    let thread = std::thread::Builder::new()
        .name(name.into())
        .spawn(move || {
            // SAFETY: initialising COM has no preconditions; a successful call is balanced by
            // `CoUninitialize` below on the same thread. A fresh thread never reports
            // `RPC_E_CHANGED_MODE`, but tolerating it costs nothing.
            #[allow(unsafe_code)]
            let initialised =
                unsafe { CoInitializeEx(None, COINIT_APARTMENTTHREADED | COINIT_DISABLE_OLE1DDE) };
            if initialised.is_err() && initialised != RPC_E_CHANGED_MODE {
                return Err(PlatformError::Os {
                    api: "CoInitializeEx",
                    code: initialised.0.cast_unsigned(),
                });
            }
            let result = job();
            if initialised.is_ok() {
                // SAFETY: balances the successful `CoInitializeEx` above on the same thread.
                #[allow(unsafe_code)]
                unsafe {
                    CoUninitialize();
                }
            }
            result
        })
        .map_err(|_| PlatformError::Unsupported("file operation thread"))?;
    thread
        .join()
        .map_err(|_| PlatformError::Unsupported("file operation thread"))?
}

fn file_operation() -> PlatformResult<IFileOperation> {
    // SAFETY: plain COM activation with a documented CLSID.
    #[allow(unsafe_code)]
    unsafe { CoCreateInstance(&FileOperation, None, CLSCTX_INPROC_SERVER) }
        .map_err(|e| os_error("CoCreateInstance(FileOperation)", &e))
}

fn shell_item(path: &Path) -> PlatformResult<IShellItem> {
    let wide = HSTRING::from(path.as_os_str());
    // SAFETY: `wide` is a NUL-terminated string that outlives the call; no bind context.
    #[allow(unsafe_code)]
    unsafe { SHCreateItemFromParsingName(PCWSTR(wide.as_ptr()), None) }.map_err(|error| {
        if error.code().0.cast_unsigned() == 0x8007_0002
            || error.code().0.cast_unsigned() == 0x8007_0003
        {
            PlatformError::NotFound("dropped item".into())
        } else {
            os_error("SHCreateItemFromParsingName", &error)
        }
    })
}

/// Runs the queued operations; a cancel in the shell's dialogs is [`PlatformError::Cancelled`].
fn perform(operation: &IFileOperation) -> PlatformResult<()> {
    // SAFETY: the interface is alive; the call blocks until the shell is done.
    #[allow(unsafe_code)]
    let performed = unsafe { operation.PerformOperations() };
    match performed {
        Ok(()) => {}
        Err(error) if error.code() == COPY_CANCELLED || error.code() == CANCELLED => {
            return Err(PlatformError::Cancelled("file operation"));
        }
        Err(error) => return Err(os_error("IFileOperation::PerformOperations", &error)),
    }
    // SAFETY: as above.
    #[allow(unsafe_code)]
    let aborted = unsafe { operation.GetAnyOperationsAborted() }
        .map_err(|e| os_error("IFileOperation::GetAnyOperationsAborted", &e))?;
    if aborted.as_bool() {
        return Err(PlatformError::Cancelled("file operation"));
    }
    Ok(())
}

/// `ShellExecuteExW` on `item` with `verb` (`None` is the default action).
fn shell_execute(item: &Path, verb: Option<&HSTRING>) -> PlatformResult<()> {
    let file = HSTRING::from(item.as_os_str());
    let mut info = SHELLEXECUTEINFOW {
        cbSize: u32::try_from(std::mem::size_of::<SHELLEXECUTEINFOW>()).unwrap_or(u32::MAX),
        fMask: SEE_MASK_NOASYNC
            | if verb.is_some() {
                SEE_MASK_INVOKEIDLIST
            } else {
                0
            },
        lpVerb: verb.map_or(PCWSTR::null(), |verb| PCWSTR(verb.as_ptr())),
        lpFile: PCWSTR(file.as_ptr()),
        nShow: SW_SHOWNORMAL.0,
        ..Default::default()
    };
    // SAFETY: `info` is fully initialised and every string it points at outlives the call;
    // `SEE_MASK_NOASYNC` makes the shell finish before returning, so this short-lived thread
    // can end.
    #[allow(unsafe_code)]
    unsafe { ShellExecuteExW(&raw mut info) }.map_err(|error| {
        if error.code() == CANCELLED {
            PlatformError::Cancelled("open with")
        } else {
            os_error("ShellExecuteExW", &error)
        }
    })
}

/// An absolute shell item id list, freed on drop.
struct ItemId(*mut ITEMIDLIST);

impl ItemId {
    fn parse(path: &Path) -> PlatformResult<Self> {
        let wide = HSTRING::from(path.as_os_str());
        let mut id = std::ptr::null_mut();
        // SAFETY: `wide` outlives the call and `id` receives an allocation we free in `Drop`.
        #[allow(unsafe_code)]
        unsafe { SHParseDisplayName(PCWSTR(wide.as_ptr()), None, &raw mut id, 0, None) }
            .map_err(|e| os_error("SHParseDisplayName", &e))?;
        if id.is_null() {
            return Err(PlatformError::NotFound("dropped item".into()));
        }
        Ok(Self(id))
    }
}

impl Drop for ItemId {
    fn drop(&mut self) {
        // SAFETY: `SHParseDisplayName` allocated the list with the shell allocator.
        #[allow(unsafe_code)]
        unsafe {
            ILFree(Some(self.0.cast_const()));
        }
    }
}

fn storage_item(path: &Path) -> PlatformResult<AgileReference<IStorageItem>> {
    let wide = HSTRING::from(path.as_os_str());
    let item: IStorageItem = if path.is_dir() {
        StorageFolder::GetFolderFromPathAsync(&wide)
            .and_then(|pending| pending.join())
            .and_then(|folder| folder.cast())
            .map_err(|e| os_error("StorageFolder.GetFolderFromPathAsync", &e))?
    } else {
        StorageFile::GetFileFromPathAsync(&wide)
            .and_then(|pending| pending.join())
            .and_then(|file| file.cast())
            .map_err(|e| os_error("StorageFile.GetFileFromPathAsync", &e))?
    };
    AgileReference::new(&item).map_err(|e| os_error("AgileReference(IStorageItem)", &e))
}

/// The share sheet needs a title; the first item's name, with a count for the rest, needs no
/// translation.
fn share_title(first: &Path, count: usize) -> HSTRING {
    let name = first
        .file_name()
        .map_or_else(|| first.as_os_str().to_owned(), ToOwned::to_owned);
    let mut title = name;
    if count > 1 {
        title.push(format!(" +{}", count - 1));
    }
    HSTRING::from(title.as_os_str())
}

fn file_system_path(item: &IShellItem) -> PlatformResult<PathBuf> {
    // SAFETY: the item is alive; the returned string is ours to free with `CoTaskMemFree`.
    #[allow(unsafe_code)]
    unsafe {
        let name = item
            .GetDisplayName(SIGDN_FILESYSPATH)
            .map_err(|e| os_error("IShellItem::GetDisplayName", &e))?;
        let path = PathBuf::from(name.to_hstring().to_os_string());
        CoTaskMemFree(Some(name.0.cast_const().cast()));
        Ok(path)
    }
}

// --- eject -------------------------------------------------------------------------------

/// A raw handle closed on drop.
struct OwnedHandle(HANDLE);

impl Drop for OwnedHandle {
    fn drop(&mut self) {
        // SAFETY: the handle came from a successful `CreateFileW` and is closed once.
        #[allow(unsafe_code)]
        let closed = unsafe { CloseHandle(self.0) };
        if let Err(error) = closed {
            debug!(%error, "CloseHandle failed");
        }
    }
}

/// A `SetupAPI` device information set, destroyed on drop.
struct DeviceInfoSet(HDEVINFO);

impl Drop for DeviceInfoSet {
    fn drop(&mut self) {
        // SAFETY: the set came from a successful `SetupDiGetClassDevsW`.
        #[allow(unsafe_code)]
        let destroyed = unsafe { SetupDiDestroyDeviceInfoList(self.0) };
        if let Err(error) = destroyed {
            debug!(%error, "SetupDiDestroyDeviceInfoList failed");
        }
    }
}

/// Safely removes the removable drive that holds `item`: volume → disk device number → the
/// matching disk interface's device instance → its parent (the USB mass-storage device) →
/// `CM_Request_Device_EjectW`, which is what Explorer's *Eject* does.
fn eject_volume_of(item: &Path) -> PlatformResult<()> {
    let wide = HSTRING::from(item.as_os_str());
    let mut volume = [0u16; 261];
    // SAFETY: `wide` outlives the call and the buffer length is passed with it.
    #[allow(unsafe_code)]
    unsafe { GetVolumePathNameW(PCWSTR(wide.as_ptr()), &mut volume) }
        .map_err(|e| os_error("GetVolumePathNameW", &e))?;
    let volume_root = HSTRING::from_wide(nul_terminated(&volume));
    // SAFETY: a NUL-terminated root path that outlives the call.
    #[allow(unsafe_code)]
    let drive_type = unsafe { GetDriveTypeW(PCWSTR(volume_root.as_ptr())) };
    if drive_type != DRIVE_REMOVABLE {
        return Err(PlatformError::NotFound("removable volume".into()));
    }

    let mut root = volume_root.to_string();
    while root.ends_with(['\\', '/']) {
        root.pop();
    }
    let device_number = device_number_of(&format!(r"\\.\{root}"))?;
    let instance = disk_instance_with(device_number)?;
    let mut parent = 0u32;
    // SAFETY: `parent` receives the parent instance; `instance` came from SetupAPI.
    #[allow(unsafe_code)]
    let looked_up = unsafe { CM_Get_Parent(&raw mut parent, instance, 0) };
    if looked_up != CR_SUCCESS {
        return Err(PlatformError::Os {
            api: "CM_Get_Parent",
            code: looked_up.0,
        });
    }
    // SAFETY: `parent` is a live device instance; no veto details are requested.
    #[allow(unsafe_code)]
    let ejected = unsafe { CM_Request_Device_EjectW(parent, None, None, 0) };
    if ejected != CR_SUCCESS {
        warn!(code = ejected.0, "CM_Request_Device_EjectW refused");
        return Err(PlatformError::Os {
            api: "CM_Request_Device_EjectW",
            code: ejected.0,
        });
    }
    Ok(())
}

/// `IOCTL_STORAGE_GET_DEVICE_NUMBER` on a volume or disk device path (`\\.\E:`,
/// `\\?\usbstor#…`).
fn device_number_of(device_path: &str) -> PlatformResult<u32> {
    let wide = HSTRING::from(device_path);
    // SAFETY: the path outlives the call; access 0 needs no permissions to query the device.
    #[allow(unsafe_code)]
    let handle = unsafe {
        CreateFileW(
            PCWSTR(wide.as_ptr()),
            0,
            FILE_SHARE_READ | FILE_SHARE_WRITE,
            None,
            OPEN_EXISTING,
            FILE_ATTRIBUTE_NORMAL,
            None,
        )
    }
    .map_err(|e| os_error("CreateFileW", &e))?;
    let handle = OwnedHandle(handle);
    let mut number = STORAGE_DEVICE_NUMBER::default();
    let mut returned = 0u32;
    // SAFETY: the output buffer is exactly one `STORAGE_DEVICE_NUMBER` and its size is passed.
    #[allow(unsafe_code)]
    unsafe {
        DeviceIoControl(
            handle.0,
            IOCTL_STORAGE_GET_DEVICE_NUMBER,
            None,
            0,
            Some((&raw mut number).cast()),
            u32::try_from(std::mem::size_of::<STORAGE_DEVICE_NUMBER>()).unwrap_or(u32::MAX),
            Some(&raw mut returned),
            None,
        )
    }
    .map_err(|e| os_error("DeviceIoControl", &e))?;
    Ok(number.DeviceNumber)
}

/// The device instance of the present disk whose device number is `wanted`.
fn disk_instance_with(wanted: u32) -> PlatformResult<u32> {
    let disk_class = GUID_DEVINTERFACE_DISK;
    // SAFETY: a documented interface class GUID, no enumerator, no parent window.
    #[allow(unsafe_code)]
    let set = unsafe {
        SetupDiGetClassDevsW(
            Some(&raw const disk_class),
            PCWSTR::null(),
            None,
            DIGCF_PRESENT | DIGCF_DEVICEINTERFACE,
        )
    }
    .map_err(|e| os_error("SetupDiGetClassDevsW", &e))?;
    let set = DeviceInfoSet(set);
    for index in 0u32.. {
        let mut interface = SP_DEVICE_INTERFACE_DATA {
            cbSize: u32::try_from(std::mem::size_of::<SP_DEVICE_INTERFACE_DATA>())
                .unwrap_or(u32::MAX),
            ..Default::default()
        };
        // SAFETY: `interface` is sized; the set is alive.
        #[allow(unsafe_code)]
        let next = unsafe {
            SetupDiEnumDeviceInterfaces(
                set.0,
                None,
                &raw const disk_class,
                index,
                &raw mut interface,
            )
        };
        if next.is_err() {
            // `ERROR_NO_MORE_ITEMS` ends the walk; anything else is the same answer.
            break;
        }
        let Some((path, instance)) = interface_detail(&set, &interface) else {
            continue;
        };
        if device_number_of(&path).is_ok_and(|number| number == wanted) {
            return Ok(instance);
        }
    }
    Err(PlatformError::NotFound("removable disk".into()))
}

/// The device path and device instance behind one interface, or `None` when `SetupAPI` will not
/// say (the caller skips it).
fn interface_detail(
    set: &DeviceInfoSet,
    interface: &SP_DEVICE_INTERFACE_DATA,
) -> Option<(String, u32)> {
    // `SP_DEVICE_INTERFACE_DETAIL_DATA_W` ends in a variable-length string: allocate the
    // header plus the longest path, aligned for the header's `u32`, and treat the front as the
    // struct.
    let header = std::mem::size_of::<SP_DEVICE_INTERFACE_DETAIL_DATA_W>();
    let mut buffer = vec![0u32; header.div_ceil(4) + DEVICE_PATH_CAPACITY.div_ceil(2)];
    let byte_len = u32::try_from(buffer.len() * 4).unwrap_or(u32::MAX);
    let detail = buffer
        .as_mut_ptr()
        .cast::<SP_DEVICE_INTERFACE_DETAIL_DATA_W>();
    // SAFETY: the buffer is at least `header` bytes and aligned for `u32`, the struct's
    // strictest field; `cbSize` is the documented fixed header size.
    #[allow(unsafe_code)]
    unsafe {
        (*detail).cbSize = u32::try_from(header).unwrap_or(u32::MAX);
    }
    let mut info = SP_DEVINFO_DATA {
        cbSize: u32::try_from(std::mem::size_of::<SP_DEVINFO_DATA>()).unwrap_or(u32::MAX),
        ..Default::default()
    };
    // SAFETY: `detail` points at `buffer`, whose byte length is passed; `info` is sized.
    #[allow(unsafe_code)]
    let fetched = unsafe {
        SetupDiGetDeviceInterfaceDetailW(
            set.0,
            interface,
            Some(detail),
            byte_len,
            None,
            Some(&raw mut info),
        )
    };
    if let Err(error) = fetched {
        debug!(%error, "SetupDiGetDeviceInterfaceDetailW failed");
        return None;
    }
    let path_offset = std::mem::offset_of!(SP_DEVICE_INTERFACE_DETAIL_DATA_W, DevicePath);
    let units = buffer.len() * 2 - path_offset / 2;
    // SAFETY: the path starts `path_offset` bytes (an even number) into the `u32` buffer and
    // the remaining `units` u16s are within it; SetupAPI NUL-terminated the string.
    #[allow(unsafe_code)]
    let path = unsafe {
        std::slice::from_raw_parts(buffer.as_ptr().cast::<u16>().add(path_offset / 2), units)
    };
    Some((String::from_utf16_lossy(nul_terminated(path)), info.DevInst))
}

fn nul_terminated(wide: &[u16]) -> &[u16] {
    let end = wide
        .iter()
        .position(|&unit| unit == 0)
        .unwrap_or(wide.len());
    &wide[..end]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn share_title_is_the_first_name_plus_a_count() {
        assert_eq!(
            share_title(Path::new(r"C:\pics\holiday.jpg"), 1).to_string(),
            "holiday.jpg"
        );
        assert_eq!(
            share_title(Path::new(r"C:\pics\holiday.jpg"), 4).to_string(),
            "holiday.jpg +3"
        );
    }

    #[test]
    fn nul_terminated_stops_at_the_first_zero() {
        assert_eq!(nul_terminated(&[65, 66, 0, 67]), &[65, 66]);
        assert_eq!(nul_terminated(&[65, 66]), &[65, 66]);
    }

    #[test]
    fn a_missing_item_is_not_found_rather_than_an_os_error() {
        let result = on_sta_thread("test-sta", || {
            shell_item(Path::new(r"C:\this\path\does\not\exist\muna-test.txt")).map(|_| ())
        });
        assert!(
            matches!(result, Err(PlatformError::NotFound(_))),
            "{result:?}"
        );
    }

    #[test]
    fn a_fixed_drive_is_not_ejectable() {
        let system =
            std::env::var_os("SystemRoot").map_or_else(|| PathBuf::from(r"C:\"), PathBuf::from);
        let result = on_sta_thread("test-eject", move || eject_volume_of(&system));
        assert!(
            matches!(result, Err(PlatformError::NotFound(_))),
            "{result:?}"
        );
    }
}
