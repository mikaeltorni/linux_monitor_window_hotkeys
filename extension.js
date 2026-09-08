/**
 * extension.js — Monitor & Window Hotkeys GNOME Shell extension.
 *
 * Provides keyboard shortcuts (and a D-Bus API) to move the focused window
 * between monitors and tile it to screen halves, plus a modal "send active
 * window to workspace N" (Super+U) mode. The D-Bus interface (TileRightHalf, …)
 * lets the companion Ctrl+Back tiler systemd service trigger tiling without
 * keybindings.
 *
 * Pointer-driven window move (drag) and resize (center scale) live in the
 * standalone linux_hotkey_window_tools repository (window-move-resize@local).
 *
 * Components:
 *   - getFocusWindow(): Resolve the focused, user-manageable window.
 *   - moveFocusedWindowToMonitor(): Move the focused window between monitors.
 *   - tileFocusedWindow{Top,Bottom,Left,Right}Half(): Half-screen tiling.
 *   - sendFocusedWindowToWorkspace()/…SendMode…(): Send window to a workspace.
 *   - MonitorWindowHotkeysExtension: Extension lifecycle (enable/disable).
 */
import Shell from 'gi://Shell';
import Meta from 'gi://Meta';
import Gio from 'gi://Gio';
import Clutter from 'gi://Clutter';
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

// Super+U hold-to-send mode: hold the trigger, tap a workspace-select key to
// choose the target, then right-click windows to send them there without
// switching. Direct "send to workspace N" accelerators are also registered.
const WORKSPACE_SEND_MODE_KEY = 'send-window-to-workspace-mode';
const WORKSPACE_SEND_MODE_BINDINGS_KEY = 'send-mode-workspace-bindings';
const WORKSPACE_SEND_KEYBINDINGS = [
  { name: 'send-active-window-to-workspace-1', workspace: 0 },
  { name: 'send-active-window-to-workspace-2', workspace: 1 },
  { name: 'send-active-window-to-workspace-3', workspace: 2 },
  { name: 'send-active-window-to-workspace-4', workspace: 3 },
  { name: 'send-active-window-to-workspace-5', workspace: 4 },
  { name: 'send-active-window-to-workspace-6', workspace: 5 },
  { name: 'send-active-window-to-workspace-7', workspace: 6 },
  { name: 'send-active-window-to-workspace-8', workspace: 7 },
];

const DBUS_BUS_NAME = 'org.gnome.shell.extensions.MonitorWindowHotkeys';
const DBUS_OBJECT_PATH = '/org/gnome/shell/extensions/monitor_window_hotkeys';

