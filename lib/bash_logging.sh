#!/usr/bin/env bash
# Centralized best-effort file logging for install.sh.
#
# Source this file from installer scripts, then call install_log_info,
# install_log_warn, or install_log_error for action paths and boundary
# failures. Log writes never abort installation; user-facing stdout/stderr
# messages remain the caller's responsibility.

INSTALL_LOG_DIR="${INSTALL_LOG_DIR:-$SCRIPT_DIR/.log}"
INSTALL_LOG_FILE="${INSTALL_LOG_FILE:-$INSTALL_LOG_DIR/install.log}"

# Write one structured log line to .log/install.log when the checkout is
# writable. Arguments: $1 - level, $2.. - message text.
install_log_write() {
  local level="$1"
  shift || true
  local timestamp message
  timestamp="$(date -u '+%Y-%m-%dT%H:%M:%SZ' 2>/dev/null || printf 'unknown-time')"
  message="$*"

  mkdir -p "$INSTALL_LOG_DIR" 2>/dev/null || return 0
  printf '%s %s [install.sh] %s\n' "$timestamp" "$level" "$message" >>"$INSTALL_LOG_FILE" 2>/dev/null || true
}

# Log an informational installer state transition.
install_log_info() {
  install_log_write "INFO" "$@"
}

# Log a recoverable installer warning.
install_log_warn() {
  install_log_write "WARN" "$@"
}

# Log an installer boundary failure before surfacing it to the user.
install_log_error() {
  install_log_write "ERROR" "$@"
}
