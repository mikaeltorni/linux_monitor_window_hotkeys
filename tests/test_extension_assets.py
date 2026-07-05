"""Static integrity checks for the monitor/window hotkeys extension bundle.

Verifies the deployable extension assets are coherent and — importantly — that
this is the clean, split-out version: pointer drag/resize belong to
linux_hotkey_window_tools and the legacy send-to-workspace mode is gone, so this
extension must not carry any of those keys or handlers.
"""

from __future__ import annotations

import json
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SCHEMA = ROOT / "schemas" / "org.gnome.shell.extensions.monitor-window-hotkeys.gschema.xml"
EXTENSION_JS = ROOT / "extension.js"


def test_metadata_identity_and_schema():
    meta = json.loads((ROOT / "metadata.json").read_text(encoding="utf-8"))
    assert meta["uuid"] == "monitor-window-hotkeys@local"
    assert meta["settings-schema"] == "org.gnome.shell.extensions.monitor-window-hotkeys"
    # Ships the v11 split-out core plus the merged workspace send-mode (v12+).
    assert meta["version"] >= 12
    assert "46" in meta["shell-version"]


def test_schema_declares_monitor_move_and_tiling_keys():
    schema = SCHEMA.read_text(encoding="utf-8")
    for n in range(1, 7):
        assert f'name="move-active-window-to-monitor-{n}"' in schema
    for edge in ("top", "bottom", "left"):
        assert f'name="tile-{edge}-half"' in schema
    assert 'name="tile-active-window-right-half"' in schema


def test_extension_provides_monitor_move_tiling_and_dbus():
    js = EXTENSION_JS.read_text(encoding="utf-8")
    assert "moveFocusedWindowToMonitor" in js
    assert "tileFocusedWindowRightHalf" in js
    assert "TileRightHalf" in js  # D-Bus method used by the Ctrl+Back tiler


def test_pointer_drag_and_resize_do_not_leak_back_in():
    """Pointer drag/resize belong to linux_hotkey_window_tools and must not
    reappear here (they duplicate window-move-resize@local and double-fire)."""
    js = EXTENSION_JS.read_text(encoding="utf-8")
    schema = SCHEMA.read_text(encoding="utf-8")
    for forbidden in (
        "drag-active-window-with-pointer",
        "scale-active-window-from-center",
        "resize-active-window",
        "startPointerDrag",
        "resizeFocusedWindow",
    ):
        assert forbidden not in js, f"{forbidden} leaked into extension.js"
        assert forbidden not in schema, f"{forbidden} leaked into the schema"


def test_workspace_send_mode_is_present():
    """The unique workspace send-mode merged in from workspaces_setup must be
    present (JS handlers + schema keys) so full functionality is preserved."""
    js = EXTENSION_JS.read_text(encoding="utf-8")
    schema = SCHEMA.read_text(encoding="utf-8")
    assert "handleWorkspaceSendModeEvent" in js
    assert "startWorkspaceSendMode" in js
    assert "sendFocusedWindowToWorkspace" in js
    assert 'name="send-window-to-workspace-mode"' in schema
    assert 'name="send-mode-workspace-bindings"' in schema
    for n in range(1, 9):
        assert f'name="send-active-window-to-workspace-{n}"' in schema


def test_apply_bindings_references_deployed_strv_helper():
    apply = (ROOT / "apply-system-bindings.sh").read_text(encoding="utf-8")
    assert "gsettings-strv.py" in apply
    assert (ROOT / "gsettings-strv.py").is_file()


def test_gsettings_strv_helper_append_and_remove():
    helper = str(ROOT / "gsettings-strv.py")
    out_add = subprocess.run(
        ["python3", helper, "append", "monitor-window-hotkeys@local"],
        env={"CURRENT": "['a']", "PATH": "/usr/bin:/bin"},
        capture_output=True, text=True, check=True,
    ).stdout.strip()
    assert "monitor-window-hotkeys@local" in out_add and "'a'" in out_add
    out_del = subprocess.run(
        ["python3", helper, "remove", "monitor-window-hotkeys@local"],
        env={"CURRENT": "['a', 'monitor-window-hotkeys@local']", "PATH": "/usr/bin:/bin"},
        capture_output=True, text=True, check=True,
    ).stdout.strip()
    assert out_del == "['a']"
