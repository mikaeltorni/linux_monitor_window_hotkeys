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
# from SUDO_USER) for the clean-install chain. Targets the Wayland session; on
# an X11 session the extension install is skipped with a message.
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
# resolve a sibling checkout or clone on demand so the installer still works
# standalone.
for __isc_d in "${ISC_FUNCTIONS_DIR:-}" \
               "$SCRIPT_DIR/../linux_installation_scripts_functions" \
               "$HOME/projects/linux_installation_scripts_functions"; do
  [ -n "$__isc_d" ] && [ -f "$__isc_d/component_loader.sh" ] && { source "$__isc_d/component_loader.sh"; break; }
done
if ! declare -F isc_load_helpers >/dev/null 2>&1; then
  __isc_framework_ref="${ISC_FUNCTIONS_REF:-master}"
  __isc_framework_key="${__isc_framework_ref//\//_}"
  __isc_framework_cache="${XDG_CACHE_HOME:-$HOME/.cache}/installation_scripts/framework-${__isc_framework_key}"
  __isc_framework_loader="$__isc_framework_cache/component_loader.sh"
  if [[ ! -f "$__isc_framework_loader" ]]; then
    command -v git >/dev/null 2>&1 || {
      install_log_error 'git is required to clone the shared installer framework'
      printf 'ERROR: git is required to clone the shared installer framework.\n' >&2
      exit 1
    }
    mkdir -p "${__isc_framework_cache%/*}"
    __isc_framework_tmp="$(mktemp -d "${__isc_framework_cache%/*}/.framework-${__isc_framework_key}.XXXXXX")"
    install_log_info "cloning shared installer framework ref $__isc_framework_ref for standalone installation"
    if ! GIT_TERMINAL_PROMPT=0 git clone --quiet --depth 1 --single-branch \
      --branch "$__isc_framework_ref" \
      https://github.com/mikaeltorni/linux_installation_scripts_functions.git \
      "$__isc_framework_tmp/repository"; then
      install_log_error 'could not clone the shared installer framework; check GitHub access'
      printf 'ERROR: could not clone the shared installer framework; check GitHub access.\n' >&2
      exit 1
    fi
    if [[ ! -e "$__isc_framework_cache" ]] && mv "$__isc_framework_tmp/repository" "$__isc_framework_cache"; then
      rmdir "$__isc_framework_tmp" 2>/dev/null || true
    else
      __isc_framework_loader="$__isc_framework_tmp/repository/component_loader.sh"
    fi
  fi
  ISC_FUNCTIONS_DIR="${__isc_framework_loader%/*}"
  export ISC_FUNCTIONS_DIR
  source "$__isc_framework_loader"
fi
isc_load_helpers
isc_activate_components

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
