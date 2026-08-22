// IPC 命令实现：文件读写、对话框、资产读取、目录浏览。
// 对应 Electron 版 main.js 的 IPC handler（registerIpcHandlers）。
// 所有命令在 Tauri 线程池上同步执行（dialog 需要阻塞调用）。
// 授权检查通过 GrantsManager::assert_granted 完成，前端不需要重复检查。

use std::path::Path;
use std::time::UNIX_EPOCH;

use base64::{engine::general_purpose, Engine as _};
use serde::Serialize;
use tauri::{AppHandle, State};
use tauri_plugin_dialog::DialogExt;

use crate::file_watcher::FileWatcher;
use crate::grants::GrantsManager;
use crate::{PendingOpen, RendererReady};

#[cfg(test)]
#[path = "export_tests.rs"]
mod export_tests;

// ===== 返回类型 =====
// 所有结构体使用 camelCase 序列化，与前端 TypeScript 接口字段名对齐。

/// 打开文件对话框后返回的文件信息（含内容）。
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PickedFile {
    pub path: String,
    pub name: String,
    pub content: String,
    pub last_modified: u64,
}

/// 另存为对话框后返回的文件信息（不含内容）。
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SavedFile {
    pub path: String,
    pub name: String,
    pub last_modified: u64,
}

/// 读取文件返回的内容和修改时间。
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileContent {
    pub content: String,
    pub last_modified: u64,
}

/// 文件元数据（仅修改时间）。
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileMeta {
    pub last_modified: u64,
}

/// 目录条目。
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DirEntry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
}

// ===== 辅助函数 =====

/// 从文件系统元数据提取修改时间（毫秒时间戳）。
fn extract_last_modified(metadata: &std::fs::Metadata) -> u64 {
    metadata
        .modified()
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// 文件 IO 错误归类（错误仍为 String，内容区分三类）：
/// 文件不存在 / 权限拒绝 / 非 UTF-8 编码；其余保留 `{action}失败: {原始错误}`。
/// 前端可据此区分原因，但命令签名与序列化形状不变。
pub(crate) fn classify_io_error(path: &str, err: &std::io::Error, action: &str) -> String {
    match err.kind() {
        std::io::ErrorKind::NotFound => format!("文件不存在: {}", path),
        std::io::ErrorKind::PermissionDenied => format!("没有权限访问文件: {}", path),
        std::io::ErrorKind::InvalidData => {
            format!("文件不是有效的 UTF-8 编码: {}", path)
        }
        _ => format!("{}失败: {}", action, err),
    }
}

/// 读取文件内容和元数据，返回 PickedFile。
/// 错误带原因且区分三类：文件不存在 / 权限拒绝 / 非 UTF-8 编码；
/// 目录等非普通文件单独列出（先取 metadata 判定，跨平台一致）。
pub(crate) fn read_picked_file(path: &str) -> Result<PickedFile, String> {
    let metadata = std::fs::metadata(path)
        .map_err(|e| classify_io_error(path, &e, "获取文件信息"))?;
    if !metadata.is_file() {
        return Err(format!("目标不是文件（是目录或特殊对象）: {}", path));
    }
    let content = std::fs::read_to_string(path)
        .map_err(|e| classify_io_error(path, &e, "读取文件"))?;
    let last_modified = extract_last_modified(&metadata);
    let name = Path::new(path)
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| path.to_string());
    Ok(PickedFile {
        path: path.to_string(),
        name,
        content,
        last_modified,
    })
}

// ===== 授权即校验（S0.2 路径安全收紧） =====
//
// 所有按路径操作文件的命令统一先 std::fs::canonicalize（解析 junction/symlink），
// 再对 canonical 路径断言授权，最后对 canonical 路径操作；canonicalize 失败
// （路径不存在 / 无法解析）一律拒绝。防止已授权目录内出现指向目录外的
// junction/symlink（Windows `mklink /J` 无需管理员）时发生逃逸读写。

/// canonicalize + assert_granted，返回 canonical 路径；任一环节失败即拒绝。
/// canonicalize 错误同样归类（不存在 / 权限拒绝 可直接区分）。
pub(crate) fn resolve_granted_path(path: &str, grants: &GrantsManager) -> Result<String, String> {
    let canonical = std::fs::canonicalize(path)
        .map_err(|e| classify_io_error(path, &e, "解析文件路径"))?;
    let canonical_str = strip_verbatim_prefix(&canonical.to_string_lossy());
    grants.assert_granted(&canonical_str)?;
    Ok(canonical_str)
}

