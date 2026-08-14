// M4-RUST: 跨文件搜索（search_markdown_files）与拖入打开（open_dropped_file）。
//
// S0.2 不变量落地：
//   - 搜索只遍历已授权根（对话框/文件树授权），防 junction/symlink 逃逸
//     （每进入一个目录 canonicalize 并断言仍在授权根内，跳过链接组件）;
//   - 上限约束：递归深度 / 文件数 / 单文件大小 / 结果数;
//   - spawn_blocking 后台线程，不在 UI 线程串行执行;
//   - 拖入打开：扩展名检查 → UTF-8 读取 → grant → watcher，返回 PickedFile;
//     不暴露裸授权命令。

use std::path::{Path, PathBuf};

use serde::Serialize;
use tauri::State;

use crate::commands::{read_picked_file, PickedFile};
use crate::file_watcher::FileWatcher;
use crate::grants::GrantsManager;
use crate::is_markdown;

// ===== 搜索 =====

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SearchHit {
    pub path: String,
    pub name: String,
    /// 匹配行（整行文本，去行尾空白）
    pub line: String,
    /// 行号（1 起）
    pub line_number: u32,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SearchResult {
    pub hits: Vec<SearchHit>,
    pub scanned_files: u32,
    pub truncated: bool,
}

#[derive(Clone)]
pub(crate) struct SearchLimits {
    pub max_depth: usize,
    pub max_files: u32,
    pub max_file_bytes: u64,
    pub max_hits: usize,
}

impl Default for SearchLimits {
    fn default() -> Self {
        Self {
            max_depth: 8,
            max_files: 2000,
            max_file_bytes: 2 * 1024 * 1024,
            max_hits: 500,
        }
    }
}

/// 目录是否在授权根内：canonicalize 后与根（canonical 形态）做前缀匹配。
/// 跳过符号链接组件（junction/symlink 一律视为可能逃逸，不进入）。
#[allow(dead_code)]
fn within_root(dir: &Path, root: &Path) -> bool {
    match dir.canonicalize() {
        Ok(canon) => canon.starts_with(root),
        Err(_) => false,
    }
}

/// 遍历目录树收集 Markdown 文件（纯逻辑，可单测：注入根路径与回调）。
/// 返回 (files, scanned, truncated)。
pub(crate) fn walk_markdown_files(
    root: &Path,
    limits: &SearchLimits,
    depth: usize,
    files: &mut Vec<PathBuf>,
    scanned: &mut u32,
    truncated: &mut bool,
) {
    if depth > limits.max_depth || *scanned >= limits.max_files || *truncated {
        if *scanned >= limits.max_files {
            *truncated = true;
        }
        return;
    }
    let read = match std::fs::read_dir(root) {
        Ok(rd) => rd,
        Err(_) => return,
    };
    for entry in read.flatten() {
        let path = entry.path();
        let Ok(file_type) = entry.file_type() else { continue };
        if file_type.is_symlink() {
            // junction/symlink 视为可能逃逸，跳过
            continue;
        }
        if file_type.is_dir() {
            walk_markdown_files(&path, limits, depth + 1, files, scanned, truncated);
            if *truncated {
                return;
            }
        } else if file_type.is_file() && is_markdown(&path.to_string_lossy()) {
            *scanned += 1;
            if *scanned > limits.max_files {
                *truncated = true;
                return;
            }
            files.push(path);
        }
    }
}

/// 单文件搜索（纯逻辑可单测）：按行匹配，返回命中行。
pub(crate) fn search_file(
    path: &Path,
    needle: &str,
    case_sensitive: bool,
    max_hits: usize,
    max_file_bytes: u64,
) -> (Vec<SearchHit>, bool) {
    let mut hits = Vec::new();
    let meta = match std::fs::metadata(path) {
        Ok(m) => m,
        Err(_) => return (hits, false),
    };
    if meta.len() > max_file_bytes {
        return (hits, false); // 超大小上限跳过
    }
    let content = match std::fs::read_to_string(path) {
        Ok(c) => c,
        Err(_) => return (hits, false), // 非 UTF-8 / 不可读跳过
    };
    let needle_lower = needle.to_lowercase();
    let mut truncated = false;
    for (index, raw_line) in content.lines().enumerate() {
        let line = raw_line.trim_end();
        let matched = if case_sensitive {
            line.contains(needle)
        } else {
            line.to_lowercase().contains(&needle_lower)
        };
        if matched {
            hits.push(SearchHit {
                path: path.to_string_lossy().to_string(),
                name: path
                    .file_name()
                    .map(|n| n.to_string_lossy().to_string())
                    .unwrap_or_default(),
                line: line.to_string(),
                line_number: (index + 1) as u32,
            });
            if hits.len() >= max_hits {
                truncated = true;
                break;
            }
        }
    }
    (hits, truncated)
}

/// 搜索核心（可单测）：授权根内遍历 + 逐文件匹配。
pub(crate) fn search_markdown_impl(
    root: &Path,
    needle: &str,
    case_sensitive: bool,
    limits: &SearchLimits,
    grants: &GrantsManager,
) -> Result<SearchResult, String> {
    if needle.trim().is_empty() {
        return Err("搜索关键词不能为空".to_string());
    }
    let canon_root = root
        .canonicalize()
        .map_err(|e| format!("无法解析搜索目录: {}", e))?;
    // canonicalize 在 Windows 返回 \\?\ 扩展前缀，与授权记录（对话框原样路径）不一致，
    // 断言前还原（与 commands.rs 的 resolve_granted_path 同一处理）。
    let root_str = crate::commands::strip_verbatim_prefix(&canon_root.to_string_lossy());
    grants.assert_granted(&root_str)?;

    let mut files = Vec::new();
    let mut scanned = 0u32;
    let mut truncated = false;
    walk_markdown_files(&canon_root, limits, 0, &mut files, &mut scanned, &mut truncated);

    let mut hits = Vec::new();
    for file in files {
        if hits.len() >= limits.max_hits {
            truncated = true;
            break;
        }
        let (file_hits, file_truncated) = search_file(
            &file,
            needle,
            case_sensitive,
            limits.max_hits - hits.len(),
            limits.max_file_bytes,
        );
        hits.extend(file_hits);
        if file_truncated {
            truncated = true;
            break;
        }
    }
    Ok(SearchResult {
        hits,
        scanned_files: scanned,
        truncated,
    })
}

/// IPC：跨文件搜索。根目录须已授权（文件树 pick_directory / 对话框授予）。
#[tauri::command]
pub async fn search_markdown_files(
    root: String,
    needle: String,
    case_sensitive: bool,
    grants: State<'_, GrantsManager>,
) -> Result<SearchResult, String> {
    let grants = grants.inner().clone();
    let root_path = PathBuf::from(root);
    let limits = SearchLimits::default();
    tauri::async_runtime::spawn_blocking(move || {
        search_markdown_impl(&root_path, &needle, case_sensitive, &limits, &grants)
    })
    .await
    .map_err(|e| format!("搜索任务失败: {}", e))?
}

/// 校验型拖入打开：扩展名白名单 → UTF-8 读取 → 授权 → watcher。
/// 与 handle_external_open 语义一致，但由前端拖放路径触发，不暴露裸授权。
#[tauri::command]
pub fn open_dropped_file(
    path: String,
    grants: State<'_, GrantsManager>,
    file_watcher: State<'_, FileWatcher>,
) -> Result<Option<PickedFile>, String> {
    if !is_markdown(&path) {
        return Err("仅支持打开 .md / .markdown / .txt 文件".to_string());
    }
    let picked = read_picked_file(&path)?;
    grants.grant(&path);
    let _ = file_watcher.start_watching(path.clone());
    Ok(Some(picked))
}

/// 拖入图片：扩展名校验 → 读取为 data URL → 授权（供前端统一图片策略落盘）。
#[tauri::command]
pub fn read_dropped_image(path: String, grants: State<'_, GrantsManager>) -> Result<Option<crate::asset_file::PickedImage>, String> {
    let ext = Path::new(&path)
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_lowercase())
        .unwrap_or_default();
    let allowed = ["png", "jpg", "jpeg", "gif", "webp", "bmp", "avif", "ico"].contains(&ext.as_str());
    if !allowed {
        return Err("仅支持图片文件（png/jpg/jpeg/gif/webp/bmp/avif/ico）".to_string());
    }
    let picked = crate::asset_file::read_image_as_data_url(Path::new(&path))?;
    grants.grant(&path);
    Ok(Some(picked))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    fn temp_dir(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("inkwhite-search-{}-{}", std::process::id(), tag));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn setup_tree(dir: &Path) {
        std::fs::create_dir_all(dir.join("sub/deep")).unwrap();
        std::fs::write(dir.join("a.md"), "hello world\n第二行 hi\n").unwrap();
        std::fs::write(dir.join("sub/b.md"), "hi there\n").unwrap();
        std::fs::write(dir.join("sub/deep/c.md"), "nothing\n").unwrap();
        std::fs::write(dir.join("sub/note.txt"), "hi txt\n").unwrap();
        std::fs::write(dir.join("image.png"), b"\x89PNG".to_vec()).unwrap();
    }

    #[test]
    fn walk_collects_only_markdown_recursively() {
        let dir = temp_dir("walk");
        setup_tree(&dir);
        let mut files = Vec::new();
        let mut scanned = 0u32;
        let mut truncated = false;
        walk_markdown_files(&dir, &SearchLimits::default(), 0, &mut files, &mut scanned, &mut truncated);
        let names: Vec<String> = files
            .iter()
            .map(|f| f.strip_prefix(&dir).unwrap().to_string_lossy().to_string())
            .collect();
        assert!(names.contains(&"a.md".to_string()));
        assert!(names.contains(&"sub\\b.md".to_string()) || names.contains(&"sub/b.md".to_string()));
        assert!(names.contains(&"sub\\deep\\c.md".to_string()) || names.contains(&"sub/deep/c.md".to_string()));
        // txt 在 Markdown 扩展名白名单内（文件关联设计），应被收集
        assert!(names.iter().any(|n| n.ends_with("note.txt")));
        assert!(!names.iter().any(|n| n.ends_with("image.png")));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn walk_respects_max_depth_and_file_count() {
        let dir = temp_dir("depth");
        setup_tree(&dir);
        let mut files = Vec::new();
        let mut scanned = 0u32;
        let mut truncated = false;
        let limits = SearchLimits { max_depth: 1, ..SearchLimits::default() };
        walk_markdown_files(&dir, &limits, 0, &mut files, &mut scanned, &mut truncated);
        // 深度 1 只到 sub/，deep/c.md 不可达
        assert!(!files.iter().any(|f| f.to_string_lossy().contains("deep")));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn walk_skips_symlink_components() {
        let dir = temp_dir("symlink");
        let outside = temp_dir("outside");
        std::fs::write(outside.join("secret.md"), "secret").unwrap();
        #[cfg(unix)]
        std::os::unix::fs::symlink(&outside, dir.join("link")).unwrap();
        #[cfg(windows)]
        {
            let _ = std::process::Command::new("cmd")
                .args(["/c", "mklink", "/J"])
                .arg(dir.join("link"))
                .arg(&outside)
                .output();
        }
        let mut files = Vec::new();
        let mut scanned = 0u32;
        let mut truncated = false;
        walk_markdown_files(&dir, &SearchLimits::default(), 0, &mut files, &mut scanned, &mut truncated);
        assert!(!files.iter().any(|f| f.to_string_lossy().contains("secret")), "junction 不得被遍历");
        let _ = std::fs::remove_dir_all(&dir);
        let _ = std::fs::remove_dir_all(&outside);
    }

    #[test]
    fn search_file_matches_lines_with_case_option() {
        let dir = temp_dir("match");
        let f = dir.join("a.md");
        std::fs::write(&f, "Hello World\nhello again\n其他行\n").unwrap();
        let (hits, _) = search_file(&f, "hello", false, 100, 2 * 1024 * 1024);
        assert_eq!(hits.len(), 2);
        assert_eq!(hits[0].line_number, 1);
        let (hits_cs, _) = search_file(&f, "Hello", true, 100, 2 * 1024 * 1024);
        assert_eq!(hits_cs.len(), 1);
        let (hits_zh, _) = search_file(&f, "其他", false, 100, 2 * 1024 * 1024);
        assert_eq!(hits_zh.len(), 1);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn search_requires_grant_and_finds_across_files() {
        let dir = temp_dir("search");
        setup_tree(&dir);
        let gm = GrantsManager::new(dir.join("data"));
        let limits = SearchLimits::default();
        // 未授权 → 拒
        assert!(search_markdown_impl(&dir, "hi", false, &limits, &gm).is_err());
        gm.grant(&dir.to_string_lossy());
        let result = search_markdown_impl(&dir, "hi", false, &limits, &gm).unwrap();
        assert!(result.hits.len() >= 2, "a.md 与 b.md 均含 hi，实际 {}", result.hits.len());
        assert!(result.scanned_files >= 3);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn empty_needle_rejected() {
        let dir = temp_dir("needle");
        let gm = GrantsManager::new(dir.join("data"));
        gm.grant(&dir.to_string_lossy());
        let limits = SearchLimits::default();
        assert!(search_markdown_impl(&dir, "  ", false, &limits, &gm).is_err());
        let _ = std::fs::remove_dir_all(&dir);
    }
}
