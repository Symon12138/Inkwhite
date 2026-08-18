// 飞白 Tauri 应用初始化。
// 职责：
//   1. 加载授权清单（GrantsManager）
//   2. 构建菜单（文件 / 编辑 / 视图）
//   3. 检查 CLI 参数 / 文件关联（双击 .md 打开）
//   4. 注册 IPC 命令
//   5. 单实例锁（防止多开）
//   6. 初始化 FileWatcher
// 对应 Electron 版 main.js 的 app.whenReady / buildMenu / openExternalPath / collectMarkdownArgs。

mod asset_file;
mod commands;
mod file_watcher;
mod grants;
mod search_open;
#[cfg(test)]
mod security_tests;
#[cfg(test)]
mod wp6_tests;

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;

use tauri::{AppHandle, Emitter, Manager};

use commands::PickedFile;
use grants::GrantsManager;
use file_watcher::FileWatcher;

/// 支持的 Markdown 文件扩展名。
const MARKDOWN_EXTENSIONS: &[&str] = &["md", "markdown", "txt"];

/// 待打开文件队列（来自文件关联 / CLI 参数），前端就绪后通过
/// consume_pending_open 逐个消费（FIFO）。多 CLI 参数 / 多文件"打开方式"
/// 不再互相覆盖丢弃。
struct PendingOpen(Mutex<Vec<PickedFile>>);

/// 前端是否已就绪（已调用 consume_pending_open）。
struct RendererReady(AtomicBool);

// ===== 文件关联辅助函数 =====

/// 检查路径是否为 Markdown 文件。
pub(crate) fn is_markdown(path: &str) -> bool {
    std::path::Path::new(path)
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| MARKDOWN_EXTENSIONS.contains(&e.to_lowercase().as_str()))
        .unwrap_or(false)
}

/// 从 CLI 参数中提取 Markdown 文件路径。
fn collect_markdown_args(args: &[String]) -> Vec<String> {
    args.iter()
        .filter(|arg| !arg.starts_with('-') && is_markdown(arg))
        .map(|arg| {
            std::path::Path::new(arg)
                .canonicalize()
                .map(|p| p.to_string_lossy().to_string())
                .unwrap_or_else(|_| arg.clone())
        })
        .collect()
}

/// 处理外部打开的文件（双击 .md / CLI 参数 / 打开方式）。
/// 前端就绪时直接发事件，未就绪时存入 PendingOpen 队列。
/// 读取失败不再静默吞错：发 mojian:open-error 事件（携带路径与原因）并打印
/// stderr。选择事件方案而非错误进 consume 通道：consume_pending_open 的返回
/// 形状（Option<PickedFile>）受"不改命令签名与序列化形状"约束，错误无法经
/// 该通道携带；事件对未监听方无副作用，且可被未来前端/日志直接消费。
fn handle_external_open(app: &AppHandle, path: &str) {
    if !is_markdown(path) {
        return;
    }

    let picked = match commands::read_picked_file(path) {
        Ok(p) => p,
        Err(reason) => {
            let _ = app.emit(
                "mojian:open-error",
                serde_json::json!({ "path": path, "reason": reason }),
            );
            eprintln!("[inkwhite] open-error path={} reason={}", path, reason);
            return;
        }
    };

    // 授权文件路径
    if let Some(grants) = app.try_state::<GrantsManager>() {
        grants.grant(path);
    }

    // 开始监听文件变更
    if let Some(file_watcher) = app.try_state::<FileWatcher>() {
        let _ = file_watcher.start_watching(path.to_string());
    }

    // 根据前端就绪状态决定推送方式
    let is_ready = app
        .try_state::<RendererReady>()
        .map(|r| r.0.load(Ordering::Relaxed))
        .unwrap_or(false);

    if is_ready {
        // 前端已就绪，直接发事件
        let _ = app.emit("mojian:open-path", &picked);
    } else {
        // 前端未就绪，存入待消费队列（FIFO，多文件逐个保留）
        if let Some(pending) = app.try_state::<PendingOpen>() {
            if let Ok(mut guard) = pending.0.lock() {
                guard.push(picked);
            }
        }
    }
}

// ===== 菜单构建 =====

