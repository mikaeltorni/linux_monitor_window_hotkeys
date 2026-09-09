# Clean Installation Compatibility

The `linux-configuration` skill owns the clean-install and root-optional
installer rules; they are not restated here. Repository-specific installer
facts:

The installer targets the Wayland session and skips cleanly on X11.

# Ownership: the monitor-move + tiling extension lives here only

This repository is the single home of the `monitor-window-hotkeys@local` GNOME
Shell extension — move the focused window to a numbered monitor, tile it to
screen halves, and the D-Bus tiling interface (`TileRightHalf`, …). It was
extracted here so the same extension is no longer duplicated (and clobbered at
install time) across `linux_hotkey_setup` and `linux_workspaces_setup`.

Keep these boundaries so the duplication does not return:

- **Pointer drag/resize** belong to `linux_hotkey_window_tools`
  (`window-move-resize@local`). Do not re-add `drag-active-window-*` /
  `scale-active-window-*` / `resize-active-window-*` keys or handlers here.
- **"Move window to workspace N"** is a native GNOME `move-to-workspace-N`
  keybinding owned by `linux_hotkey_setup`. Do not reintroduce the legacy
  extension-based `send-active-window-to-workspace` / send-mode here.

The `tests/` `test_extension_is_the_clean_split_out_version` guard fails if any
of those leak back in; treat a failure as a signal that ownership drifted, not
as a test to relax.

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


## Shared workflow

This file intentionally contains project-specific ownership, data-safety,
component, integration, and deployment facts. The reusable workflow rules
live in the selected skills and must not be copied into every project file.

Before editing, read this project file, then load:

- `general-programming-guidelines` for the engineering workflow;
- `commits` for capability boundaries and commit verification;
- `worktree` for isolation, branch, merge, and consumer reapplication; and
- `linux-configuration` when the task touches GNOME, desktop settings,
  systemd user services, or any `install.sh`.

Those skills are the cross-project source of truth for workflow, delivery,
desktop deployment, clean-install compatibility, and root-optional installer
rules. Project-specific sections here may narrow ownership or add required
verification, but must not restate or contradict those shared policies.