/// Windows 上 std::fs::canonicalize 返回 `\\?\C:\...` 扩展长度前缀形式，
/// 与对话框返回的普通路径（授权记录）不一致，比较/监听前必须还原成
/// 常规形式：`\\?\C:\...` → `C:\...`，`\\?\UNC\srv\share` → `\\srv\share`。
/// 非 Windows 原样返回。
#[cfg(windows)]
pub(crate) fn strip_verbatim_prefix(path: &str) -> String {
    if let Some(rest) = path.strip_prefix(r"\\?\UNC\") {
        // UNC 常规形式需要双反斜杠前缀（`\\srv\share`），与对话框授权记录一致
        return format!("\\\\{}", rest);
    }
    match path.strip_prefix(r"\\?\") {
        Some(rest) => rest.to_string(),
        None => path.to_string(),
    }
}

#[cfg(not(windows))]
pub(crate) fn strip_verbatim_prefix(path: &str) -> String {
    path.to_string()
}

// ===== IPC 命令 =====

/// 打开文件对话框，选择一个 Markdown 文件并读取内容。
/// 对应 Electron 版 desktop:open-file。
#[tauri::command]
pub fn open_file(
    app: AppHandle,
    grants: State<'_, GrantsManager>,
) -> Result<Option<PickedFile>, String> {
    let file_path = app
        .dialog()
        .file()
        .add_filter("Markdown", &["md", "markdown", "txt"])
        .blocking_pick_file();

    match file_path {
        Some(fp) => {
            let path = fp.into_path().map_err(|e| e.to_string())?;
            let path_str = path.to_string_lossy().to_string();
            // 打开文件即用户手势：授权文件本身 + 所在目录（侧边栏目录浏览需列父目录）
            grants.grant_with_parent(&path_str);
            let picked = read_picked_file(&path_str)?;
            Ok(Some(picked))
        }
        None => Ok(None),
    }
}

/// 另存为对话框，保存内容到用户选择的位置。
/// 对应 Electron 版 desktop:save-file-as。
#[tauri::command]
pub fn save_file_as(
    app: AppHandle,
    suggested_name: String,
    content: String,
    grants: State<'_, GrantsManager>,
    file_watcher: State<'_, FileWatcher>,
) -> Result<Option<SavedFile>, String> {
    let default_name = if suggested_name.is_empty() {
        "document.md".to_string()
    } else {
        suggested_name
    };

    let file_path = app
        .dialog()
        .file()
        .add_filter("Markdown", &["md", "markdown"])
        .set_file_name(&default_name)
        .blocking_save_file();

    match file_path {
        Some(fp) => {
            let path = fp.into_path().map_err(|e| e.to_string())?;
            let path_str = path.to_string_lossy().to_string();
            backup_before_overwrite(&path, &content); // 另存为覆盖已有文件时同样留底
            std::fs::write(&path, &content).map_err(|e| e.to_string())?;
            grants.grant_with_parent(&path_str);
            let metadata = std::fs::metadata(&path).map_err(|e| e.to_string())?;
            let last_modified = extract_last_modified(&metadata);
            let name = path
                .file_name()
                .map(|n| n.to_string_lossy().to_string())
                .unwrap_or_default();
            // 开始监听新保存的文件
            let _ = file_watcher.start_watching(path_str.clone());
            Ok(Some(SavedFile {
                path: path_str,
                name,
                last_modified,
            }))
        }
        None => Ok(None),
    }
}

// ===== 导出（save_export_file，M2-RUST）=====

/// 导出扩展名白名单（导出格式全集）。
pub(crate) const EXPORT_EXTENSIONS: &[&str] = &["html", "htm", "pdf", "docx"];

/// 导出载荷：文本（UTF-8）或二进制（base64 解码后）。
#[derive(Debug)]
pub(crate) enum ExportPayload {
    Text(String),
    Binary(Vec<u8>),
}

/// 白名单判定（大小写不敏感）：白名单内放行（原样返回）；白名单外（.exe/.md 等）
/// 与无扩展名均拒绝（决策：无扩展名=不允许，须在保存对话框显式提供扩展名）。
pub(crate) fn resolve_export_filename(name: &str) -> Result<String, String> {
    let ext = Path::new(name).extension().and_then(|e| e.to_str());
    match ext {
        Some(e) if EXPORT_EXTENSIONS.contains(&e.to_lowercase().as_str()) => Ok(name.to_string()),
        Some(e) => Err(format!("不支持的导出格式: .{}（仅支持 html/htm、pdf、docx）", e)),
        None => Err(format!("导出文件名缺少扩展名: {}（须显式提供 html/htm、pdf 或 docx）", name)),
    }
}

