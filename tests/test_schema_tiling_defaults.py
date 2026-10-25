"""Regression tests for half-tiling schema default accelerators."""

from __future__ import annotations

from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SCHEMA = ROOT / "schemas" / "org.gnome.shell.extensions.monitor-window-hotkeys.gschema.xml"


def test_arrow_key_half_tiling_defaults_leave_ctrl_super_right_for_acc():
    """Arrow tiling uses Super alone so ACC can own Ctrl+Super+Right."""
    schema = SCHEMA.read_text(encoding="utf-8")

    assert (
        'name="tile-active-window-top-half" type="as">\n'
        "      <default>['&lt;Super&gt;Up', '&lt;Control&gt;&lt;Super&gt;X']</default>"
    ) in schema

    assert (
        'name="tile-active-window-bottom-half" type="as">\n'
        "      <default>['&lt;Control&gt;&lt;Super&gt;W', '&lt;Super&gt;Down']</default>"
    ) in schema

    assert (
        'name="tile-active-window-left-half" type="as">\n'
        "      <default>['&lt;Control&gt;&lt;Super&gt;C', '&lt;Super&gt;Left']</default>"
    ) in schema

    right_default = schema.split('name="tile-active-window-right-half"')[1].split(
        "</default>"
    )[0]
    assert "<default>['&lt;Super&gt;Right']" in right_default
    assert "&lt;Control&gt;&lt;Super&gt;Right" not in right_default
