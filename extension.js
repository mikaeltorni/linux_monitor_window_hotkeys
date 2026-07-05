/**
 * extension.js — Monitor & Window Hotkeys GNOME Shell extension.
 *
 * Provides keyboard shortcuts (and a D-Bus API) to move the focused window
 * between monitors and tile it to screen halves. The D-Bus interface
 * (TileRightHalf, …) lets the companion Ctrl+Back tiler systemd service trigger
 * tiling without keybindings.
 *
 * Pointer-driven window move (drag) and resize (center scale) have moved to the
 * standalone linux_hotkey_window_tools repository (window-move-resize@local).
 *
 * Components:
 *   - getFocusWindow(): Resolve the focused, user-manageable window.
 *   - moveFocusedWindowToMonitor(): Move the focused window between monitors.
 *   - tileFocusedWindow{Top,Bottom,Left,Right}Half(): Half-screen tiling.
 *   - MonitorWindowHotkeysExtension: Extension lifecycle (enable/disable).
 */
import Shell from 'gi://Shell';
import Meta from 'gi://Meta';
import Gio from 'gi://Gio';
import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

const MONITOR_KEYBINDINGS = [
  { name: 'move-active-window-to-monitor-1', monitor: 0 },
  { name: 'move-active-window-to-monitor-2', monitor: 1 },
  { name: 'move-active-window-to-monitor-3', monitor: 2 },
  { name: 'move-active-window-to-monitor-4', monitor: 3 },
  { name: 'move-active-window-to-monitor-5', monitor: 4 },
  { name: 'move-active-window-to-monitor-6', monitor: 5 },
];

const DBUS_BUS_NAME = 'org.gnome.shell.extensions.MonitorWindowHotkeys';
const DBUS_OBJECT_PATH = '/org/gnome/shell/extensions/monitor_window_hotkeys';

// D-Bus XML interface definition for programmatic window tiling.
const DBUS_INTERFACE_XML = `
<node name="/org/gnome/shell/extensions/monitor_window_hotkeys">
  <interface name="org.gnome.shell.extensions.MonitorWindowHotkeys">
    <method name="TileRightHalf"/>
    <method name="TileLeftHalf"/>
    <method name="TileTopHalf"/>
    <method name="TileBottomHalf"/>
    <method name="MoveToMonitor1"/>
    <method name="MoveToMonitor2"/>
    <method name="MoveToMonitor3"/>
    <method name="MoveToMonitor4"/>
    <method name="MoveToMonitor5"/>
    <method name="MoveToMonitor6"/>
  </interface>
</node>`;

/**
 * Return the currently focused, user-manageable window.
 *
 * Windows that are absent or marked skip-taskbar (panels, docks, OSDs) are
 * ignored so hotkeys only ever act on real application windows.
 *
 * @returns {Meta.Window|null} The focused window, or null when none qualifies.
 */
function getFocusWindow() {
  const win = global.display.focus_window;
  const skipTaskbar = typeof win?.is_skip_taskbar === 'function'
    ? win.is_skip_taskbar()
    : win?.skip_taskbar;

  if (!win || skipTaskbar) {
    return null;
  }

  return win;
}

/**
 * Move the focused window to the given monitor.
 *
 * No-ops when there is no focused window, the window cannot be moved, the
 * monitor index is out of range, or the window already lives on that monitor.
 *
 * @param {number} monitorIndex Zero-based index of the destination monitor.
 * @returns {void}
 */
function moveFocusedWindowToMonitor(monitorIndex) {
  const win = getFocusWindow();
  if (!win || typeof win.move_to_monitor !== 'function') {
    return;
  }

  const monitorCount = global.display.get_n_monitors();
  if (monitorIndex < 0 || monitorIndex >= monitorCount) {
    return;
  }

  if (typeof win.get_monitor === 'function' && win.get_monitor() === monitorIndex) {
    return;
  }

  win.move_to_monitor(monitorIndex);
}

