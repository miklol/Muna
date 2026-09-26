# Shelf

**Tier P1 · Owner: `muna-shell-engineer` + `muna-ui-engineer` · Status: spec**

## Reference

`shelf`, `shelf-feature-2`, `demo-03`. Dashed drop zone; grid of 64 px thumbnails with names;
header: `N items`, select-all/clear circles, `Copy ⇄`, trash, collapse, info.

## Behaviour

- Items are references (paths) + optional copies (setting: *Copy files into Shelf storage*).
- Drag **out** to any app: Rust-side `DoDragDrop` with `CF_HDROP` data object started when
  the UI reports a drag gesture beyond 6 px (`tauri-plugin-drag`-style). Validated by
  [spike S2](../spikes/m4-drag.md): the gesture reaches OLE ≈ 40 ms after the threshold and
  lands in Explorer and browser file inputs; the row opts out of the webview's own HTML5 drag.
- The data object carries a private clipboard format (`MunaShelfDrag`) so a release back over
  the notch — a drop onto our own inbound target — is ignored instead of re-adding the item.
- Thumbnails via `IShellItemImageFactory` (Explorer's own thumbnails); text/URL snippets
  supported as items (`CF_UNICODETEXT`).
- Multi-select, Copy (puts `CF_HDROP` on the clipboard), Remove, Reveal in Explorer,
  Clear all; persists across restarts.

## Acceptance criteria

- Drag a Shelf item into Outlook/Teams → attaches the file.
- Missing files show a broken-link state and can be removed in bulk.
