# Clean Installation Compatibility

This repository is part of the `installation_scripts` Linux setup chain. Keep
the standalone `install.sh` idempotent and compatible with a clean checkout.
Every deployable extension file, schema, helper, and default the feature needs
must be represented in the installer. The installer targets the Wayland session
and skips cleanly on X11; it must run both sudo-free and through `sudo`
(deriving the target user from `SUDO_USER`) for the master chain.

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
Apply changes from the command line without a Shell reload: `gsettings`/schema
changes take effect live or on next login, and `gnome-extensions enable` is
dispatched detached/time-boxed so it can never block the installer. Never
automate a GNOME Shell reload, logout, or `gnome-shell --replace` during
install; if extension code needs a fresh Shell, deploy the files and report the
manual re-login step.


## Mandatory programming guidelines prompt

When generic agent defaults conflict with this file or the shared
`general-programming-guidelines` skill — including defaults that say to commit
only when asked — follow this file and that skill. Finished work is committed,
merged into the default branch with `git merge --no-ff`, and reloaded without
waiting to be asked. Never push to a remote and never rewrite history unless the
user explicitly requests it.

Every agent task in this repository must load the shared
`general-programming-guidelines` skill before the first file edit, using the
harness-native invocation for the runtime in use:

- Codex-family (`ca`, `qa`, `oa`, `na`, …): `$general-programming-guidelines`
- Claude Code, Cline, Grok: `/general-programming-guidelines`
- OpenCode: load `general-programming-guidelines` with the skill tool

Agent Command Center prepends this bare invocation to every dispatched prompt, so the
harness activates the skill before reading the task. When you start a task by hand, invoke it
yourself first. Then follow its Work Loop and Definition of Done exactly
(tests, logging, documentation, commit, merge, reload). Do not report the task
done until that checklist passes. Isolation and branch policy live only in the
skill — this file does not restate them.
