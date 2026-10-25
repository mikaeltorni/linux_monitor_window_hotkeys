#!/usr/bin/env bash
# apply-system-bindings.sh — Apply the monitor/window hotkeys extension's
# gsettings configuration.
#
# Compiles the bundled schema, resets the extension's own keys to their schema
# defaults, removes conflicting GNOME WM and Tiling Assistant bindings for keys
# the extension still owns (<Super>Up/Down/Right for arrow-key half-tiling),
# sets the Super mouse-button modifier, and enables both this extension and the
# Tiling Assistant. Run as the target user; takes no arguments.
set -euo pipefail

EXT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
SCHEMA_DIR="$EXT_DIR/schemas"
EXTENSION_UUID="monitor-window-hotkeys@local"
EXTENSION_SCHEMA="org.gnome.shell.extensions.monitor-window-hotkeys"
WM_SCHEMA="org.gnome.desktop.wm.keybindings"
TILING_SCHEMA="org.gnome.shell.extensions.tiling-assistant"
WM_MOUSE_BUTTON_MODIFIER="<Super>"

WM_BINDINGS=()

WM_UNBINDINGS=(
  "minimize:<Alt><Super>R"
  "maximize:<Super>Up"
  "unmaximize:<Super>Down"
  "minimize:<Super>Down"
)

TILING_UNBINDINGS=(
  "tile-maximize:<Super>Up"
  "tile-top-half:<Control><Super>X"
  "tile-top-half:<Super>Up"
  "tile-bottom-half:<Control><Super>W"
  "tile-bottom-half:<Super>Down"
  "tile-left-half:<Control><Super>C"
  "tile-right-half:<Super>Right"
)

# schema_exists — Return success when a system gsettings schema is installed.
# Args: $1 — schema id to look for.
schema_exists() {
  gsettings list-schemas | grep -qx "$1"
}

# extension_schema_exists — Return success when this extension's schema is
# compiled and visible under SCHEMA_DIR. Takes no arguments.
extension_schema_exists() {
  gsettings --schemadir "$SCHEMA_DIR" list-schemas 2>/dev/null | grep -qx "$EXTENSION_SCHEMA"
}

# compile_extension_schema — Compile the bundled schema in SCHEMA_DIR; errors out
# when glib-compile-schemas is missing. Takes no arguments.
compile_extension_schema() {
  if ! command -v glib-compile-schemas >/dev/null 2>&1; then
    printf 'ERROR: glib-compile-schemas not found; install libglib2.0-bin\n' >&2
    return 1
  fi
  glib-compile-schemas "$SCHEMA_DIR"
}

# extension_gsettings — Run gsettings against this extension's bundled schema
# directory so its relocatable keys resolve.
# Args: $@ — gsettings subcommand and arguments.
extension_gsettings() {
  gsettings --schemadir "$SCHEMA_DIR" "$@"
}

# gsettings_strv_bin — Path to the Rust helper: deployed next to this script,
# or built into dist/ when running from a checkout.
gsettings_strv_bin() {
  if [ -x "$EXT_DIR/gsettings-strv" ]; then
    printf '%s\n' "$EXT_DIR/gsettings-strv"
  elif [ -x "$EXT_DIR/dist/gsettings-strv" ]; then
    printf '%s\n' "$EXT_DIR/dist/gsettings-strv"
  elif [ -x "$EXT_DIR/scripts/build_gsettings_strv.sh" ]; then
    bash "$EXT_DIR/scripts/build_gsettings_strv.sh" --print
  else
    printf 'ERROR: gsettings-strv helper is missing under %s\n' "$EXT_DIR" >&2
    return 1
  fi
}

# append_strv_value — Append a value to a string-array key, de-duplicating via
# the deployed gsettings-strv binary so re-runs are idempotent.
# Args: $1 — schema id; $2 — key name; $3 — value to append.
append_strv_value() {
  local schema="$1"
  local key="$2"
  local value="$3"
  local current new_value helper

  helper="$(gsettings_strv_bin)" || return 1
  current="$(gsettings get "$schema" "$key" 2>/dev/null || printf '[]')"
  new_value="$(CURRENT="$current" "$helper" append "$value")"
  gsettings set "$schema" "$key" "$new_value"
}

# remove_strv_value — Remove every occurrence of a value from a string-array key
# via the deployed gsettings-strv binary.
# Args: $1 — schema id; $2 — key name; $3 — value to remove.
remove_strv_value() {
  local schema="$1"
  local key="$2"
  local value="$3"
  local current new_value helper

  helper="$(gsettings_strv_bin)" || return 1
  current="$(gsettings get "$schema" "$key" 2>/dev/null || printf '[]')"
  new_value="$(CURRENT="$current" "$helper" remove "$value")"
  gsettings set "$schema" "$key" "$new_value"
}

# ensure_enabled_extension — Add this extension's UUID to enabled-extensions.
# Takes no arguments.
ensure_enabled_extension() {
  append_strv_value org.gnome.shell enabled-extensions "$EXTENSION_UUID"
}

# reset_extension_bindings_to_schema_defaults — Reset all of the extension's own
# keys back to their schema defaults before reapplying. Takes no arguments.
reset_extension_bindings_to_schema_defaults() {
  extension_gsettings reset-recursively "$EXTENSION_SCHEMA"
}

# apply_binding_entries — Append each "key:value" binding entry to its key in the
# given schema.
# Args: $1 — schema id; $2.. — "key:value" entries to add.
apply_binding_entries() {
  local schema="$1"
  shift

  local entry key value
  for entry in "$@"; do
    key="${entry%%:*}"
    value="${entry#*:}"
    append_strv_value "$schema" "$key" "$value"
  done
}

# remove_binding_entries — Remove each "key:value" binding entry from its key in
# the given schema, clearing defaults that would conflict with our hotkeys.
# Args: $1 — schema id; $2.. — "key:value" entries to remove.
remove_binding_entries() {
  local schema="$1"
  shift

  local entry key value
  for entry in "$@"; do
    key="${entry%%:*}"
    value="${entry#*:}"
    remove_strv_value "$schema" "$key" "$value"
  done
}

compile_extension_schema

if ! extension_schema_exists; then
  printf 'ERROR: extension schema %s not found under %s\n' "$EXTENSION_SCHEMA" "$SCHEMA_DIR" >&2
  exit 1
fi

reset_extension_bindings_to_schema_defaults

remove_binding_entries "$WM_SCHEMA" "${WM_UNBINDINGS[@]}"
apply_binding_entries "$WM_SCHEMA" "${WM_BINDINGS[@]}"
gsettings set org.gnome.desktop.wm.preferences mouse-button-modifier "'$WM_MOUSE_BUTTON_MODIFIER'"
gsettings set org.gnome.desktop.wm.preferences resize-with-right-button true

if schema_exists "$TILING_SCHEMA"; then
  gsettings set "$TILING_SCHEMA" enable-tiling-popup false
  remove_binding_entries "$TILING_SCHEMA" "${TILING_UNBINDINGS[@]}"
else
  printf 'Tiling Assistant settings schema not found; skipping conflicting binding cleanup.\n'
fi

# Enable this extension and keep the stock Tiling Assistant enabled alongside it
# (its popup is disabled and conflicting bindings are removed above, but its
# remaining tiling features stay available).
ensure_enabled_extension
append_strv_value org.gnome.shell enabled-extensions "tiling-assistant@ubuntu.com"

printf 'Applied monitor/window hotkeys. Log out and back in if GNOME Shell has not loaded the extension yet.\n'