/**
 * Unmaximize a window across the differing GNOME Shell/Mutter APIs.
 *
 * Newer Mutter exposes get_maximized(); older versions expose the
 * maximizedHorizontally/maximizedVertically flags. Both paths are handled.
 *
 * @param {Meta.Window} win Window to unmaximize.
 * @returns {void}
 */
function unmaximizeWindow(win) {
  if (typeof win.get_maximized === 'function') {
    const maximized = win.get_maximized();
    if (maximized) {
      win.unmaximize(maximized);
    }
    return;
  }

  if (win.maximizedHorizontally && typeof win.unmaximize === 'function') {
    win.unmaximize(Meta.MaximizeFlags.HORIZONTAL);
  }
  if (win.maximizedVertically && typeof win.unmaximize === 'function') {
    win.unmaximize(Meta.MaximizeFlags.VERTICAL);
  }
}

/**
 * Report whether a window can be both moved and resized.
 *
 * @param {Meta.Window|null} win Candidate window.
 * @returns {boolean} True when the window supports move_resize_frame and any
 *   available allows_resize()/allows_move() checks pass.
 */
function canMoveResizeWindow(win) {
  if (!win || typeof win.move_resize_frame !== 'function') {
    return false;
  }

  // Check allows_resize/allows_move only when those methods exist.
  if (typeof win.allows_resize === 'function' && !win.allows_resize()) {
    return false;
  }
  if (typeof win.allows_move === 'function' && !win.allows_move()) {
    return false;
  }

  return true;
}

/**
 * Normalize a window's state so it can be freely positioned/resized.
 *
 * Clears maximized, fullscreen, minimized, and always-on-top states when the
 * corresponding methods are available on this GNOME Shell version.
 *
 * @param {Meta.Window} win Window to prepare.
 * @returns {void}
 */
function prepareWindowForMoveResize(win) {
  unmaximizeWindow(win);
  if (typeof win.unmake_fullscreen === 'function') {
    win.unmake_fullscreen();
  }
  if (typeof win.unminimize === 'function') {
    win.unminimize();
  }
  if (typeof win.unmake_above === 'function') {
    win.unmake_above();
  }
}

/**
 * Raise a window to the top and mark it most-recently-used.
 *
 * Uses the workspace-aware API when present, otherwise falls back to the
 * legacy raise_and_make_recent().
 *
 * @param {Meta.Window} win Window to raise.
 * @returns {void}
 */
function raiseWindow(win) {
  if (typeof win.raise_and_make_recent_on_workspace === 'function') {
    win.raise_and_make_recent_on_workspace(global.workspace_manager.get_active_workspace());
  } else if (typeof win.raise_and_make_recent === 'function') {
    win.raise_and_make_recent();
  }
}

/**
 * Resolve a valid monitor index for a window.
 *
 * Mutter aborts the entire shell (assertion `which_monitor >= 0` in
 * meta_window_get_work_area_for_monitor) when get_work_area_for_monitor() or
 * move_to_monitor() is called with -1. win.get_monitor() returns -1 while a
 * window is transiently off all monitors, e.g. mid workspace-switch animation.
 * Because that abort is at the C level it cannot be caught with try/catch, so
 * every monitor lookup must be clamped to a usable index here. Falls back to
 * the current monitor and finally returns -1 when no monitor is available, so
 * callers can bail out instead of crashing the shell.
 *
 * @param {Meta.Window} win Window whose monitor is requested.
 * @returns {number} A valid zero-based monitor index, or -1 when none exists.
 */
function resolveWindowMonitor(win) {
  const monitorCount = global.display.get_n_monitors();
  if (monitorCount <= 0) {
    return -1;
  }

  let index = typeof win.get_monitor === 'function' ? win.get_monitor() : -1;
  if (index < 0 || index >= monitorCount) {
    index = global.display.get_current_monitor();
  }
  if (index < 0 || index >= monitorCount) {
    return -1;
  }

  return index;
}

