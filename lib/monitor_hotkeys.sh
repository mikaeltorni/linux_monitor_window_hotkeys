#!/usr/bin/env bash
# monitor_hotkeys.sh - install library for the monitor/window hotkeys extension.
#
# Sourced by install.sh after the shared component framework + install helpers
# are loaded (it relies on run_as_target/msg/need_cmd/is_root/apt_install from
# installer_helpers.sh, isc_capture_hotkey from the framework's hotkey_capture
# engine, and the install_log_* helpers from lib/bash_logging.sh). Defines the
# single monitor/window hotkeys component: it installs the local GNOME Shell
# extension (move-to-monitor + half-tiling + a D-Bus tiling interface), applies
# its system bindings, and captures the four "move focused window to monitor N"
# accelerators.
#
# The extension's half-screen tiling accelerators come from the bundled schema
# defaults (applied by apply-system-bindings.sh); only the monitor-move
# accelerators are interactively customizable, matching the feature's prior home
# in linux_hotkey_setup.
#
# Functions:
#   monitor_hotkeys_default_for_index      - resolve one "index:accel" default.
#   install_monitor_extension_core         - copy/compile/apply/enable the extension.
#   configure_monitor_move_hotkeys         - capture the four monitor-move accelerators.
#   configure_monitor_window_hotkeys       - component entry: core + monitor-move.
#   detect_monitor_window_hotkeys          - true when the extension is installed.
#   uninstall_monitor_window_hotkeys       - remove the extension and disable it.

EXTENSION_ID="monitor-window-hotkeys@local"
SCHEMA_ID="org.gnome.shell.extensions.monitor-window-hotkeys"
GSCHEMA_FILE="org.gnome.shell.extensions.monitor-window-hotkeys.gschema.xml"

# Directory holding this library; its parent is the repository root that ships
# the deployable extension bundle (extension.js, metadata.json,
# apply-system-bindings.sh, gsettings-strv.py, schemas/).
MONITOR_HOTKEYS_LIB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MONITOR_HOTKEYS_REPO_DIR="$(cd "$MONITOR_HOTKEYS_LIB_DIR/.." && pwd)"

# Default "move focused window to monitor N" accelerators. Monitors 1-3 ship a
# default; the 4th is intentionally blank so the user assigns it. Matches the
# extension's own schema defaults.
MONITOR_MOVE_DEFAULTS=(
  "1:<Alt><Super>x"
  "2:<Alt><Super>z"
  "3:<Alt><Super>c"
  "4:"
)
: "${MONITOR_MOVE_COUNT:=4}"

# The interactive press-to-capture engine is provided by the shared framework
# (isc_capture_hotkey, loaded via isc_load_helpers). Fall back to an environment
# override or the built-in default when it is unavailable (e.g. a unit test that
# sources this library directly, or an older framework checkout) so nothing ever
# blocks the installer.
if ! declare -F isc_capture_hotkey >/dev/null 2>&1; then
  isc_capture_hotkey() {
    local env_var="$1" default_spec="$2"
    if [[ -n "$env_var" && -n "${!env_var:-}" ]]; then
      printf '%s\n' "${!env_var}"
    else
      printf '%s\n' "$default_spec"
    fi
  }
fi

# Resolve the default accelerator for a monitor index from a list of
# "index:accel" entries. Prints the accelerator (possibly empty) to stdout.
# Arguments: $1 - index; $2.. - "index:accel" default entries.
# Returns: 0.
monitor_hotkeys_default_for_index() {
  local want="$1"
  shift
  local entry
  for entry in "$@"; do
    if [[ "${entry%%:*}" == "$want" ]]; then
      printf '%s\n' "${entry#*:}"
      return 0
    fi
  done
  printf '\n'
}

# Install the extension files, compile its schema, apply its system bindings, and
# enable it. This is the core install: it does not depend on the captured
# accelerators, so the extension is present and active with its schema defaults
# even before monitor-move customization runs. Skipped on X11 (the extension
# targets the Wayland session) and when glib-compile-schemas is unavailable.
# Arguments: none. Returns: 0 on success or a documented skip; 1 on hard failure.
install_monitor_extension_core() {
  if [[ "${SESSION_TYPE:-}" =~ ^(x11|xorg)$ ]]; then
    install_log_warn "X11 session detected; skipping monitor/window hotkeys extension"
    msg "X11 session detected; skipping monitor/window hotkeys extension."
    return 0
  fi

  local ext_dir="$TARGET_HOME/.local/share/gnome-shell/extensions/$EXTENSION_ID"
  install_log_info "installing $EXTENSION_ID to $ext_dir"
  msg "Installing $EXTENSION_ID extension core"

  if is_root; then
    install -d -o "$TARGET_USER" -g "$TARGET_USER" "$ext_dir/schemas"
  else
    install -d "$ext_dir/schemas"
  fi

  install -m 0644 \
    "$MONITOR_HOTKEYS_REPO_DIR/extension.js" \
    "$MONITOR_HOTKEYS_REPO_DIR/metadata.json" \
    "$MONITOR_HOTKEYS_REPO_DIR/gsettings-strv.py" \
    "$ext_dir/"
  install -m 0755 "$MONITOR_HOTKEYS_REPO_DIR/apply-system-bindings.sh" "$ext_dir/"
  install -m 0644 "$MONITOR_HOTKEYS_REPO_DIR/schemas/$GSCHEMA_FILE" "$ext_dir/schemas/"

  if ! need_cmd glib-compile-schemas; then
    install_log_info "glib-compile-schemas missing; installing libglib2.0-bin"
    apt_install libglib2.0-bin
  fi
  glib-compile-schemas --strict "$ext_dir/schemas"

  if is_root; then
    install_log_info "fixing ownership of $ext_dir for $TARGET_USER"
    chown -R "$TARGET_USER:$TARGET_USER" "$ext_dir"
  fi

  # apply-system-bindings.sh resets the extension's keys to schema defaults,
  # removes conflicting GNOME WM / Tiling Assistant bindings, sets the Super
  # mouse-button modifier, and enables the extension. A failure here is
  # non-fatal: the files are in place and re-running (or the next login) applies
  # them, so the installer must not abort the wider setup chain.
  if ! run_as_target "$ext_dir/apply-system-bindings.sh"; then
    install_log_warn "apply-system-bindings.sh failed; extension files are installed but bindings were not applied"
    msg "WARNING: apply-system-bindings.sh failed; log out and back in, then re-run the installer."
    return 0
  fi

  install_log_info "enabling extension $EXTENSION_ID"
  run_as_target gsettings set org.gnome.shell disable-user-extensions false
  # Best-effort in-place enable, dispatched detached and time-boxed so a slow or
  # unresponsive GNOME Shell D-Bus call can never block the installer. The
  # extension is already persisted in enabled-extensions by apply-system-bindings.sh
  # (a live Shell auto-loads it; otherwise it activates on next login).
  run_as_target sh -c 'timeout 5 gnome-extensions enable "$1" >/dev/null 2>&1 </dev/null &' _ "$EXTENSION_ID" || true
  install_log_info "extension core installed"
}

