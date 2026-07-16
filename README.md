# Linux Monitor & Window Hotkeys

> Part of [installation_scripts](https://github.com/mikaeltorni/installation_scripts) — a standalone **GNOME Shell extension** that moves the focused window to a numbered monitor, tiles it to screen halves, and exposes a D-Bus tiling interface. Tested on Ubuntu 24.04.4 LTS (GNOME 46, Wayland).

Standalone installer for the `monitor-window-hotkeys@local` GNOME Shell
extension. It provides keyboard shortcuts to:

- **move the focused window to a numbered monitor** (up to 6 monitors; the first
  three ship defaults, the fourth is prompted/assignable),
- **tile the focused window to a screen half** (top / bottom / left / right), and
- a **D-Bus interface** (`TileRightHalf`, `TileLeftHalf`, …) used by the
  companion Ctrl+Back tiler service in
  [`linux_hotkey_setup`](https://github.com/mikaeltorni/linux_hotkey_setup) to
  trigger tiling without keybindings.

This is the single, cleanest home for the extension. Pointer-driven window drag
and resize live in
[`linux_hotkey_window_tools`](https://github.com/mikaeltorni/linux_hotkey_window_tools)
(`window-move-resize@local`); "move window to workspace N" is a native GNOME
keybinding configured by `linux_hotkey_setup`. This repository owns only the
monitor-move + half-tiling extension, so the same extension is no longer
duplicated across the hotkey/workspace setup repositories.

## Repository dependencies

This repository installs and runs **standalone**.

- **Build-time (soft):** the shared installer component framework
  [`linux_installation_scripts_functions`](https://github.com/mikaeltorni/linux_installation_scripts_functions) —
  loaded from a sibling checkout when present, otherwise downloaded on demand.
  It also provides the shared press-to-capture hotkey engine used to select the
  monitor-move accelerators.
- **Consumer (soft, runtime):** `linux_hotkey_setup`'s Ctrl+Back tiler service
  calls this extension's D-Bus tiling methods. When this extension is absent the
  tiler simply has nothing to drive; nothing here requires `linux_hotkey_setup`.

See the full cross-repository map in
[installation_scripts/DEPENDENCIES.md](https://github.com/mikaeltorni/installation_scripts/blob/master/DEPENDENCIES.md).

## Install

```bash
git clone https://github.com/mikaeltorni/linux_monitor_window_hotkeys.git
cd linux_monitor_window_hotkeys
bash install.sh
```

The installer is sudo-free (and also works through `sudo` for the clean-install
chain). It copies the extension into
`~/.local/share/gnome-shell/extensions/monitor-window-hotkeys@local`, compiles
its schema, applies its system bindings (removing conflicting GNOME WM / Tiling
Assistant defaults and setting the `<Super>` mouse-button modifier), and enables
the extension. Targets the Wayland session; on an X11 session the install is
skipped with a message.

Log out and back in if GNOME Shell has not picked up the extension.

### Options

Customize the four "move window to monitor N" accelerators non-interactively
with the `MONITOR_MOVE_1`..`MONITOR_MOVE_4` environment variables (friendly
`alt+super+x` syntax); on a terminal the installer prompts for each. The
half-screen tiling accelerators come from the extension's bundled schema
defaults.

| Action | Default accelerator |
|---|---|
| Move window to monitor 1 | `Alt+Super+X` |
| Move window to monitor 2 | `Alt+Super+Z` |
| Move window to monitor 3 | `Alt+Super+C` |
| Move window to monitor 4 | *(unset — assign your own)* |
| Tile top half | `Super+Up`, `Ctrl+Super+X` |
| Tile bottom half | `Ctrl+Super+W` |
| Tile left half | `Ctrl+Super+C` |
| Tile right half | `Ctrl+Super+Right` |

Among arrow keys, only `Super+Up` tiles by default (top half). Bottom, left, and
right halves use the `Ctrl+Super` letter bindings above; the Ctrl+Back mouse
tiler in `linux_hotkey_setup` can also trigger right-half tiling via D-Bus.

## Component contract

The installer implements the shared component framework contract used by the
master installer:

```bash
bash install.sh --list-components   # id<TAB>label<TAB>default (side-effect free)
bash install.sh --default           # install the default-on component set
bash install.sh --select monitor_window_hotkeys
bash install.sh --detect            # report installed/absent
bash install.sh --uninstall monitor_window_hotkeys
```

## Tests

```bash
python3 -m pytest tests/ -q
```

## Layout

```text
.
├── install.sh                         # standalone installer entry point
├── extension.js                       # GNOME Shell extension (monitor-move + tiling + D-Bus)
├── metadata.json
├── apply-system-bindings.sh           # deployed: reset keys, drop conflicts, enable
├── gsettings-strv.py                  # deployed: gsettings string-array helper
├── schemas/…monitor-window-hotkeys.gschema.xml
├── lib/
│   ├── bash_logging.sh                # centralized best-effort install logging
│   └── monitor_hotkeys.sh             # install/configure/detect/uninstall library
├── installer/components.sh            # component manifest (one component)
├── installation_configs/{default,empty}.json
└── tests/
```