/**
 * Get the usable work area (excluding panels) for a window's monitor.
 *
 * @param {Meta.Window} win Window whose monitor work area is requested.
 * @returns {Meta.Rectangle|null} The work area rectangle for that monitor, or
 *   null when the window is not on any valid monitor.
 */
function getWindowWorkArea(win) {
  const monitorIndex = resolveWindowMonitor(win);
  if (monitorIndex < 0) {
    return null;
  }

  return win.get_work_area_for_monitor(monitorIndex);
}

/**
 * Tile the focused window to a sub-rectangle of its monitor's work area.
 *
 * Shared implementation behind the top/bottom/left/right half tilers: it
 * resolves the focused window's monitor, asks computeRect() for the target
 * geometry, and applies it. No-ops when the window cannot be move/resized or
 * the computed rectangle is degenerate. Errors are logged, never thrown.
 *
 * @param {string} label Edge name used in error messages (e.g. 'top').
 * @param {(workArea: Meta.Rectangle) => {x: number, y: number, width: number,
 *   height: number}} computeRect Maps the monitor work area to the target rect.
 * @returns {void}
 */
function tileFocusedWindowToRect(label, computeRect) {
  const win = getFocusWindow();
  if (!canMoveResizeWindow(win)) {
    return;
  }

  try {
    prepareWindowForMoveResize(win);

    const monitorIndex = resolveWindowMonitor(win);
    if (monitorIndex < 0) {
      return;
    }
    const workArea = win.get_work_area_for_monitor(monitorIndex);
    const { x, y, width, height } = computeRect(workArea);

    if (width <= 0 || height <= 0) {
      return;
    }

    if (typeof win.move_to_monitor === 'function') {
      win.move_to_monitor(monitorIndex);
    }
    if (typeof win.move_frame === 'function') {
      win.move_frame(true, x, y);
    }
    win.move_resize_frame(true, x, y, width, height);
    raiseWindow(win);
  } catch (error) {
    console.error(`monitor-window-hotkeys: failed to tile focused window ${label}: ${error}`);
  }
}

/**
 * Tile the focused window to the top half of its monitor's work area.
 *
 * @returns {void}
 */
function tileFocusedWindowTopHalf() {
  tileFocusedWindowToRect('top', (workArea) => ({
    x: workArea.x,
    y: workArea.y,
    width: workArea.width,
    height: Math.floor(workArea.height / 2),
  }));
}

/**
 * Tile the focused window to the bottom half of its monitor's work area.
 *
 * @returns {void}
 */
function tileFocusedWindowBottomHalf() {
  tileFocusedWindowToRect('bottom', (workArea) => {
    const halfHeight = Math.floor(workArea.height / 2);
    return {
      x: workArea.x,
      y: workArea.y + halfHeight,
      width: workArea.width,
      height: halfHeight,
    };
  });
}

/**
 * Tile the focused window to the left half of its monitor's work area.
 *
 * @returns {void}
 */
function tileFocusedWindowLeftHalf() {
  tileFocusedWindowToRect('left', (workArea) => {
    const leftWidth = Math.floor(workArea.width / 2);
    return {
      x: workArea.x,
      y: workArea.y,
      width: workArea.width - leftWidth,
      height: workArea.height,
    };
  });
}

/**
 * Tile the focused window to the right half of its monitor's work area.
 *
 * Also invoked over D-Bus (TileRightHalf) by the Ctrl+Back tiler service.
 *
 * @returns {void}
 */
function tileFocusedWindowRightHalf() {
  tileFocusedWindowToRect('right', (workArea) => {
    const leftWidth = Math.floor(workArea.width / 2);
    return {
      x: workArea.x + leftWidth,
      y: workArea.y,
      width: workArea.width - leftWidth,
      height: workArea.height,
    };
  });
}

