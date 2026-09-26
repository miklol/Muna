//! Drag-out (docs/modules/shelf.md "Drag out", docs/spikes/m4-drag.md): hands a gesture the
//! webview detected to OLE. `SHDoDragDrop` runs the drag with the shell's default drop source
//! and drag image over a data object the shell built itself, so Explorer, Outlook, Teams and
//! browsers see exactly what they see from an Explorer window.
//!
//! The call blocks the calling thread for the whole drag and must run on the thread that owns
//! the window while a mouse button is down — OLE captures the mouse for that thread. The
//! caller (the IPC layer) hops to the main thread first. Paths are content and never reach a
//! log line.

use std::path::Path;

use windows::Win32::Foundation::{GlobalFree, HGLOBAL};
use windows::Win32::System::Com::{
    DVASPECT_CONTENT, FORMATETC, IDataObject, STGMEDIUM, STGMEDIUM_0, TYMED_HGLOBAL,
};
use windows::Win32::System::Memory::{GMEM_MOVEABLE, GlobalAlloc, GlobalLock, GlobalUnlock};
use windows::Win32::System::Ole::{
    CF_UNICODETEXT, DROPEFFECT, DROPEFFECT_COPY, DROPEFFECT_LINK, DROPEFFECT_MOVE, OleInitialize,
};
use windows::Win32::UI::Shell::Common::ITEMIDLIST;
use windows::Win32::UI::Shell::{
    BHID_DataObject, SHCreateDataObject, SHCreateShellItemArrayFromIDLists, SHDoDragDrop,
};

use super::file_ops::{ItemId, hwnd};
use super::os_error;
use crate::error::{PlatformError, PlatformResult};
use crate::types::{DragOutcome, DragPayload, DropEffect, WindowHandle};

/// Runs the drag to its end on the calling thread (see the module docs for which thread).
pub(super) fn start_drag(
    window: WindowHandle,
    payload: &DragPayload,
) -> PlatformResult<DragOutcome> {
    ensure_ole()?;
    let data = match payload {
        DragPayload::Files(paths) => files_data_object(paths)?,
        DragPayload::Text(text) => text_data_object(text)?,
    };
    // A drag out of Muna never moves the source: the Shelf keeps its reference, so targets may
    // copy or link only.
    let allowed = DROPEFFECT(DROPEFFECT_COPY.0 | DROPEFFECT_LINK.0);
    // SAFETY: `data` is a live data object; `hwnd` is the source window (or null, which the
    // shell accepts) and only anchors the drag image. `DRAGDROP_S_DROP` and `DRAGDROP_S_CANCEL`
    // are success codes, so both arrive as `Ok` with the effect telling them apart.
    #[allow(unsafe_code)]
    let effect = unsafe { SHDoDragDrop(Some(hwnd(window)), &data, None, allowed) }
        .map_err(|e| os_error("SHDoDragDrop", &e))?;
    Ok(match effect_of(effect) {
        Some(effect) => DragOutcome::Dropped { effect },
        None => DragOutcome::Cancelled,
    })
}

/// OLE (not just COM) must be initialised on the drag's thread. wry does so for the main
/// thread when drag-drop is enabled; asking again is `S_FALSE`, never an error, and the
/// initialisation is deliberately left in place for the life of the thread.
fn ensure_ole() -> PlatformResult<()> {
    // SAFETY: no preconditions; the reserved pointer is null.
    #[allow(unsafe_code)]
    unsafe { OleInitialize(None) }.map_err(|e| os_error("OleInitialize", &e))
}

fn effect_of(effect: DROPEFFECT) -> Option<DropEffect> {
    if effect.0 & DROPEFFECT_MOVE.0 != 0 {
        Some(DropEffect::Move)
    } else if effect.0 & DROPEFFECT_COPY.0 != 0 {
        Some(DropEffect::Copy)
    } else if effect.0 & DROPEFFECT_LINK.0 != 0 {
        Some(DropEffect::Link)
    } else {
        None
    }
}

/// The shell's own data object for the items: `CF_HDROP`, the id-list formats and everything
/// else Explorer offers when dragging the same files.
fn files_data_object(paths: &[std::path::PathBuf]) -> PlatformResult<IDataObject> {
    if paths.is_empty() {
        return Err(PlatformError::Unsupported("drag with no items"));
    }
    let ids = paths
        .iter()
        .map(Path::new)
        .map(ItemId::parse)
        .collect::<PlatformResult<Vec<_>>>()?;
    let raw: Vec<*const ITEMIDLIST> = ids.iter().map(|id| id.0.cast_const()).collect();
    // SAFETY: every pointer is a valid absolute id list owned by `ids`, which outlives the
    // call; the array copies what it needs.
    #[allow(unsafe_code)]
    let array = unsafe { SHCreateShellItemArrayFromIDLists(&raw) }
        .map_err(|e| os_error("SHCreateShellItemArrayFromIDLists", &e))?;
    // SAFETY: plain COM call on a live interface with a documented handler id.
    #[allow(unsafe_code)]
    unsafe {
        array.BindToHandler::<Option<&windows::Win32::System::Com::IBindCtx>, IDataObject>(
            None,
            &BHID_DataObject,
        )
    }
    .map_err(|e| os_error("IShellItemArray::BindToHandler(BHID_DataObject)", &e))
}