/// 建议名补齐（对话框展示前）：缺扩展名按白名单补回默认 .html（HTML 为导出主
/// 格式）；空建议名回退 export.html；白名单外扩展名仍拒绝。
pub(crate) fn complete_export_name(suggested: &str) -> Result<String, String> {
    let trimmed = suggested.trim();
    if trimmed.is_empty() {
        return Ok("export.html".to_string());
    }
    match resolve_export_filename(trimmed) {
        Ok(name) => Ok(name),
        // 无扩展名：按白名单补齐（默认 .html）
        Err(_) if Path::new(trimmed).extension().is_none() => Ok(format!("{}.html", trimmed)),
        Err(e) => Err(e),
    }
}

/// 对话框默认名：二进制导出（pdf/docx 无法从载荷猜格式）须自带白名单扩展名；
/// 文本导出缺扩展名时补齐 .html。
pub(crate) fn dialog_default_name(
    suggested: &str,
    payload: &ExportPayload,
) -> Result<String, String> {
    match payload {
        ExportPayload::Binary(_) => resolve_export_filename(suggested),
        ExportPayload::Text(_) => complete_export_name(suggested),
    }
}

/// 载荷解析：文本与二进制二选一（互斥，同时提供或都为空 → Err）；
/// 二进制必须是合法标准 base64，解码失败 → Err。
pub(crate) fn decode_export_payload(
    content: &str,
    binary_base64: Option<&str>,
) -> Result<ExportPayload, String> {
    match binary_base64 {
        Some(b64) => {
            if !content.is_empty() {
                return Err("导出参数冲突：文本内容与二进制数据不能同时提供".to_string());
            }
            let bytes = general_purpose::STANDARD
                .decode(b64)
                .map_err(|e| format!("二进制数据不是合法的 base64: {}", e))?;
            Ok(ExportPayload::Binary(bytes))
        }
        None if content.is_empty() => Err("导出内容为空：请提供文本内容或二进制数据".to_string()),
        None => Ok(ExportPayload::Text(content.to_string())),
    }
}

/// 对话框确认后：白名单校验最终名（防用户删扩展名/改白名单外）→ 写入
/// （文本 UTF-8 / 二进制原字节）→ SavedFile。取消路径（Ok(None)）依赖原生
/// 对话框不可单测；确认路径逻辑全部在此、可测。
pub(crate) fn finish_export_save(path: &Path, payload: &ExportPayload) -> Result<SavedFile, String> {
    let path_str = path.to_string_lossy().to_string();
    let name = path
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_default();
    resolve_export_filename(&name)?;
    match payload {
        ExportPayload::Text(text) => std::fs::write(path, text).map_err(|e| e.to_string())?,
        ExportPayload::Binary(bytes) => std::fs::write(path, bytes).map_err(|e| e.to_string())?,
    }
    let metadata = std::fs::metadata(path).map_err(|e| e.to_string())?;
    Ok(SavedFile {
        path: path_str,
        name,
        last_modified: extract_last_modified(&metadata),
    })
}

/// 导出保存：HTML/PDF/DOCX 另存为对话框 + 写入。content 与 binary_base64 二选一，
/// 返回 SavedFile，取消返回 Ok(None)。不授权不监听（导出物为一次性交付文件）。
// 注：注册入口在 lib.rs invoke_handler（本任务文件所有权不含 lib.rs，集成步骤
// 注册；注册前豁免 dead_code，注册后此属性可删除）。
#[allow(dead_code)]
#[tauri::command]
pub fn save_export_file(
    app: AppHandle,
    suggested_name: String,
    content: String,
    binary_base64: Option<String>,
) -> Result<Option<SavedFile>, String> {
    let payload = decode_export_payload(&content, binary_base64.as_deref())?;
    let default_name = dialog_default_name(&suggested_name, &payload)?;

    let file_path = app
        .dialog()
        .file()
        .add_filter("导出文件", EXPORT_EXTENSIONS)
        .set_file_name(&default_name)
        .blocking_save_file();

    match file_path {
        Some(fp) => {
            let path = fp.into_path().map_err(|e| e.to_string())?;
            finish_export_save(&path, &payload).map(Some)
        }
        None => Ok(None),
    }
}

