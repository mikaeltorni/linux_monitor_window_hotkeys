#!/usr/bin/env bash
# mwh_bin.sh — Resolve and invoke the gsettings-strv Rust helper.
#
# Sourced by install.sh after SCRIPT_DIR is set. Builds the binary on demand
# via scripts/build_gsettings_strv.sh.
#
# Public functions:
#   ensure_mwh_bin  — build/locate dist/gsettings-strv; sets MWH_BIN
#   mwh_bin         — ensure_mwh_bin then run it with "$@"

# ensure_mwh_bin — Locate or build dist/gsettings-strv; export MWH_BIN.
ensure_mwh_bin() {
  local build_script bin
  build_script="${SCRIPT_DIR:-${MONITOR_HOTKEYS_REPO_DIR:?SCRIPT_DIR unset}}/scripts/build_gsettings_strv.sh"
  if [ -n "${MWH_BIN:-}" ] && [ -x "$MWH_BIN" ]; then
    return 0
  fi
  if [ ! -x "$build_script" ]; then
    if declare -F msg >/dev/null 2>&1; then
      msg "Missing build helper: $build_script"
    else
      printf 'Missing build helper: %s\n' "$build_script" >&2
    fi
    return 1
  fi
  bin="$(bash "$build_script" --print)" || return 1
  MWH_BIN="$bin"
  export MWH_BIN
}

# mwh_bin — Run the helper CLI.
mwh_bin() {
  ensure_mwh_bin || return 1
  "$MWH_BIN" "$@"
}
