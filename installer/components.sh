#!/usr/bin/env bash
# components.sh - Component manifest for linux_monitor_window_hotkeys.
#
# Sourced by install.sh after lib/monitor_hotkeys.sh, then executed through
# component_main from the shared component framework. This repository ships one
# real feature — the monitor/window hotkeys GNOME Shell extension (move the
# focused window to a numbered monitor, tile it to screen halves, and a D-Bus
# tiling interface used by the Ctrl+Back tiler service) — so it exposes a single
# default-on component.
#
# Entry format:
#   id|label|default(on/off)|configure_fn|detect_fn|uninstall_fn|section
#
# Customize the four "move window to monitor N" accelerators non-interactively
# with MONITOR_MOVE_1..MONITOR_MOVE_4 (friendly "alt+super+x" syntax); on a
# terminal the installer prompts for each. The half-screen tiling accelerators
# come from the extension's bundled schema defaults.

ISC_REPO_NAME="linux_monitor_window_hotkeys"
ISC_REPO_LABEL="Monitor/window movement + tiling hotkeys"

ISC_COMPONENTS=(
  "monitor_window_hotkeys|Monitor/window movement + tiling hotkeys extension|on|configure_monitor_window_hotkeys|detect_monitor_window_hotkeys|uninstall_monitor_window_hotkeys|Window tools"
)