/// 读取已授权文件的内容。
/// 对应 Electron 版 desktop:read-file。
#[tauri::command]
pub fn read_file(
    path: String,
    grants: State<'_, GrantsManager>,
) -> Result<Option<FileContent>, String> {
    read_granted_file(&path, &grants)
}

/// read_file 核心逻辑（可单测）：canonicalize → assert_granted → 读取。
/// 读取错误带原因返回 Err（String 形状不变，内容区分三类：
/// 文件不存在 / 权限拒绝 / 非 UTF-8 编码），不再静默吞成 Ok(None)。
pub(crate) fn read_granted_file(path: &str, grants: &GrantsManager) -> Result<Option<FileContent>, String> {
    let canonical = resolve_granted_path(path, grants)?;
    let picked = read_picked_file(&canonical)?;
    Ok(Some(FileContent {
        content: picked.content,
        last_modified: picked.last_modified,
    }))
}

/// 写入已授权文件。
/// 对应 Electron 版 desktop:write-file。
#[tauri::command]
pub fn write_file(
    path: String,
    content: String,
    grants: State<'_, GrantsManager>,
) -> Result<FileMeta, String> {
    write_granted_file(&path, &content, &grants)
}

/// write_file 核心逻辑（可单测）：canonicalize → assert_granted → 写入。
/// 目标是已存在文件（autosave 写穿）；canonicalize 失败（如文件被外部删除）
/// 返回结构化错误而非 panic，错误保持 String 形状，前端 catch 逻辑不受影响。
pub(crate) fn write_granted_file(
    path: &str,
    content: &str,
    grants: &GrantsManager,
) -> Result<FileMeta, String> {
    let canonical = resolve_granted_path(path, grants)?;
    backup_before_overwrite(Path::new(&canonical), content);
    std::fs::write(&canonical, content).map_err(|e| e.to_string())?;
    let metadata = std::fs::metadata(&canonical).map_err(|e| e.to_string())?;
    Ok(FileMeta {
        last_modified: extract_last_modified(&metadata),
    })
}

/// 数据安全环：覆盖已存在文件前，把磁盘旧内容留一份 `<file>.bak`
/// （同目录、单份滚动覆盖——保护"这次保存改坏了"，不做多代历史）。
/// 仅当旧内容与新内容不同才写；新建文件不产生；备份失败尽力而为，
/// 绝不阻塞保存本身。
fn backup_before_overwrite(canonical: &Path, new_content: &str) {
    let Ok(old) = std::fs::read(canonical) else {
        return; // 新文件（或已被外部删除）：无需备份
    };
    if old.as_slice() == new_content.as_bytes() {
        return; // 内容未变：避免自动保存空转磨损
    }
    let mut bak = canonical.as_os_str().to_owned();
    bak.push(".bak");
    let _ = std::fs::write(Path::new(&bak), &old);
}

/// 获取已授权文件的修改时间（不读内容）。
/// 对应 Electron 版 desktop:stat-file。
#[tauri::command]
pub fn stat_file(
    path: String,
    grants: State<'_, GrantsManager>,
) -> Result<Option<FileMeta>, String> {
    stat_granted_file(&path, &grants)
}

/// stat_file 核心逻辑（可单测）：canonicalize → assert_granted → 元数据。
pub(crate) fn stat_granted_file(path: &str, grants: &GrantsManager) -> Result<Option<FileMeta>, String> {
    let canonical = resolve_granted_path(path, grants)?;
    match std::fs::metadata(&canonical) {
        Ok(metadata) => Ok(Some(FileMeta {
            last_modified: extract_last_modified(&metadata),
        })),
        Err(_) => Ok(None),
    }
}

/// 开始监听一个已授权的文件。
///
/// 监听的最终所有权由前端当前文档生命周期决定；重复请求同一路径是幂等的。
#[tauri::command]
pub fn watch_file(
    path: String,
    grants: State<'_, GrantsManager>,
    file_watcher: State<'_, FileWatcher>,
) -> Result<(), String> {
    let canonical = resolve_watch_target(&path, &grants)?;
    file_watcher.start_watching(canonical)
}