# Capture an accelerator for each of the four "move window to monitor N" actions
# (defaults shown; the 4th is blank) and write the captured accelerators onto the
# extension's own schema keys, using the installed schema directory so the keys
# resolve before GNOME reloads. Runs after apply-system-bindings.sh has reset
# those keys to their defaults.
# Arguments: none. Returns: 0.
configure_monitor_move_hotkeys() {
  local ext_dir="$TARGET_HOME/.local/share/gnome-shell/extensions/$EXTENSION_ID"
  local schemadir="$ext_dir/schemas" i default accel
  install_log_info "capturing $MONITOR_MOVE_COUNT monitor-move accelerators"
  for (( i=1; i<=MONITOR_MOVE_COUNT; i++ )); do
    default="$(monitor_hotkeys_default_for_index "$i" "${MONITOR_MOVE_DEFAULTS[@]}")"
    accel="$(isc_capture_hotkey "MONITOR_MOVE_${i}" "$default" "move window to monitor $i")"
    if [[ -n "$accel" ]]; then
      install_log_info "setting move-active-window-to-monitor-$i to '$accel'"
      run_as_target gsettings --schemadir "$schemadir" set "$SCHEMA_ID" \
        "move-active-window-to-monitor-$i" "['${accel//\'/\\\'}']" 2>/dev/null || true
    else
      install_log_info "clearing move-active-window-to-monitor-$i (no accelerator)"
      run_as_target gsettings --schemadir "$schemadir" set "$SCHEMA_ID" \
        "move-active-window-to-monitor-$i" "[]" 2>/dev/null || true
    fi
  done
}

# Component entry point: install the extension core, then capture the
# monitor-move accelerators. Takes no arguments. Returns: 0.
configure_monitor_window_hotkeys() {
  install_monitor_extension_core || return 0
  configure_monitor_move_hotkeys
  msg "Monitor/window hotkeys installed. Log out and back in if GNOME Shell has not loaded the extension."
}

# Return success when the extension is installed for the target user.
# Arguments: none. Returns: 0 when the extension directory exists, else 1.
detect_monitor_window_hotkeys() {
  [ -d "$TARGET_HOME/.local/share/gnome-shell/extensions/$EXTENSION_ID" ]
}

# Remove the extension, drop it from enabled-extensions, and reset its schema so
# no stale binding survives. Best-effort: never aborts the wider chain.
# Arguments: none. Returns: 0.
uninstall_monitor_window_hotkeys() {
  local ext_dir="$TARGET_HOME/.local/share/gnome-shell/extensions/$EXTENSION_ID"
  install_log_info "removing extension $EXTENSION_ID"
  msg "Removing monitor/window hotkeys extension"
  run_as_target gsettings set org.gnome.shell disable-user-extensions false 2>/dev/null || true
  remove_strv_value org.gnome.shell enabled-extensions "$EXTENSION_ID"
  run_as_target sh -c 'timeout 5 gnome-extensions disable "$1" >/dev/null 2>&1 </dev/null &' _ "$EXTENSION_ID" || true
  rm -rf "$ext_dir"
  install_log_info "extension $EXTENSION_ID removed"
}

# Drop a value from a gsettings string-array key, keeping re-runs idempotent.
# Uses the deployed gsettings-strv.py helper when present, otherwise falls back
# to leaving the array untouched (best-effort).
# Arguments: $1 - schema; $2 - key; $3 - value to remove. Returns: 0.
remove_strv_value() {
  local schema="$1" key="$2" value="$3" current new_value helper
  helper="$MONITOR_HOTKEYS_REPO_DIR/gsettings-strv.py"
  [ -f "$helper" ] || return 0
  current="$(run_as_target gsettings get "$schema" "$key" 2>/dev/null || printf '[]')"
  new_value="$(CURRENT="$current" python3 "$helper" remove "$value" 2>/dev/null || printf '%s' "$current")"
  run_as_target gsettings set "$schema" "$key" "$new_value" 2>/dev/null || true
}