// D-Bus XML interface definition for programmatic window tiling.
const DBUS_INTERFACE_XML = `
<node name="/org/gnome/shell/extensions/monitor_window_hotkeys">
  <interface name="org.gnome.shell.extensions.MonitorWindowHotkeys">
    <method name="PerformWindowAction">
      <arg type="s" name="windowId" direction="in"/>
      <arg type="s" name="action" direction="in"/>
    </method>
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
 * Report whether a Meta.Window is a normal user-manageable application window.
 *
 * @param {Meta.Window|null} win Candidate window.
 * @returns {boolean} True when hotkeys should be allowed to act on it.
 */
function isUserWindow(win) {
  const skipTaskbar = typeof win?.is_skip_taskbar === 'function'
    ? win.is_skip_taskbar()
    : win?.skip_taskbar;

  return Boolean(win && !skipTaskbar);
}

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
  if (!isUserWindow(win)) {
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
 * @param {Meta.Window|null} win Explicit target, defaulting to focus.
 * @returns {void}
 */
function moveFocusedWindowToMonitor(monitorIndex, win = getFocusWindow()) {
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
 * Move a window to a workspace without switching to it.
 *
 * @param {Meta.Window|null} win Window to move.
 * @param {number} workspaceIndex Zero-based destination workspace index.
 * @returns {void}
 */
function moveWindowToWorkspace(win, workspaceIndex) {
  if (!isUserWindow(win)) {
    return;
  }

  const workspaceManager = global.workspace_manager;
  if (workspaceIndex < 0 || workspaceIndex >= workspaceManager.n_workspaces) {
    return;
  }

  const workspace = workspaceManager.get_workspace_by_index(workspaceIndex);
  if (!workspace || typeof win.change_workspace !== 'function') {
    return;
  }

  try {
    win.change_workspace(workspace);
  } catch (error) {
    console.error(`monitor-window-hotkeys: failed to send window to workspace ${workspaceIndex + 1}: ${error}`);
  }
}

/**
 * Move the focused window to a workspace without switching there.
 *
 * @param {number} workspaceIndex Zero-based destination workspace index.
 * @returns {void}
 */
function sendFocusedWindowToWorkspace(workspaceIndex) {
  moveWindowToWorkspace(getFocusWindow(), workspaceIndex);
}

/**
 * Return the topmost normal window under the current pointer position.
 *
 * @returns {Meta.Window|null} Window under pointer, falling back to focus.
 */
function getWindowUnderPointer() {
  const [, pointerX, pointerY] = global.get_pointer();
  const windowActors = global.get_window_actors?.() || [];

  for (let i = windowActors.length - 1; i >= 0; i--) {
    const win = windowActors[i]?.get_meta_window?.();
    if (!isUserWindow(win)) {
      continue;
    }

    const frame = win.get_frame_rect?.();
    if (!frame) {
      continue;
    }

    if (
      pointerX >= frame.x
      && pointerX < frame.x + frame.width
      && pointerY >= frame.y
      && pointerY < frame.y + frame.height
    ) {
      return win;
    }
  }

  return getFocusWindow();
}

/**
 * Unmaximize a window across the differing GNOME Shell/Mutter APIs.
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
 * Mutter aborts the shell (assertion `which_monitor >= 0`) when
 * get_work_area_for_monitor()/move_to_monitor() is called with -1, which
 * win.get_monitor() returns while a window is transiently off all monitors.
 * Because that abort is at the C level it cannot be caught, so every monitor
 * lookup is clamped here.
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
 * Tile the focused window to a sub-rectangle of its monitor's work area.
 *
 * Shared implementation behind the top/bottom/left/right half tilers.
 *
 * @param {string} label Edge name used in error messages (e.g. 'top').
 * @param {(workArea: Meta.Rectangle) => {x: number, y: number, width: number,
 *   height: number}} computeRect Maps the monitor work area to the target rect.
 * @param {Meta.Window|null} win Explicit target, defaulting to focus.
 * @param {boolean} raise Whether to raise after tiling (interactive default).
 * @returns {void}
 */
function tileFocusedWindowToRect(label, computeRect, win = getFocusWindow(), raise = true) {
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
    if (raise) raiseWindow(win);
  } catch (error) {
    console.error(`monitor-window-hotkeys: failed to tile focused window ${label}: ${error}`);
  }
}

/**
 * Tile the focused window to the top half of its monitor's work area.
 *
 * @param {Meta.Window|null} win Explicit target, defaulting to focus.
 * @param {boolean} raise Whether to raise after tiling (interactive default).
 * @returns {void}
 */
function tileFocusedWindowTopHalf(win = getFocusWindow(), raise = true) {
  tileFocusedWindowToRect('top', (workArea) => ({
    x: workArea.x,
    y: workArea.y,
    width: workArea.width,
    height: Math.floor(workArea.height / 2),
  }), win, raise);
}

/**
 * Tile the focused window to the bottom half of its monitor's work area.
 *
 * @param {Meta.Window|null} win Explicit target, defaulting to focus.
 * @param {boolean} raise Whether to raise after tiling (interactive default).
 * @returns {void}
 */
function tileFocusedWindowBottomHalf(win = getFocusWindow(), raise = true) {
  tileFocusedWindowToRect('bottom', (workArea) => {
    const halfHeight = Math.floor(workArea.height / 2);
    return {
      x: workArea.x,
      y: workArea.y + halfHeight,
      width: workArea.width,
      height: halfHeight,
    };
  }, win, raise);
}

/**
 * Tile the focused window to the left half of its monitor's work area.
 *
 * @param {Meta.Window|null} win Explicit target, defaulting to focus.
 * @param {boolean} raise Whether to raise after tiling (interactive default).
 * @returns {void}
 */
function tileFocusedWindowLeftHalf(win = getFocusWindow(), raise = true) {
  tileFocusedWindowToRect('left', (workArea) => {
    const leftWidth = Math.floor(workArea.width / 2);
    return {
      x: workArea.x,
      y: workArea.y,
      width: workArea.width - leftWidth,
      height: workArea.height,
    };
  }, win, raise);
}

/**
 * Tile the focused window to the right half of its monitor's work area.
 *
 * Also invoked over D-Bus (TileRightHalf) by the Ctrl+Back tiler service.
 *
 * @param {Meta.Window|null} win Explicit target, defaulting to focus.
 * @param {boolean} raise Whether to raise after tiling (interactive default).
 * @returns {void}
 */
function tileFocusedWindowRightHalf(win = getFocusWindow(), raise = true) {
  tileFocusedWindowToRect('right', (workArea) => {
    const leftWidth = Math.floor(workArea.width / 2);
    return {
      x: workArea.x + leftWidth,
      y: workArea.y,
      width: workArea.width - leftWidth,
      height: workArea.height,
    };
  }, win, raise);
}

/**
 * Apply a whitelisted move/tile action to an X11 window without focus or raise.
 * @param {string} windowId Decimal or hexadecimal XID (never a title or PID).
 * @param {string} action Existing MoveToMonitorN or TileEdgeHalf method name.
 * @returns {void} Throws for invalid targets/actions, so D-Bus callers can log failure.
 */
function performWindowAction(windowId, action) {
  if (!/^(?:0x[0-9a-f]+|[0-9]+)$/i.test(windowId))
    throw new Error('Invalid X11 window id');
  const xid = Number(windowId);
  // Mutter 46 exposes XIDs through get_description() as "0x...";
  // native Wayland descriptions start with W and must never match an XID.
  // See GNOME/mutter gnome-46 src/core/window.c: meta_window_update_desc.
  const win = global.get_window_actors().map(actor => actor.get_meta_window())
    .find(candidate => isUserWindow(candidate) &&
      /^0x[0-9a-f]+$/i.test(candidate.get_description()) &&
      Number(candidate.get_description()) === xid);
  if (!xid || !win) throw new Error('X11 window not found');
  const monitor = /^MoveToMonitor([1-6])$/.exec(action);
  if (monitor) {
    const index = Number(monitor[1]) - 1;
    if (index >= global.display.get_n_monitors()) throw new Error('Monitor unavailable');
    moveFocusedWindowToMonitor(index, win);
  } else {
    const tilers = {TileRightHalf: tileFocusedWindowRightHalf,
      TileLeftHalf: tileFocusedWindowLeftHalf, TileTopHalf: tileFocusedWindowTopHalf,
      TileBottomHalf: tileFocusedWindowBottomHalf};
    if (!Object.hasOwn(tilers, action)) throw new Error('Unsupported window action');
    tilers[action](win, false);
  }
}

/**
 * Normalize a Clutter key symbol to a lowercase key name.
 *
 * @param {number} keySymbol Clutter key symbol.
 * @returns {string} Normalized key name, or an empty string.
 */
function normalizeKeySymbol(keySymbol) {
  if (!keySymbol || typeof Clutter.keyval_name !== 'function') {
    return '';
  }

  return (Clutter.keyval_name(keySymbol) || '').toLowerCase();
}

/**
 * Extract the non-modifier key name from a GNOME accelerator string.
 *
 * @param {string} accelerator Accelerator such as '<Super>Z'.
 * @returns {string} Normalized key name, or an empty string.
 */
function acceleratorKeyName(accelerator) {
  return String(accelerator || '').replace(/<[^>]+>/g, '').trim().toLowerCase();
}

/**
 * Build the hold-mode workspace target map from extension settings.
 *
 * @param {Gio.Settings} settings Extension settings.
 * @returns {Map<string, number>} Normalized key name to zero-based workspace.
 */
function getWorkspaceSendModeTargetMap(settings) {
  const targetMap = new Map();
  for (const entry of settings.get_strv(WORKSPACE_SEND_MODE_BINDINGS_KEY)) {
    const separator = entry.indexOf(':');
    if (separator <= 0) {
      continue;
    }

    const workspaceNumber = Number.parseInt(entry.slice(0, separator), 10);
    const keyName = acceleratorKeyName(entry.slice(separator + 1));
    if (!Number.isInteger(workspaceNumber) || workspaceNumber < 1 || !keyName) {
      continue;
    }

    targetMap.set(keyName, workspaceNumber - 1);
  }

  return targetMap;
}

/**
 * Return whether a key release should end Super+U send mode.
 *
 * @param {string} keyName Normalized Clutter key name.
 * @returns {boolean} True when the mode should stop.
 */
function keyReleaseStopsWorkspaceSendMode(keyName) {
  return keyName === 'u' || keyName === 'super_l' || keyName === 'super_r';
}

/**
 * Activate Super+U workspace-send mode by grabbing all input.
 *
 * The workspace selection keys (Super+Z..R) are global GNOME workspace-switch
 * accelerators, so without an input grab Mutter consumes them before the
 * extension's captured-event handler can see them. Pushing a modal grab routes
 * every key and pointer event to the grab actor instead. No-ops when already
 * active or when the grab cannot be acquired.
 *
 * @param {{active: boolean, targetWorkspace: ?number,
 *   suppressRightRelease: boolean, grab: ?object}} state Send-mode state.
 * @param {Clutter.Actor} eventActor Reactive grab-target actor.
 * @returns {void}
 */
function startWorkspaceSendMode(state, eventActor) {
  if (!state || state.active || !eventActor) {
    return;
  }

  const grab = Main.pushModal(eventActor, { actionMode: Shell.ActionMode.NONE });
  if (grab.get_seat_state() !== Clutter.GrabState.ALL) {
    Main.popModal(grab);
    console.error('monitor-window-hotkeys: failed to grab input for workspace send mode');
    return;
  }

  state.grab = grab;
  state.active = true;
  state.targetWorkspace = null;
  state.suppressRightRelease = false;
  global.stage.set_key_focus(eventActor);
}

/**
 * Deactivate Super+U workspace-send mode and release the input grab.
 *
 * Safe to call when send mode is not active.
 *
 * @param {{active: boolean, targetWorkspace: ?number,
 *   suppressRightRelease: boolean, grab: ?object}|null} state Send-mode state.
 * @returns {void}
 */
function stopWorkspaceSendMode(state) {
  if (!state) {
    return;
  }

  if (state.grab) {
    global.stage.set_key_focus(null);
    Main.popModal(state.grab);
    state.grab = null;
  }

  state.active = false;
  state.targetWorkspace = null;
  state.suppressRightRelease = false;
}

/**
 * Handle captured events while Super+U workspace-send mode is active.
 *
 * @param {Clutter.Event} event Captured event.
 * @param {{active: boolean, targetWorkspace: ?number,
 *   suppressRightRelease: boolean, grab: ?object}} state Send-mode state.
 * @param {Gio.Settings} settings Extension settings.
 * @returns {number} Clutter.EVENT_STOP when the event was consumed.
 */
function handleWorkspaceSendModeEvent(event, state, settings) {
  if (!state?.active) {
    return Clutter.EVENT_PROPAGATE;
  }

  const eventType = event.type();

  if (eventType === Clutter.EventType.KEY_PRESS) {
    const keyName = normalizeKeySymbol(event.get_key_symbol());
    const targetMap = getWorkspaceSendModeTargetMap(settings);
    if (targetMap.has(keyName)) {
      state.targetWorkspace = targetMap.get(keyName);
      return Clutter.EVENT_STOP;
    }
  }

  if (eventType === Clutter.EventType.KEY_RELEASE) {
    const keyName = normalizeKeySymbol(event.get_key_symbol());
    const targetMap = getWorkspaceSendModeTargetMap(settings);

    if (keyReleaseStopsWorkspaceSendMode(keyName)) {
      stopWorkspaceSendMode(state);
      return Clutter.EVENT_STOP;
    }

    // Keep the selected target sticky so a single workspace-key press can be
    // followed by multiple right-click sends; just swallow the key release.
    if (targetMap.has(keyName)) {
      return Clutter.EVENT_STOP;
    }
  }

  if (eventType === Clutter.EventType.BUTTON_PRESS && event.get_button() === 3) {
    if (state.targetWorkspace === null || state.targetWorkspace === undefined) {
      return Clutter.EVENT_PROPAGATE;
    }

    moveWindowToWorkspace(getWindowUnderPointer(), state.targetWorkspace);
    state.suppressRightRelease = true;
    return Clutter.EVENT_STOP;
  }

  if (
    eventType === Clutter.EventType.BUTTON_RELEASE
    && event.get_button() === 3
    && state.suppressRightRelease
  ) {
    state.suppressRightRelease = false;
    return Clutter.EVENT_STOP;
  }

  return Clutter.EVENT_PROPAGATE;
}

/**
 * GNOME Shell extension entry point for monitor/window hotkeys.
 *
 * On enable() it exports the D-Bus tiling interface, creates the send-mode grab
 * actor, and registers every keybinding defined in the extension schema. On
 * disable() it tears all of that down so the extension can be cleanly reloaded.
 */
export default class MonitorWindowHotkeysExtension extends Extension {
  /**
   * Export the D-Bus interface, wire the send-mode actor, and register all
   * keybindings.
   *
   * @returns {void}
   */
  enable() {
    this._settings = this.getSettings();
    this._keybindings = [];
    this._workspaceSendModeState = {
      active: false,
      targetWorkspace: null,
      suppressRightRelease: false,
      grab: null,
    };

    const dbusImplementation = {
      PerformWindowAction: performWindowAction,
      TileRightHalf: () => tileFocusedWindowRightHalf(),
      TileLeftHalf: () => tileFocusedWindowLeftHalf(),
      TileTopHalf: () => tileFocusedWindowTopHalf(),
      TileBottomHalf: () => tileFocusedWindowBottomHalf(),
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

    // Dedicated, off-screen reactive actor used as the Super+U send-mode grab
    // target. Events during a pointer grab are delivered only to the grab
    // actor's 'event' signal (the capture phase is skipped), so send mode is
    // handled here.
    this._sendModeActor = new Clutter.Actor({ width: 0, height: 0, reactive: true });
    Main.uiGroup.add_child(this._sendModeActor);
    this._sendModeEventId = this._sendModeActor.connect('event', (actor, event) => {
      return handleWorkspaceSendModeEvent(
        event,
        this._workspaceSendModeState,
        this._settings,
      );
    });

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
      () => tileFocusedWindowRightHalf(),
    );
    this._keybindings.push('tile-active-window-right-half');

    Main.wm.addKeybinding(
      'tile-active-window-top-half',
      this._settings,
      Meta.KeyBindingFlags.NONE,
      Shell.ActionMode.NORMAL,
      () => tileFocusedWindowTopHalf(),
    );
    this._keybindings.push('tile-active-window-top-half');

    Main.wm.addKeybinding(
      'tile-active-window-bottom-half',
      this._settings,
      Meta.KeyBindingFlags.NONE,
      Shell.ActionMode.NORMAL,
      () => tileFocusedWindowBottomHalf(),
    );
    this._keybindings.push('tile-active-window-bottom-half');

    Main.wm.addKeybinding(
      'tile-active-window-left-half',
      this._settings,
      Meta.KeyBindingFlags.NONE,
      Shell.ActionMode.NORMAL,
      () => tileFocusedWindowLeftHalf(),
    );
    this._keybindings.push('tile-active-window-left-half');

    Main.wm.addKeybinding(
      WORKSPACE_SEND_MODE_KEY,
      this._settings,
      Meta.KeyBindingFlags.NONE,
      Shell.ActionMode.NORMAL,
      () => startWorkspaceSendMode(this._workspaceSendModeState, this._sendModeActor),
    );
    this._keybindings.push(WORKSPACE_SEND_MODE_KEY);

    for (const binding of WORKSPACE_SEND_KEYBINDINGS) {
      Main.wm.addKeybinding(
        binding.name,
        this._settings,
        Meta.KeyBindingFlags.NONE,
        Shell.ActionMode.NORMAL,
        () => sendFocusedWindowToWorkspace(binding.workspace),
      );
      this._keybindings.push(binding.name);
    }
  }

  /**
   * Unregister keybindings, the send-mode actor, and the D-Bus interface,
   * releasing all resources acquired in enable().
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

    if (this._workspaceSendModeState) {
      stopWorkspaceSendMode(this._workspaceSendModeState);
      this._workspaceSendModeState = null;
    }

    if (this._sendModeActor) {
      if (this._sendModeEventId) {
        this._sendModeActor.disconnect(this._sendModeEventId);
        this._sendModeEventId = null;
      }
      this._sendModeActor.destroy();
      this._sendModeActor = null;
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
