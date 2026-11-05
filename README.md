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
  trigger tiling without keybindings, and
- **Super+U send-mode**: hold Super+U, then a configured workspace key, then
  right-click a window to send it without switching workspaces. The key map is
  configured by `linux_workspaces_setup`. Releasing U or Super ends the mode;
  if a release event is missed, the input grab is also released when Super
  is no longer held, restoring the normal workspace shortcuts.

This is the single, cleanest home for the extension. Pointer-driven window drag
and resize live in
[`linux_hotkey_window_tools`](https://github.com/mikaeltorni/linux_hotkey_window_tools)
(`window-move-resize@local`); numbered switch/move accelerators stay in
`linux_hotkey_setup`. The same extension is no longer duplicated across those
repositories.

## Repository dependencies

This repository installs and runs **standalone**.

- **Installer support:** the maintained MIT library is included in
  `.installer-support/`, with its license and verifiable source manifest.
  Framework discovery works offline without a private checkout or credentials.
  The package also provides the shared press-to-capture hotkey engine for the
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
the extension. Supports both X11 and Wayland; it does not skip X11.

If GNOME Shell has not picked up edited extension code, use the sanctioned
X11 `Alt+F2 r` reload, or log out and back in on Wayland.

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
| Tile bottom half | `Ctrl+Super+W`, `Super+Down` |
| Tile left half | `Ctrl+Super+C` |
| Tile right half | `Super+Right` |

Among arrow keys, `Super+Up` and `Super+Down` tile by default (top and bottom
halves), and `Super+Right` tiles to the right half. `Ctrl+Super+Right` remains
available to Agent Command Center for terminal selection. The Ctrl+Back mouse
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
cargo test
python3 -m pytest tests/ -q
```

## Layout

```text
.
├── install.sh                         # standalone installer entry point
├── extension.js                       # GNOME Shell extension (monitor-move + tiling + D-Bus)
├── metadata.json
├── apply-system-bindings.sh           # deployed: reset keys, drop conflicts, enable
├── src/                               # Rust gsettings-strv helper (built to dist/)
├── schemas/…monitor-window-hotkeys.gschema.xml
├── lib/
│   ├── bash_logging.sh                # centralized best-effort install logging
│   └── monitor_hotkeys.sh             # install/configure/detect/uninstall library
├── installer/components.sh            # component manifest (one component)
├── installation_configs/{default,empty}.json
└── tests/
```

Scripted X11 placement can call `PerformWindowAction(windowId, action)` over the
existing D-Bus interface. It accepts decimal/hex XIDs and `MoveToMonitor1`–`6`
or `TileRightHalf`/`TileLeftHalf`/`TileTopHalf`/`TileBottomHalf`, without focusing,
raising, or switching workspaces. Invalid targets fail without touching another
window. Existing no-argument methods and interactive hotkeys retain their behavior.

## Installer lifecycle

Run these commands from this checkout. The component IDs printed by discovery
are the same IDs used by the terminal menu and programmatic actions.

| Command | Behavior |
| --- | --- |
| `bash install.sh` | Open component selection on a terminal; use the default/config selection otherwise. |
| `bash install.sh --help` | Show accepted options (`-h` is equivalent). |
| `bash install.sh --list-components` | Print component IDs, labels and defaults. |
| `bash install.sh --default` | Apply default-on components. |
| `bash install.sh --all` | Apply every component. |
| `bash install.sh --select ID,...` | Apply exactly the named components. |
| `bash install.sh --reconfigure ID,...` | Reapply those components through the same install operations. |
| `bash install.sh --uninstall ID,...` | Run the selected removal operations. |
| `bash install.sh --detect` | Print `ID<TAB>installed` or `ID<TAB>absent`. |
| `bash install.sh --export-selection` | Print selection JSON without applying it. |

The shared interface also accepts `--config NAME` (an installation JSON name
or path) and `--auth` (explicit permission for authenticated component actions).
`--config=NAME`, `--select=ID,...`, `--reconfigure=ID,...`,
`--uninstall=ID,...` and `--configure-component=ID` are equivalent forms.
Advanced discovery is available through `--list-configurable-components`,
`--list-select-configure-components` and `--list-component-config-values`;
`--configure-component ID` opens an available nested screen. Atomic owners
return empty advanced listings and reject unavailable nested configuration.

Explicit `--select ""` selects no optional components; a defined mandatory core
or installation preflight still runs. `--uninstall ""` is a no-op. Unknown or
duplicate IDs, missing operands and conflicting modes reject before component
installation/removal. Help, discovery, detection and export perform no installation.
Cancelling the component menu performs no install/removal. Configuration screens
may save their own settings when explicitly accepted.

The shared terminal screen uses arrows to move, Space to toggle, Enter to
apply and `q`/Escape to cancel; installed components support `u` for removal.
A right-arrow detail action appears where the owner provides configuration.
Removal-only selections skip core installation.

The licensed `.installer-support/` package is generated by
`linux_installation_scripts_functions`; `manifest.json` records provenance and
SHA-256 hashes, and `LICENSE.md` retains the MIT grant. It is a shared library
subset, not an application checkout. The default bootstrap requires no private
download or sibling repository. Explicit `ISC_COMPONENT_LIB_DIR` /
`ISC_FUNCTIONS_DIR` overrides remain available for development and the old setup
chain. Regenerate support from its owner rather than editing copies. Bash and
Python 3 are needed for this library; project build/runtime requirements above
still apply.

For example, inspect IDs first, then use the same ID with either interface:

```bash
bash install.sh --list-components
bash install.sh --select monitor_window_hotkeys
bash install.sh --detect
bash install.sh --uninstall monitor_window_hotkeys
```
