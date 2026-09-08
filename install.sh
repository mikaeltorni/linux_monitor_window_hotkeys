#!/usr/bin/env bash
# install.sh — Install the Monitor & Window Hotkeys GNOME Shell extension.
#
# The extension moves the focused window to a numbered monitor, tiles it to
# screen halves, and exposes a D-Bus tiling interface (TileRightHalf, …) used by
# the companion Ctrl+Back tiler service in linux_hotkey_setup. It is a single
# default-on component: selecting it installs and enables the extension, applies
# its system bindings, and captures the four "move window to monitor N"
# accelerators (MONITOR_MOVE_1..MONITOR_MOVE_4, or prompted on a terminal, or
# defaulted). Half-screen tiling accelerators come from the bundled schema.
#
# Runs sudo-free as the desktop user, and also through sudo (deriving the target
# from SUDO_USER) for the clean-install chain. Supports both X11 and Wayland sessions.
#
# Components:
#   - main(): resolve the target user, then route the component through the framework.
#
# Usage:
#   bash install.sh                    # interactive on a TTY, else default-on set
#   bash install.sh --default          # all default-on components, no prompts
#   bash install.sh --all              # every component, no prompts
#   bash install.sh --select id,…      # exactly these component ids
#   bash install.sh --list-components  # id<TAB>label<TAB>default (side-effect free)
#   bash install.sh --detect           # report installed components
#   bash install.sh --uninstall id,…   # remove the named components
#   MONITOR_MOVE_1=alt+super+x bash install.sh --default   # customize accelerators
#   sudo bash install.sh               # also supported (clean-install chain)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# shellcheck source=lib/bash_logging.sh
source "$SCRIPT_DIR/lib/bash_logging.sh"

# Load the shared component framework + install-time helpers (single source of
# truth in linux_installation_scripts_functions) before the install library,
# which uses run_as_target/msg/need_cmd/is_root/apt_install. No vendored copy:
# resolve a sibling checkout or download on demand so the installer still works
# standalone.
for __isc_d in "${ISC_FUNCTIONS_DIR:-}" \
               "$SCRIPT_DIR/../linux_installation_scripts_functions" \
               "$HOME/projects/linux_installation_scripts_functions"; do
  [ -n "$__isc_d" ] && [ -f "$__isc_d/component_loader.sh" ] && { source "$__isc_d/component_loader.sh"; break; }
done
if ! declare -F isc_load_helpers >/dev/null 2>&1; then
  __isc_loader_url="https://raw.githubusercontent.com/mikaeltorni/linux_installation_scripts_functions/${ISC_FUNCTIONS_REF:-master}/component_loader.sh"
  __isc_loader_tmp="$(mktemp)"
  if command -v curl >/dev/null 2>&1; then
    curl -fsSL "$__isc_loader_url" -o "$__isc_loader_tmp"
  elif command -v wget >/dev/null 2>&1; then
    wget -qO "$__isc_loader_tmp" "$__isc_loader_url"
  else
    printf 'ERROR: curl or wget is required to download the shared installer framework.\n' >&2
    exit 1
  fi
  source "$__isc_loader_tmp"
  rm -f "$__isc_loader_tmp"
fi
isc_load_helpers
isc_activate_components

# shellcheck source=lib/mwh_bin.sh
source "$SCRIPT_DIR/lib/mwh_bin.sh"
# shellcheck source=lib/monitor_hotkeys.sh
source "$SCRIPT_DIR/lib/monitor_hotkeys.sh"
# shellcheck source=installer/components.sh
source "$SCRIPT_DIR/installer/components.sh"

# Populate the target user's desktop-session environment for run_as_target.
# Component discovery/help is handled before this function runs so those
# side-effect-free modes do not depend on the caller's desktop user.
initialize_target_user() {
  TARGET_USER="${SUDO_USER:-${TARGET_USER:-$USER}}"
  if [[ -z "$TARGET_USER" || "$TARGET_USER" == "root" ]]; then
    install_log_error "target user is missing or root; refusing user-level install"
    printf 'Set TARGET_USER or run through sudo from the desktop user.\n' >&2
    return 1
  fi
  TARGET_UID="$(id -u "$TARGET_USER")"
  TARGET_HOME="$(getent passwd "$TARGET_USER" | cut -d: -f6)"
  RUNTIME_DIR="/run/user/$TARGET_UID"
  USER_BUS="unix:path=$RUNTIME_DIR/bus"
  DISPLAY_VAL="${DISPLAY:-:0}"
  SESSION_TYPE="${SESSION_TYPE:-${XDG_SESSION_TYPE:-unknown}}"
}

# Resolve the target user, then route the selected components through the shared
# framework.
main() {
  initialize_target_user
  install_log_info "starting install for target user '$TARGET_USER'"
  component_main "$@"
  install_log_info "install run complete"
}

# Listing/help must print only their own output (the master installer parses
# --list-components) and stay side-effect free: handle them before main runs.
case "${1:-}" in
  --list-components|--export-selection|--detect|--help|-h|--uninstall|--uninstall=*) component_main "$@"; exit $? ;;
esac

main "$@"
