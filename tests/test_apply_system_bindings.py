"""Behavior test for apply-system-bindings.sh against a fake gsettings.

Verifies the deployed binding script frees the Super vertical arrows and the
conflicting GNOME WM / Tiling Assistant defaults so the extension's half-tiling
accelerators win, without touching the real session. Ported from
linux_hotkey_setup when the extension was extracted into this repository.
"""

from __future__ import annotations

import ast
import json
import os
import subprocess
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def test_apply_system_bindings_reassigns_super_vertical_arrows_to_half_tiling():
    """System binding application should free Super+Up/Down for top/bottom tiling."""
    script_path = ROOT / "apply-system-bindings.sh"

    with tempfile.TemporaryDirectory() as td:
        temp_dir = Path(td)
        bin_dir = temp_dir / "bin"
        bin_dir.mkdir()
        log_path = temp_dir / "gsettings.jsonl"
        state_path = temp_dir / "gsettings-state.json"

        fake_gsettings = bin_dir / "gsettings"
        fake_gsettings.write_text(
            """#!/usr/bin/env python3
import json
import os
import sys

STATE_PATH = os.environ["FAKE_GSETTINGS_STATE"]
LOG_PATH = os.environ["FAKE_GSETTINGS_LOG"]

DEFAULTS = {
    ("org.gnome.desktop.wm.keybindings", "maximize"): "['<Super>Up', '<Alt>F10']",
    ("org.gnome.desktop.wm.keybindings", "unmaximize"): "['<Super>Down', '<Alt>F5']",
    ("org.gnome.desktop.wm.keybindings", "minimize"): "['<Super>Down', '<Alt><Super>R']",
    ("org.gnome.shell", "enabled-extensions"): "[]",
    ("org.gnome.shell.extensions.tiling-assistant", "tile-maximize"): "['<Super>Up', '<Super>KP_5']",
    ("org.gnome.shell.extensions.tiling-assistant", "tile-top-half"): "[]",
    ("org.gnome.shell.extensions.tiling-assistant", "tile-bottom-half"): "[]",
    ("org.gnome.shell.extensions.tiling-assistant", "tile-left-half"): "[]",
    ("org.gnome.shell.extensions.tiling-assistant", "tile-right-half"): "[]",
}


def load_state():
    if not os.path.exists(STATE_PATH):
        return {}
    with open(STATE_PATH, "r", encoding="utf-8") as handle:
        return json.load(handle)


def save_state(state):
    with open(STATE_PATH, "w", encoding="utf-8") as handle:
        json.dump(state, handle)


def state_key(schema, key):
    return f"{schema}::{key}"


args = sys.argv[1:]
if args[:1] == ["--schemadir"]:
    args = args[2:]

if args == ["list-schemas"]:
    print("org.gnome.desktop.wm.keybindings")
    print("org.gnome.shell")
    print("org.gnome.shell.extensions.monitor-window-hotkeys")
    print("org.gnome.shell.extensions.tiling-assistant")
    raise SystemExit(0)

if args[:1] == ["reset-recursively"]:
    with open(LOG_PATH, "a", encoding="utf-8") as handle:
        handle.write(json.dumps({"cmd": "reset-recursively", "schema": args[1]}) + "\\n")
    raise SystemExit(0)

if args[:1] == ["get"]:
    schema, key = args[1], args[2]
    state = load_state()
    print(state.get(state_key(schema, key), DEFAULTS.get((schema, key), "[]")))
    raise SystemExit(0)

if args[:1] == ["set"]:
    schema, key, value = args[1], args[2], args[3]
    state = load_state()
    state[state_key(schema, key)] = value
    save_state(state)
    with open(LOG_PATH, "a", encoding="utf-8") as handle:
        handle.write(json.dumps({"cmd": "set", "schema": schema, "key": key, "value": value}) + "\\n")
    raise SystemExit(0)

raise SystemExit(f"unsupported fake gsettings args: {args}")
""",
            encoding="utf-8",
        )
        fake_gsettings.chmod(0o755)

        fake_compile_schemas = bin_dir / "glib-compile-schemas"
        fake_compile_schemas.write_text("#!/usr/bin/env bash\nexit 0\n", encoding="utf-8")
        fake_compile_schemas.chmod(0o755)

        env = os.environ.copy()
        env["PATH"] = f"{bin_dir}:{env['PATH']}"
        env["FAKE_GSETTINGS_LOG"] = str(log_path)
        env["FAKE_GSETTINGS_STATE"] = str(state_path)
        proc = subprocess.run(
            ["bash", str(script_path)],
            cwd=ROOT,
            text=True,
            capture_output=True,
            check=False,
            env=env,
        )

        assert proc.returncode == 0, proc.stderr

        entries = [
            json.loads(line)
            for line in log_path.read_text(encoding="utf-8").splitlines()
            if line.strip()
        ]

    def latest_value(schema: str, key: str) -> str:
        """Return the last fake GSettings value written for a schema/key pair."""
        matches = [
            entry["value"]
            for entry in entries
            if entry.get("cmd") == "set" and entry.get("schema") == schema and entry.get("key") == key
        ]
        assert matches, f"No GSettings set recorded for {schema} {key}"
        return matches[-1]

    assert "<Super>Up" not in ast.literal_eval(
        latest_value("org.gnome.desktop.wm.keybindings", "maximize")
    )
    assert "<Super>Down" not in ast.literal_eval(
        latest_value("org.gnome.desktop.wm.keybindings", "unmaximize")
    )
    assert "<Super>Down" not in ast.literal_eval(
        latest_value("org.gnome.desktop.wm.keybindings", "minimize")
    )
    maximize_bindings = ast.literal_eval(
        latest_value("org.gnome.shell.extensions.tiling-assistant", "tile-maximize")
    )
    assert "<Super>Up" not in maximize_bindings
    assert "<Super>KP_5" in maximize_bindings
    schema = (
        ROOT / "schemas" / "org.gnome.shell.extensions.monitor-window-hotkeys.gschema.xml"
    ).read_text(encoding="utf-8")
    assert "&lt;Super&gt;Up', '&lt;Control&gt;&lt;Super&gt;X" in schema
    assert "<Super>Down" not in ast.literal_eval(
        latest_value("org.gnome.shell.extensions.tiling-assistant", "tile-bottom-half")
    )
