//! `gsettings-strv` — installer-facing GSettings string-array helper.
//!
//! ```text
//! CURRENT="['a']" gsettings-strv append monitor-window-hotkeys@local
//! CURRENT="['a', 'x']" gsettings-strv remove x
//! ```

mod gsettings_strv;
mod logging;

fn main() {
    std::process::exit(gsettings_strv::run_cli());
}
