// WP6（S0.2 收尾）单测：
//   B: PendingOpen 队列（多文件打开不再互相覆盖丢弃）
//   C: 结构化读取错误（不存在 / 权限拒绝 / 非 UTF-8 编码 三类可区分）
//   D: devtools/reload 菜单项的 release 门控语义
// 与被测逻辑同 crate 分文件（保持 commands.rs / lib.rs 在 800 行内），
// 仅 #[cfg(test)] 编译，不影响运行时产物。

use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;

use crate::commands::{
    classify_io_error, consume_next_pending, read_granted_file, strip_verbatim_prefix, PickedFile,
};
use crate::grants::GrantsManager;
use crate::{devtools_menu_enabled, PendingOpen, RendererReady};

fn picked(path: &str) -> PickedFile {
    PickedFile {
        path: path.to_string(),
        name: path.to_string(),
        content: String::new(),
        last_modified: 0,
    }
}

/// 构造一个带唯一后缀的临时目录，测试后清理。
fn temp_dir(tag: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!(
        "inkwhite-wp6-{}-{}",
        std::process::id(),
        tag
    ));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    dir
}

/// 同时授权原始与 canonical（去 \\?\ 前缀）形式（与 security_tests 一致，
/// 避免临时目录位于 junction/symlink 之下时误拒）。
fn grant_both(gm: &GrantsManager, path: &std::path::Path) {
    gm.grant(&path.to_string_lossy());
    gm.grant(&strip_verbatim_prefix(&path.canonicalize().unwrap().to_string_lossy()));
}

// ===== B: PendingOpen 队列（FIFO 逐个消费）=====

#[test]
fn pending_open_queue_consumes_fifo_one_by_one() {
    let pending = PendingOpen(Mutex::new(vec![picked("1.md"), picked("2.md"), picked("3.md")]));
    let ready = RendererReady(AtomicBool::new(false));
    assert_eq!(consume_next_pending(&pending, &ready).unwrap().path, "1.md");
    assert_eq!(consume_next_pending(&pending, &ready).unwrap().path, "2.md");
    assert_eq!(consume_next_pending(&pending, &ready).unwrap().path, "3.md");
    assert!(consume_next_pending(&pending, &ready).is_none(), "空队列返回 None");
    assert!(consume_next_pending(&pending, &ready).is_none(), "持续空队列返回 None");
}

#[test]
fn pending_open_empty_queue_still_marks_renderer_ready() {
    let pending = PendingOpen(Mutex::new(Vec::new()));
    let ready = RendererReady(AtomicBool::new(false));
    assert!(consume_next_pending(&pending, &ready).is_none());
    assert!(ready.0.load(Ordering::Relaxed), "空队列也标记前端就绪");
}

#[test]
fn pending_open_ready_flag_does_not_block_queue() {
    let pending = PendingOpen(Mutex::new(vec![picked("a.md"), picked("b.md")]));
    let ready = RendererReady(AtomicBool::new(false));
    assert_eq!(consume_next_pending(&pending, &ready).unwrap().path, "a.md");
    assert!(ready.0.load(Ordering::Relaxed), "首次消费即标记就绪");
    assert_eq!(
        consume_next_pending(&pending, &ready).unwrap().path,
        "b.md",
        "就绪标记与队列互不影响：队列仍可继续消费"
    );
    assert!(consume_next_pending(&pending, &ready).is_none());
}

// ===== C: 结构化读取错误 =====

#[test]
fn classify_io_error_distinguishes_three_kinds() {
    let missing = classify_io_error(
        "x.md",
        &std::io::Error::new(std::io::ErrorKind::NotFound, "boom"),
        "读取",
    );
    assert!(missing.contains("不存在"), "不存在类错误信息: {missing}");
    let denied = classify_io_error(
        "x.md",
        &std::io::Error::new(std::io::ErrorKind::PermissionDenied, "boom"),
        "读取",
    );
    assert!(denied.contains("没有权限"), "权限类错误信息: {denied}");
    let encoding = classify_io_error(
        "x.md",
        &std::io::Error::new(
            std::io::ErrorKind::InvalidData,
            "stream did not contain valid UTF-8",
        ),
        "读取",
    );
    assert!(encoding.contains("UTF-8"), "编码类错误信息: {encoding}");
    // 三类消息互不相同（前端可据此区分原因）
    assert_ne!(missing, denied);
    assert_ne!(denied, encoding);
    assert_ne!(missing, encoding);
}

#[test]
fn read_file_classifies_missing_path() {
    let dir = temp_dir("missing");
    let gm = GrantsManager::new(dir.join("data"));
    let missing = dir.join("nope.md").to_string_lossy().to_string();
    let err = read_granted_file(&missing, &gm)
        .err()
        .expect("不存在的路径应返回 Err（带原因）");
    assert!(err.contains("不存在"), "实际错误信息: {err}");
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn read_file_classifies_invalid_utf8() {
    let dir = temp_dir("utf8");
    let gm = GrantsManager::new(dir.join("data"));
    let file = dir.join("bad.md");
    // 非法 UTF-8 字节序列
    std::fs::write(&file, [0xFFu8, 0xFE, 0x41, 0x00, 0xFF]).unwrap();
    grant_both(&gm, &file);
    let file_str = file.to_string_lossy().to_string();
    let err = read_granted_file(&file_str, &gm)
        .err()
        .expect("非法 UTF-8 文件应返回 Err（带原因）");
    assert!(err.contains("UTF-8"), "实际错误信息: {err}");
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn read_file_classifies_directory_as_not_file() {
    let dir = temp_dir("isdir");
    let gm = GrantsManager::new(dir.join("data"));
    grant_both(&gm, &dir);
    let dir_str = dir.to_string_lossy().to_string();
    let err = read_granted_file(&dir_str, &gm)
        .err()
        .expect("目录当文件读取应返回 Err（带原因）");
    assert!(err.contains("目录"), "实际错误信息: {err}");
    let _ = std::fs::remove_dir_all(&dir);
}

// ===== D: devtools/reload 菜单 release 门控 =====

#[test]
fn devtools_menu_enabled_reflects_debug_release_semantics() {
    // debug/test 构建（cfg!(debug_assertions)=true 的调用点语义）：启用
    assert!(devtools_menu_enabled(true), "debug 构建应启用调试菜单");
    // release 构建（cfg!(debug_assertions)=false 的调用点语义）：不创建不转发
    assert!(!devtools_menu_enabled(false), "release 构建应禁用调试菜单");
}