/// 调试专用菜单项（重新加载 / 开发者工具）是否启用：
/// 仅 debug 构建启用，release 不创建也不转发事件。
/// 抽成纯函数以便单测 debug/release 两种语义；调用点传 cfg!(debug_assertions)
/// （编译期常量：test 构建为 true，release 构建为 false，分支被常量折叠，
/// release 产物中不残留调试菜单代码路径）。
#[cfg(test)]
fn devtools_menu_enabled(debug_build: bool) -> bool {
    debug_build
}

// ===== 应用入口 =====

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            // 第二实例启动：聚焦窗口并处理文件参数
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.set_focus();
            }
            for path in collect_markdown_args(&args) {
                handle_external_open(app, &path);
            }
        }))
        .setup(|app| {
            // 创建应用数据目录
            let data_dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&data_dir).ok();

            // 初始化状态
            let grants_manager = GrantsManager::new(data_dir);
            let file_watcher = FileWatcher::new(app.handle().clone());

            app.manage(grants_manager);
            app.manage(file_watcher);
            app.manage(PendingOpen(Mutex::new(Vec::new())));
            app.manage(RendererReady(AtomicBool::new(false)));
            app.manage(CloseGuard {
                allowed: std::sync::atomic::AtomicBool::new(false),
            });

            // 处理 CLI 参数（首次启动时的文件关联）
            let args: Vec<String> = std::env::args().collect();
            for path in collect_markdown_args(&args) {
                handle_external_open(app.handle(), &path);
            }

            Ok(())
        })
        // 外链（B23）：前端 _openPreviewLink 对所有链接 preventDefault，
        // http/https 经本命令在系统默认浏览器打开；其余 scheme 拒绝。
        // （Rust 级 on_navigation 无法挂到配置创建的窗口，纵深防御由 CSP 承担。）
        .on_window_event(|window, event| {
            // 关闭确认（B24）：dirty 时先拦下，通知前端确认；前端确认后调用
            // allow_close 置位再关闭。首次拦截会 prevent_close。
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                if let Some(app) = window.app_handle().try_state::<CloseGuard>() {
                    if app.allowed.load(std::sync::atomic::Ordering::Relaxed) {
                        return; // 前端已确认，放行
                    }
                }
                api.prevent_close();
                let _ = window.emit("mojian:close-requested", ());
            }
        })
        .invoke_handler(tauri::generate_handler![
            commands::open_file,
            commands::save_file_as,
            commands::save_export_file,
            asset_file::save_asset_file,
            asset_file::pick_image,
            search_open::search_markdown_files,
            search_open::open_dropped_file,
            search_open::read_dropped_image,
            set_close_allowed,
            open_external,
            commands::read_file,
            commands::write_file,
            commands::stat_file,
            commands::read_asset,
            commands::watch_file,
            commands::unwatch_file,
            commands::consume_pending_open,
            commands::list_directory,
            commands::pick_directory,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

/// 关闭确认守卫：前端确认后才允许真正关闭。
struct CloseGuard {
    allowed: std::sync::atomic::AtomicBool,
}

/// 前端确认关闭后置位（IPC）。
#[tauri::command]
fn set_close_allowed(app: tauri::AppHandle) {
    if let Some(guard) = app.try_state::<CloseGuard>() {
        guard.allowed.store(true, std::sync::atomic::Ordering::Relaxed);
    }
}

/// 外链经系统默认浏览器打开（仅 http/https；其余 scheme 拒绝，防协议注入）。
#[tauri::command]
fn open_external(url: String) -> Result<(), String> {
    let parsed = url::Url::parse(&url).map_err(|_| "无法解析链接".to_string())?;
    match parsed.scheme() {
        "http" | "https" => {}
        other => return Err(format!("不允许的链接协议: {}", other)),
    }
    open_in_system_browser(&url).map_err(|e| format!("打开链接失败: {}", e))
}

/// 外链经系统默认浏览器打开（Windows：cmd /c start "" url）。
fn open_in_system_browser(url: &str) -> std::io::Result<()> {
    #[cfg(windows)]
    {
        return std::process::Command::new("cmd")
            .args(["/c", "start", "", url])
            .spawn()
            .map(|_| ());
    }
    #[cfg(not(windows))]
    {
        let _ = url;
        return Ok(());
    }
}
