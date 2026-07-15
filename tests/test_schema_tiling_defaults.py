"""Regression tests for half-tiling schema default accelerators."""

from __future__ import annotations

from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SCHEMA = ROOT / "schemas" / "org.gnome.shell.extensions.monitor-window-hotkeys.gschema.xml"


def test_arrow_key_half_tiling_defaults_super_up_only():
    """Only Super+Up among arrow keys is bound to a half-tile action by default."""
    schema = SCHEMA.read_text(encoding="utf-8")

    assert (
        'name="tile-active-window-top-half" type="as">\n'
        "      <default>['&lt;Super&gt;Up', '&lt;Control&gt;&lt;Super&gt;X']</default>"
    ) in schema

    assert (
        'name="tile-active-window-bottom-half" type="as">\n'
        "      <default>['&lt;Control&gt;&lt;Super&gt;W']</default>"
    ) in schema
    assert "&lt;Super&gt;Down" not in schema.split("tile-active-window-bottom-half")[1].split(
        "tile-active-window-left-half"
    )[0]

    assert (
        'name="tile-active-window-left-half" type="as">\n'
        "      <default>['&lt;Control&gt;&lt;Super&gt;C']</default>"
    ) in schema
    assert "&lt;Super&gt;Left" not in schema.split("tile-active-window-left-half")[1].split(
        "tile-active-window-right-half"
    )[0]

    right_default = schema.split('name="tile-active-window-right-half"')[1].split("</default>")[0]
    assert "<default>['&lt;Control&gt;&lt;Super&gt;Right']" in right_default
    assert "'&lt;Super&gt;Right'" not in right_default