/// watch_file 目标校验（可单测）：canonicalize → assert_granted → 必须是文件。
pub(crate) fn resolve_watch_target(path: &str, grants: &GrantsManager) -> Result<String, String> {
    let canonical = resolve_granted_path(path, grants)?;
    let metadata = std::fs::metadata(&canonical).map_err(|e| format!("无法监听文件: {}", e))?;
    if !metadata.is_file() {
        return Err(format!("监听目标不是文件：{}", canonical));
    }
    Ok(canonical)
}

/// 停止监听一个文件。
///
/// 停止操作本身是幂等的；仍要求路径已授权，避免 IPC 被用于探测任意路径。
#[tauri::command]
pub fn unwatch_file(
    path: String,
    grants: State<'_, GrantsManager>,
    file_watcher: State<'_, FileWatcher>,
) -> Result<(), String> {
    // 与 watch_file 使用同一 canonical 键注册/注销，确保停掉对应 watcher。
    let canonical = resolve_granted_path(&path, &grants)?;
    file_watcher.stop_watching(&canonical);
    Ok(())
}

/// consume_pending_open 核心逻辑（可单测）：标记前端就绪，从队列头部弹出一个文件。
/// FIFO 顺序；空队列返回 None；与 RendererReady 标记相互独立
/// （就绪标记不阻塞队列后续消费，队列内容也不影响就绪标记）。
pub(crate) fn consume_next_pending(
    pending: &PendingOpen,
    ready: &RendererReady,
) -> Option<PickedFile> {
    use std::sync::atomic::Ordering;
    ready.0.store(true, Ordering::Relaxed);
    let mut guard = pending.0.lock().ok()?;
    if guard.is_empty() {
        return None;
    }
    Some(guard.remove(0))
}

/// 消费待打开文件（文件关联 / CLI 参数）。
/// 前端调用此命令表示已就绪，后续文件打开通过事件推送；
/// 队列中未消费完的文件可再次调用逐个取出。
/// 对应 Electron 版 desktop:consume-pending-open。
#[tauri::command]
pub fn consume_pending_open(
    pending: State<'_, PendingOpen>,
    ready: State<'_, RendererReady>,
) -> Option<PickedFile> {
    consume_next_pending(&pending, &ready)
}

/// 列出目录内容（用于文件树面板）。
/// 授权只来自用户手势（pick_directory 对话框）；此处只校验授权，不再自动授权。
#[tauri::command]
pub fn list_directory(
    path: String,
    grants: State<'_, GrantsManager>,
) -> Result<Vec<DirEntry>, String> {
    list_directory_entries(&path, &grants)
}

/// list_directory 核心逻辑（可单测）：先断言授权（词法路径，与对话框授权一致），再枚举排序。
pub(crate) fn list_directory_entries(path: &str, grants: &GrantsManager) -> Result<Vec<DirEntry>, String> {
    grants.assert_granted(path)?;

    let mut entries = Vec::new();
    let dir = std::fs::read_dir(path).map_err(|e| e.to_string())?;
    for entry in dir {
        if let Ok(entry) = entry {
            let file_type = entry.file_type().map_err(|e| e.to_string())?;
            let name = entry.file_name().to_string_lossy().to_string();
            let entry_path = entry.path().to_string_lossy().to_string();
            entries.push(DirEntry {
                name,
                path: entry_path,
                is_dir: file_type.is_dir(),
            });
        }
    }
    // 目录在前，文件在后；同类按名称排序（不区分大小写）
    entries.sort_by(|a, b| match (a.is_dir, b.is_dir) {
        (true, false) => std::cmp::Ordering::Less,
        (false, true) => std::cmp::Ordering::Greater,
        _ => a.name.to_lowercase().cmp(&b.name.to_lowercase()),
    });
    Ok(entries)
}

/// 原生目录选择对话框（文件树根目录）。
/// 返回选中目录的完整路径；用户取消返回 None。
/// 对话框即用户手势：选中后自动授权该目录，目录下文件可经由祖先匹配读取。
#[tauri::command]
pub fn pick_directory(
    app: AppHandle,
    grants: State<'_, GrantsManager>,
) -> Result<Option<String>, String> {
    let folder = app.dialog().file().blocking_pick_folder();

    match folder {
        Some(fp) => {
            let path = fp.into_path().map_err(|e| e.to_string())?;
            let path_str = path.to_string_lossy().to_string();
            grants.grant(&path_str);
            Ok(Some(path_str))
        }
        None => Ok(None),
    }
}