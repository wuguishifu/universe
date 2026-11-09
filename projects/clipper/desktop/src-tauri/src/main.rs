// Without this, release builds open a console window next to the app.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    clipper_desktop_lib::run()
}