/// A shell data object carrying only `CF_UNICODETEXT`.
fn text_data_object(text: &str) -> PlatformResult<IDataObject> {
    // SAFETY: an empty shell data object; `SetData` below fills it.
    #[allow(unsafe_code)]
    let data: IDataObject = unsafe { SHCreateDataObject(None, None, None::<&IDataObject>) }
        .map_err(|e| os_error("SHCreateDataObject", &e))?;
    let global = unicode_global(text)?;
    let format = FORMATETC {
        cfFormat: CF_UNICODETEXT.0,
        ptd: std::ptr::null_mut(),
        dwAspect: DVASPECT_CONTENT.0,
        lindex: -1,
        tymed: TYMED_HGLOBAL.0.cast_unsigned(),
    };
    let medium = STGMEDIUM {
        tymed: TYMED_HGLOBAL.0.cast_unsigned(),
        u: STGMEDIUM_0 { hGlobal: global },
        pUnkForRelease: std::mem::ManuallyDrop::new(None),
    };
    // SAFETY: both structs are fully initialised and outlive the call; `frelease = true`
    // hands the global to the data object, which frees it.
    #[allow(unsafe_code)]
    let set = unsafe { data.SetData(&raw const format, &raw const medium, true) };
    if let Err(error) = set {
        // SAFETY: the object refused the medium, so the global is still ours to free.
        #[allow(unsafe_code)]
        let _ = unsafe { GlobalFree(Some(global)) };
        return Err(os_error("IDataObject::SetData(CF_UNICODETEXT)", &error));
    }
    Ok(data)
}

/// `text` as a NUL-terminated UTF-16 string in movable global memory.
fn unicode_global(text: &str) -> PlatformResult<HGLOBAL> {
    let wide: Vec<u16> = text.encode_utf16().chain(std::iter::once(0)).collect();
    let bytes = wide.len() * std::mem::size_of::<u16>();
    // SAFETY: a plain allocation; a null handle is reported as an error by the binding.
    #[allow(unsafe_code)]
    let global =
        unsafe { GlobalAlloc(GMEM_MOVEABLE, bytes) }.map_err(|e| os_error("GlobalAlloc", &e))?;
    // SAFETY: `global` is a valid movable block of `bytes` bytes; the lock is balanced below.
    #[allow(unsafe_code)]
    let target = unsafe { GlobalLock(global) };
    if target.is_null() {
        // SAFETY: freeing the block we just allocated.
        #[allow(unsafe_code)]
        let _ = unsafe { GlobalFree(Some(global)) };
        return Err(super::last_error("GlobalLock"));
    }
    // SAFETY: `target` points at `bytes` writable bytes and `wide` holds exactly that many.
    #[allow(unsafe_code)]
    unsafe {
        std::ptr::copy_nonoverlapping(wide.as_ptr().cast::<u8>(), target.cast::<u8>(), bytes);
        // `GlobalUnlock` reports "still locked" / "not locked" through Err(NO_ERROR); only a
        // real failure matters, and there is nothing to do about it here either.
        let _ = GlobalUnlock(global);
    }
    Ok(global)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_effect_the_target_chose_wins_move_over_copy_over_link() {
        assert_eq!(effect_of(DROPEFFECT(0)), None);
        assert_eq!(effect_of(DROPEFFECT_COPY), Some(DropEffect::Copy));
        assert_eq!(effect_of(DROPEFFECT_LINK), Some(DropEffect::Link));
        assert_eq!(
            effect_of(DROPEFFECT(DROPEFFECT_COPY.0 | DROPEFFECT_LINK.0)),
            Some(DropEffect::Copy)
        );
        assert_eq!(
            effect_of(DROPEFFECT(DROPEFFECT_MOVE.0 | DROPEFFECT_COPY.0)),
            Some(DropEffect::Move)
        );
    }

    #[test]
    fn text_is_offered_as_nul_terminated_utf16() {
        let global = unicode_global("héllo").unwrap();
        // SAFETY: a block we allocated, read back through the same lock/unlock protocol.
        #[allow(unsafe_code)]
        let read = unsafe {
            let pointer = GlobalLock(global).cast::<u16>();
            let words: Vec<u16> = (0..6).map(|i| *pointer.add(i)).collect();
            let _ = GlobalUnlock(global);
            let _ = GlobalFree(Some(global));
            words
        };
        assert_eq!(
            read,
            "héllo".encode_utf16().chain(Some(0)).collect::<Vec<_>>()
        );
    }

    #[test]
    fn a_drag_with_nothing_in_it_is_refused_before_touching_the_shell() {
        assert_eq!(
            files_data_object(&[]).err(),
            Some(PlatformError::Unsupported("drag with no items"))
        );
    }
}
