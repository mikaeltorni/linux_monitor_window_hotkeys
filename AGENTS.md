# Clean Installation Compatibility

The `linux-configuration` skill owns the clean-install and root-optional
installer rules; they are not restated here. Repository-specific installer
facts:

The installer is sudo-free and supports both X11 and Wayland. It does not skip
X11 sessions.

# Ownership: the monitor-move + tiling + Super+U send-mode extension lives here

This repository is the single home of the `monitor-window-hotkeys@local` GNOME
Shell extension — move the focused window to a numbered monitor, tile it to
screen halves, Super+U send-mode workspace targeting, and the D-Bus tiling
interface (`TileRightHalf`, …). It was extracted here so the same extension is
no longer duplicated (and clobbered at install time) across `linux_hotkey_setup`
and `linux_workspaces_setup`.

Keep these boundaries so the duplication does not return:

- **Pointer drag/resize** belong to `linux_hotkey_window_tools`
  (`window-move-resize@local`). Do not re-add `drag-active-window-*` /
  `scale-active-window-*` / `resize-active-window-*` keys or handlers here.
- **Numbered switch/move accelerators** (`move-to-workspace-N`) stay in
  `linux_hotkey_setup`. Super+U send-mode key maps are configured onto this
  extension by `linux_workspaces_setup`; do not move that key map back into
  those repos.

# Cross-repository runtime consumer

`linux_hotkey_setup`'s Ctrl+Back tiler service calls this extension's D-Bus
tiling methods, so the D-Bus interface and object path are a compatibility
surface — preserve `org.gnome.shell.extensions.MonitorWindowHotkeys` and its
`TileRightHalf/TileLeftHalf/TileTopHalf/TileBottomHalf` methods. The consumer
degrades gracefully when the extension is absent, so this stays standalone.

# Deployment safety

GNOME desktop deployment safety is owned by the `linux-configuration` skill.
Apply settings and extension state changes through its silent mechanisms. For
edited extension code, follow its session-specific activation procedure: use
the sanctioned in-place `Alt+F2 r` reload on X11, or report the required manual
logout/login on Wayland. Never use `gnome-shell --replace`, a shell kill, or a
forced session termination during deployment.
