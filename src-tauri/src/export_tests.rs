// save_export_file 纯逻辑单测（M2-RUST）。
// 覆盖：白名单判定（含 .exe/.md 拒绝、无扩展名拒绝）、补齐、大小写、
// base64 解码、文本/二进制互斥、落盘与 SavedFile 构造。
// 对话框交互（取消返回 Ok(None)）依赖原生对话框，不可单测——确认路径的
// 其余逻辑（校验→写入→SavedFile）由 finish_export_save 承接并在此覆盖。

use std::path::PathBuf;

use base64::{engine::general_purpose, Engine as _};

use super::*;

/// 构造带唯一后缀的临时目录，测试后清理。
fn temp_dir(tag: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("inkwhite-export-{}-{}", std::process::id(), tag));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    dir
}

// ===== resolve_export_filename：白名单判定 =====

#[test]
fn resolve_export_filename_accepts_all_whitelisted_extensions() {
    for name in ["report.html", "report.htm", "report.pdf", "report.docx"] {
        assert_eq!(
            resolve_export_filename(name),
            Ok(name.to_string()),
            "{} 应在白名单内",
            name
        );
    }
}

#[test]
fn resolve_export_filename_rejects_non_whitelisted_extensions() {
    for name in ["virus.exe", "notes.md", "notes.markdown", "data.txt", "pic.png"] {
        assert!(resolve_export_filename(name).is_err(), "{} 应被拒绝", name);
    }
}

#[test]
fn resolve_export_filename_rejects_missing_extension() {
    // 决策记录：无扩展名=不允许，须在保存对话框中显式提供扩展名——
    // 不按默认补全，避免把用户意图（如想要 .pdf）猜成默认格式。
    for name in ["report", "2026-08-13 导出", ".bashrc", ""] {
        assert!(resolve_export_filename(name).is_err(), "{:?} 应被拒绝", name);
    }
}

#[test]
fn resolve_export_filename_accepts_uppercase_extension() {
    // 大小写不敏感（Windows 文件系统本身大小写不敏感）
    assert_eq!(
        resolve_export_filename("Report.HTML"),
        Ok("Report.HTML".to_string())
    );
    assert_eq!(
        resolve_export_filename("REPORT.PDF"),
        Ok("REPORT.PDF".to_string())
    );
    assert_eq!(
        resolve_export_filename("导出.Docx"),
        Ok("导出.Docx".to_string())
    );
}

#[test]
fn resolve_export_filename_rejects_double_extension() {
    // 复合扩展名按最后一段判定：report.html.exe 仍是 .exe → 拒绝
    assert!(resolve_export_filename("report.html.exe").is_err());
}

// ===== complete_export_name：补齐 =====

#[test]
fn complete_export_name_fills_missing_extension_with_html() {
    // 补齐语义：建议名缺扩展名时按白名单补回默认 .html（HTML 为导出主格式）
    assert_eq!(complete_export_name("report"), Ok("report.html".to_string()));
    assert_eq!(complete_export_name(" 报告 "), Ok("报告.html".to_string()));
    assert_eq!(complete_export_name(""), Ok("export.html".to_string()));
}

#[test]
fn complete_export_name_keeps_whitelisted_and_rejects_others() {
    assert_eq!(complete_export_name("report.pdf"), Ok("report.pdf".to_string()));
    assert!(complete_export_name("report.exe").is_err());
}

// ===== dialog_default_name：二进制须显式扩展名 =====

#[test]
fn dialog_default_name_binary_requires_explicit_extension() {
    let binary = ExportPayload::Binary(vec![1, 2, 3]);
    let text = ExportPayload::Text("x".to_string());
    // 二进制（pdf/docx 无法从载荷猜格式）：缺扩展名 → 不允许
    assert!(dialog_default_name("report", &binary).is_err());
    assert_eq!(
        dialog_default_name("report.pdf", &binary),
        Ok("report.pdf".to_string())
    );
    // 文本：缺扩展名补齐 .html
    assert_eq!(
        dialog_default_name("report", &text),
        Ok("report.html".to_string())
    );
}