/**
 * GNOME Shell extension entry point for monitor/window hotkeys.
 *
 * On enable() it exports the D-Bus tiling interface and registers every
 * keybinding defined in the extension schema. On disable() it tears all of that
 * down so the extension can be cleanly reloaded.
 */
export default class MonitorWindowHotkeysExtension extends Extension {
  /**
   * Export the D-Bus interface and register all keybindings.
   *
   * @returns {void}
   */
  enable() {
    this._settings = this.getSettings();
    this._keybindings = [];

    const dbusImplementation = {
      TileRightHalf: tileFocusedWindowRightHalf,
      TileLeftHalf: tileFocusedWindowLeftHalf,
      TileTopHalf: tileFocusedWindowTopHalf,
      TileBottomHalf: tileFocusedWindowBottomHalf,
      MoveToMonitor1: () => moveFocusedWindowToMonitor(0),
      MoveToMonitor2: () => moveFocusedWindowToMonitor(1),
      MoveToMonitor3: () => moveFocusedWindowToMonitor(2),
      MoveToMonitor4: () => moveFocusedWindowToMonitor(3),
      MoveToMonitor5: () => moveFocusedWindowToMonitor(4),
      MoveToMonitor6: () => moveFocusedWindowToMonitor(5),
    };
    this._dbusObject = Gio.DBusExportedObject.wrapJSObject(
      DBUS_INTERFACE_XML,
      dbusImplementation,
    );
    this._dbusObject.export(Gio.DBus.session, DBUS_OBJECT_PATH);
    this._dbusOwnerId = Gio.bus_own_name_on_connection(
      Gio.DBus.session,
      DBUS_BUS_NAME,
      Gio.BusNameOwnerFlags.NONE,
      null,
      null,
    );

    for (const binding of MONITOR_KEYBINDINGS) {
      Main.wm.addKeybinding(
        binding.name,
        this._settings,
        Meta.KeyBindingFlags.NONE,
        Shell.ActionMode.NORMAL,
        () => moveFocusedWindowToMonitor(binding.monitor),
      );
      this._keybindings.push(binding.name);
    }

    Main.wm.addKeybinding(
      'tile-active-window-right-half',
      this._settings,
      Meta.KeyBindingFlags.NONE,
      Shell.ActionMode.NORMAL,
      tileFocusedWindowRightHalf,
    );
    this._keybindings.push('tile-active-window-right-half');
    Main.wm.addKeybinding(
      'tile-top-half',
      this._settings,
      Meta.KeyBindingFlags.NONE,
      Shell.ActionMode.NORMAL,
      () => tileFocusedWindowTopHalf(),
    );
    this._keybindings.push('tile-top-half');

    Main.wm.addKeybinding(
      'tile-bottom-half',
      this._settings,
      Meta.KeyBindingFlags.NONE,
      Shell.ActionMode.NORMAL,
      () => tileFocusedWindowBottomHalf(),
    );
    this._keybindings.push('tile-bottom-half');

    Main.wm.addKeybinding(
      'tile-left-half',
      this._settings,
      Meta.KeyBindingFlags.NONE,
      Shell.ActionMode.NORMAL,
      () => tileFocusedWindowLeftHalf(),
    );
    this._keybindings.push('tile-left-half');
  }

  /**
   * Unregister keybindings and the D-Bus interface, releasing all resources
   * acquired in enable().
   *
   * @returns {void}
   */
  disable() {
    if (this._dbusOwnerId) {
      Gio.bus_unown_name(this._dbusOwnerId);
      this._dbusOwnerId = null;
    }

    if (this._dbusObject) {
      this._dbusObject.unexport();
      this._dbusObject = null;
    }

    if (this._keybindings) {
      for (const bindingName of this._keybindings) {
        Main.wm.removeKeybinding(bindingName);
      }
      this._keybindings = null;
    }

    this._settings = null;
  }
}
