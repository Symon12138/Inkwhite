// 飞白 Tauri 入口。
// 在 release 模式下隐藏 Windows 控制台窗口。
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    symark_lib::run();
}