// ===== decode_export_payload：互斥与 base64 =====

#[test]
fn decode_export_payload_text_mode() {
    match decode_export_payload("<h1>你好</h1>", None).unwrap() {
        ExportPayload::Text(t) => assert_eq!(t, "<h1>你好</h1>"),
        ExportPayload::Binary(_) => panic!("应解析为文本"),
    }
}

#[test]
fn decode_export_payload_binary_mode_decodes_base64() {
    match decode_export_payload("", Some("aGVsbG8gd29ybGQ=")).unwrap() {
        ExportPayload::Binary(bytes) => assert_eq!(bytes, b"hello world"),
        ExportPayload::Text(_) => panic!("应解析为二进制"),
    }
    // 显式提供的空 base64 允许（0 字节二进制文件）
    match decode_export_payload("", Some("")).unwrap() {
        ExportPayload::Binary(bytes) => assert!(bytes.is_empty()),
        ExportPayload::Text(_) => panic!("应解析为二进制"),
    }
}

#[test]
fn decode_export_payload_rejects_text_and_binary_together() {
    let err = decode_export_payload("text", Some("aGk=")).unwrap_err();
    assert!(err.contains("冲突"), "错误信息应说明互斥: {}", err);
}

#[test]
fn decode_export_payload_rejects_nothing_provided() {
    assert!(decode_export_payload("", None).is_err());
}

#[test]
fn decode_export_payload_rejects_invalid_base64() {
    let err = decode_export_payload("", Some("!!!not-base64!!!")).unwrap_err();
    assert!(err.contains("base64"), "错误信息应指向 base64: {}", err);
}

// ===== finish_export_save：校验 → 落盘 → SavedFile =====

#[test]
fn finish_export_save_persists_text_and_binary() {
    let dir = temp_dir("write");
    let text_path = dir.join("out.html");
    let bin_path = dir.join("out.docx");

    let t = finish_export_save(&text_path, &ExportPayload::Text("<p>hi</p>".to_string())).unwrap();
    let b = finish_export_save(
        &bin_path,
        &ExportPayload::Binary(vec![0x50, 0x4B, 0x03, 0x04]),
    )
    .unwrap();
    assert!(t.last_modified > 0 && b.last_modified > 0, "修改时间应为非零毫秒戳");

    assert_eq!(std::fs::read_to_string(&text_path).unwrap(), "<p>hi</p>");
    assert_eq!(std::fs::read(&bin_path).unwrap(), vec![0x50, 0x4B, 0x03, 0x04]);

    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn finish_export_save_builds_saved_file_and_rejects_bad_names() {
    let dir = temp_dir("finish");
    let ok_path = dir.join("导出.html");

    let saved = finish_export_save(&ok_path, &ExportPayload::Text("hi".to_string())).unwrap();
    assert_eq!(saved.name, "导出.html");
    assert_eq!(saved.path, ok_path.to_string_lossy().as_ref());
    assert!(saved.last_modified > 0);
    assert_eq!(std::fs::read_to_string(&ok_path).unwrap(), "hi");

    // 白名单外 / 无扩展名的最终名：拒绝且不落盘
    let exe_path = dir.join("evil.exe");
    assert!(finish_export_save(&exe_path, &ExportPayload::Text("x".to_string())).is_err());
    assert!(!exe_path.exists(), "校验失败不应落盘");
    let noext_path = dir.join("noext");
    assert!(finish_export_save(&noext_path, &ExportPayload::Text("x".to_string())).is_err());

    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn decode_binary_payload_roundtrip_matches_encoded_bytes() {
    // 真实 base64 编码的 docx 头字节（PK\x03\x04）解码后应与原字节一致
    let raw = vec![0x50u8, 0x4B, 0x03, 0x04, 0x14, 0x00, 0x06, 0x00];
    let b64 = general_purpose::STANDARD.encode(&raw);
    match decode_export_payload("", Some(&b64)).unwrap() {
        ExportPayload::Binary(bytes) => assert_eq!(bytes, raw),
        ExportPayload::Text(_) => panic!("应解析为二进制"),
    }
}
