"""Contract tests for the standalone installer and its logging discipline.

Exercises the master-facing component contract (--list-components must be
side-effect free and tab-separated, --detect must report state) and asserts the
installer routes diagnostics through the centralized bash_logging helper rather
than ad-hoc log functions.
"""

from __future__ import annotations

import re
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def _run(args, home, extra_env=None):
    common = subprocess.check_output(
        ["git", "rev-parse", "--path-format=absolute", "--git-common-dir"],
        cwd=ROOT, text=True,
    ).strip()
    framework = Path(common).parent.parent / "linux_installation_scripts_functions"
    env = {"ISC_FUNCTIONS_DIR": str(framework), "HOME": str(home), "TARGET_HOME": str(home), "PATH": "/usr/bin:/bin"}
    if extra_env:
        env.update(extra_env)
    return subprocess.run(
        ["bash", str(ROOT / "install.sh"), *args],
        cwd=ROOT, env=env, text=True, capture_output=True, check=False,
    )


def test_list_components_is_side_effect_free_and_tab_separated(tmp_path):
    home = tmp_path / "home"
    home.mkdir()
    before = set(p.name for p in home.iterdir())
    result = _run(["--list-components"], home)
    assert result.returncode == 0, result.stderr
    lines = [ln for ln in result.stdout.splitlines() if ln.strip()]
    assert len(lines) == 1
    fields = lines[0].split("\t")
    assert fields[0] == "monitor_window_hotkeys"
    assert fields[2] == "on"
    # No files created by discovery.
    assert set(p.name for p in home.iterdir()) == before


def test_detect_reports_absent_on_empty_home(tmp_path):
    home = tmp_path / "home"
    home.mkdir()
    result = _run(["--detect"], home)
    assert result.returncode == 0, result.stderr
    assert re.search(r"^monitor_window_hotkeys\tabsent$", result.stdout, re.MULTILINE)


def test_install_sh_routes_probe_flags_and_uses_central_logging():
    install = (ROOT / "install.sh").read_text(encoding="utf-8")
    assert 'source "$SCRIPT_DIR/lib/bash_logging.sh"' in install
    assert "component_main" in install
    assert "--list-components|--export-selection|--detect|--help|-h|--uninstall" in install


def test_lib_uses_centralized_logging_not_adhoc_helpers():
    lib = (ROOT / "lib" / "monitor_hotkeys.sh").read_text(encoding="utf-8")
    assert "install_log_info" in lib
    # The library must not define its own log()/log_info()/warn()/err().
    for adhoc in (r"\nlog\(\)", r"\nlog_info\(\)", r"\nwarn\(\)", r"\nerr\(\)"):
        assert re.search(adhoc, lib) is None, f"ad-hoc logger {adhoc!r} defined in lib"


def test_gitignore_excludes_log_dir():
    assert ".log/" in (ROOT / ".gitignore").read_text(encoding="utf-8")


def test_install_sh_does_not_keep_unused_session_type():
    installer = (ROOT / "install.sh").read_text(encoding="utf-8")
    assert "SESSION_TYPE=" not in installer


def test_x11_clean_home_installs_current_extension_idempotently(tmp_path):
    """Copy real assets with desktop calls stubbed; X11 must not skip the API."""
    script = r'''set -eu
SCRIPT_DIR="$1"
source "$1/lib/bash_logging.sh"
source "$1/lib/monitor_hotkeys.sh"
TARGET_HOME="$2"
TARGET_USER="$(id -un)"
SESSION_TYPE=x11
MONITOR_HOTKEYS_REPO_DIR="$1"
MWH_BIN=/bin/true
is_root() { return 1; }
msg() { :; }
ensure_mwh_bin() { :; }
need_cmd() { command -v "$1" >/dev/null; }
run_as_target() { :; }
install_monitor_extension_core
install_monitor_extension_core
'''
    result = subprocess.run(["bash", "-c", script, "test", str(ROOT), str(tmp_path)],
                            capture_output=True, text=True)
    assert result.returncode == 0, result.stderr
    installed = tmp_path / ".local/share/gnome-shell/extensions/monitor-window-hotkeys@local"
    assert (installed / "extension.js").read_bytes() == (ROOT / "extension.js").read_bytes()
    assert (installed / "schemas/gschemas.compiled").is_file()
