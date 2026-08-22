// M3-RUST: 图片资产保存（save_asset_file）与图片文件选择（pick_image）。
//
// S0.2 安全不变量落地:
//   1. 文档路径必须先授权（assert_granted）;
//   2. 文件名白名单（basename、非法字符、Windows 保留设备名、尾部点/空格、超长）;
//   3. 目标目录 = 文档父目录，写入前 canonicalize（防 junction 逃逸）;
//   4. magic-byte 嗅探与扩展名一致才写; SVG/XML 一律拒绝（脚本型 SVG 风险, DG6 决策）;
//   5. 去重（大小写不敏感, Windows 语义）; 目标为目录时报错。
// 本文件不授权新路径（文档目录已授权）。

use std::path::Path;

use base64::{engine::general_purpose, Engine as _};
use serde::Serialize;
use tauri::{AppHandle, State};
use tauri_plugin_dialog::DialogExt;

use crate::commands::PickedFile;
use crate::grants::GrantsManager;

/// 图片扩展名白名单（不含 svg —— DG6 决策：脚本型 SVG 一律拒绝）。
pub(crate) const IMAGE_EXTENSIONS: &[&str] = &["png", "jpg", "jpeg", "gif", "webp", "bmp", "avif", "ico"];

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AssetSaved {
    pub name: String,
    pub path: String,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PickedImage {
    pub path: String,
    pub name: String,
    pub data_url: String,
}

const MAX_NAME_LENGTH: usize = 200;
const WINDOWS_RESERVED: &[&str] = &[
    "CON", "PRN", "AUX", "NUL",
    "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8", "COM9",
    "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
];

/// 文件名校验：通过返回规范化 basename（剥路径前缀取末段）；失败返回错误信息。
pub(crate) fn validate_asset_name(name: &str) -> Result<String, String> {
    let raw = String::from(name);
    if raw.chars().any(|c| c.is_control()) {
        return Err("文件名包含控制字符".to_string());
    }
    if raw.contains("..") {
        return Err("文件名不能包含 \"..\"".to_string());
    }
    let basename = raw.rsplit(['/', '\\']).next().unwrap_or("");
    if basename.is_empty() {
        return Err("文件名不能为空".to_string());
    }
    if basename.chars().count() > MAX_NAME_LENGTH {
        return Err("文件名不能超过 200 个字符".to_string());
    }
    for ch in basename.chars() {
        if "<>:\"|?*".contains(ch) {
            return Err("文件名包含非法字符（< > : \" | ? *）".to_string());
        }
    }
    if basename.ends_with('.') || basename.ends_with(' ') {
        return Err("文件名不能以点（.）或空格结尾".to_string());
    }
    let stem = basename.split('.').next().unwrap_or("").to_uppercase();
    if WINDOWS_RESERVED.contains(&stem.as_str()) {
        return Err("文件名是 Windows 保留设备名".to_string());
    }
    let ext = basename.rsplit_once('.').map(|(_, e)| e.to_lowercase()).unwrap_or_default();
    if !IMAGE_EXTENSIONS.contains(&ext.as_str()) {
        return Err("不支持的图片格式（仅支持 png/jpg/jpeg/gif/webp/bmp/avif/ico）".to_string());
    }
    Ok(basename.to_string())
}

/// 去重：同目录已存在（含目录）时依次尝试 `name-1`、`name-2`……（大小写不敏感）。
pub(crate) fn dedupe_asset_name(entries: &[String], name: &str) -> String {
    let exists = |candidate: &str| entries.iter().any(|e| e.eq_ignore_ascii_case(candidate));
    if !exists(name) {
        return name.to_string();
    }
    let (base, ext) = match name.rsplit_once('.') {
        Some((b, e)) => (b.to_string(), format!(".{}", e)),
        None => (name.to_string(), String::new()),
    };
    let mut index = 1u32;
    loop {
        let candidate = format!("{}-{}{}", base, index, ext);
        if !exists(&candidate) {
            return candidate;
        }
        index += 1;
    }
}

/// magic-byte 嗅探：与扩展名一致的图片签名才通过；SVG/XML（`<` 开头）一律拒绝。
pub(crate) fn sniff_image(ext: &str, bytes: &[u8]) -> Result<(), String> {
    let has = |prefix: &[u8]| bytes.len() >= prefix.len() && &bytes[..prefix.len()] == prefix;
    // 文本型（SVG/XML 或任何 `<` 开头）先拒绝
    let trimmed: Vec<u8> = bytes.iter().copied().skip_while(|b| b.is_ascii_whitespace()).take(8).collect();
    if trimmed.first() == Some(&b'<') {
        return Err("暂不支持 SVG/XML 图片（脚本型 SVG 风险）".to_string());
    }
    let ok = match ext {
        "png" => has(&[0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A]),
        "jpg" | "jpeg" => has(&[0xFF, 0xD8, 0xFF]),
        "gif" => has(b"GIF8"),
        "webp" => bytes.len() >= 12 && &bytes[0..4] == b"RIFF" && &bytes[8..12] == b"WEBP",
        "bmp" => has(b"BM"),
        "avif" => {
            bytes.len() >= 12
                && &bytes[4..8] == b"ftyp"
                && (&bytes[8..12] == b"avif" || &bytes[8..12] == b"avis")
        }
        "ico" => has(&[0x00, 0x00, 0x01, 0x00]),
        _ => false,
    };
    if !ok {
        return Err("图片内容与扩展名不符（magic-byte 校验失败）".to_string());
    }
    Ok(())
}

/// 保存核心逻辑（可单测）：校验 + 去重 + 嗅探 + 落盘。
pub(crate) fn save_asset_file_impl(
    doc_path: &str,
    requested_name: &str,
    base64_payload: &str,
    grants: &GrantsManager,
) -> Result<AssetSaved, String> {
    // 文档路径整体 canonicalize（解析 junction/symlink）+ 断言授权；失败即拒绝。
    // 授权记录是文件路径本身（对话框/关联授予），其父目录为隐式授权目标。
    let canonical_doc = crate::commands::resolve_granted_path(doc_path, grants)?;
    let name = validate_asset_name(requested_name)?;

    let doc_path_obj = Path::new(&canonical_doc);
    let canon_dir = doc_path_obj
        .parent()
        .ok_or_else(|| "无法定位文档目录".to_string())?;

    // P2：附件集中到 `assets/` 子文件夹，避免文档目录被图片污染
    let assets_dir = canon_dir.join("assets");
    let _ = std::fs::create_dir_all(&assets_dir);
    // 若 assets 创建失败则回落到文档目录（兼容旧行为）
    let use_assets = assets_dir.is_dir();
    let target_dir = if use_assets { &assets_dir } else { canon_dir };
    let entries = read_dir_names(target_dir);
    let target_name = dedupe_asset_name(&entries, &name);
    let target = target_dir.join(&target_name);
    if target.is_dir() {
        return Err("目标已存在同名目录".to_string());
    }

    let bytes = general_purpose::STANDARD
        .decode(base64_payload)
        .map_err(|_| "图片数据不是有效的 base64".to_string())?;
    let ext = target_name.rsplit_once('.').map(|(_, e)| e.to_lowercase()).unwrap_or_default();
    sniff_image(&ext, &bytes)?;

    std::fs::write(&target, &bytes).map_err(|e| format!("写入图片失败: {}", e))?;
    // 返回给前端的 name 需包含子文件夹前缀，供 Markdown 引用（assets/a.png）
    let ref_name = if use_assets {
        format!("assets/{}", target_name)
    } else {
        target_name.clone()
    };
    Ok(AssetSaved {
        name: ref_name,
        path: target.to_string_lossy().to_string(),
    })
}

fn read_dir_names(dir: &Path) -> Vec<String> {
    let mut names = Vec::new();
    if let Ok(rd) = std::fs::read_dir(dir) {
        for entry in rd.flatten() {
            names.push(entry.file_name().to_string_lossy().to_string());
        }
    }
    names
}

/// 读取图片文件为 data URL（pick_image 的可测核心）。
pub(crate) fn read_image_as_data_url(path: &Path) -> Result<PickedImage, String> {
    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_lowercase())
        .unwrap_or_default();
    let mime = match ext.as_str() {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "bmp" => "image/bmp",
        "avif" => "image/avif",
        "ico" => "image/x-icon",
        _ => return Err("不支持的图片格式".to_string()),
    };
    let bytes = std::fs::read(path).map_err(|e| format!("读取图片失败: {}", e))?;
    sniff_image(&ext, &bytes)?;
    let name = path
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_default();
    Ok(PickedImage {
        path: path.to_string_lossy().to_string(),
        name,
        data_url: format!("data:{};base64,{}", mime, general_purpose::STANDARD.encode(&bytes)),
    })
}

/// 保存图片资产到当前文档目录。未命名文档（空 doc_path）由前端先弹另存为。
#[tauri::command]
pub fn save_asset_file(
    doc_path: String,
    requested_name: String,
    base64: String,
    grants: State<'_, GrantsManager>,
) -> Result<Option<AssetSaved>, String> {
    if doc_path.trim().is_empty() {
        return Err("请先保存文档，再插入图片".to_string());
    }
    Ok(Some(save_asset_file_impl(&doc_path, &requested_name, &base64, &grants)?))
}

/// 图片文件选择对话框；用户手势授权所选文件。
#[tauri::command]
pub fn pick_image(app: AppHandle, grants: State<'_, GrantsManager>) -> Result<Option<PickedImage>, String> {
    let file_path = app
        .dialog()
        .file()
        .add_filter("图片", IMAGE_EXTENSIONS)
        .blocking_pick_file();

    match file_path {
        Some(fp) => {
            let path = fp.into_path().map_err(|e| e.to_string())?;
            grants.grant(&path.to_string_lossy());
            let picked = read_image_as_data_url(&path)?;
            Ok(Some(picked))
        }
        None => Ok(None),
    }
}

// 与 commands.rs 的 PickedFile 形状保持一致的辅助（对话框返回结构复用其字段名习惯）。
#[allow(dead_code)]
fn _picked_file_shape(_p: &PickedFile) {}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    fn temp_dir(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("inkwhite-asset-{}-{}", std::process::id(), tag));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn png_bytes() -> Vec<u8> {
        vec![0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A, 0x00, 0x01]
    }

    fn grant_doc(grants: &GrantsManager, path: &str) {
        grants.grant(path);
        // CI runner 的 TEMP 可能是 8.3 短名（RUNNER~1）：impl 内部 canonicalize
        // 展开为长名后再断言授权，故长名形式也须授予。
        if let Ok(canon) = std::path::Path::new(path).canonicalize() {
            grants.grant(&crate::commands::strip_verbatim_prefix(&canon.to_string_lossy()));
        }
    }

    #[test]
    fn validate_asset_name_rejects_bad_names() {
        assert!(validate_asset_name("").is_err());
        assert!(validate_asset_name("dir/").is_err());
        assert!(validate_asset_name("a<b.png").is_err());
        assert!(validate_asset_name("a:b.png").is_err());
        assert!(validate_asset_name("a\"b.png").is_err());
        assert!(validate_asset_name("a|b.png").is_err());
        assert!(validate_asset_name("a?b.png").is_err());
        assert!(validate_asset_name("a*b.png").is_err());
        assert!(validate_asset_name("a..png").is_err()); // 含 ..
        assert!(validate_asset_name("..png").is_err());
        assert!(validate_asset_name("name.").is_err());
        assert!(validate_asset_name("name ").is_err());
        assert!(validate_asset_name("CON.png").is_err());
        assert!(validate_asset_name("con.foo.png").is_err());
        assert!(validate_asset_name("COM1.jpg").is_err());
        assert!(validate_asset_name("lpt9.webp").is_err());
        assert!(validate_asset_name("AUX").is_err());
        assert!(validate_asset_name(&("a".repeat(201) + ".png")).is_err());
        assert!(validate_asset_name("photo.svg").is_err());
        assert!(validate_asset_name("photo.txt").is_err());
        assert!(validate_asset_name("photo").is_err());
        assert!(validate_asset_name("photo.png.exe").is_err());
    }

    #[test]
    fn validate_asset_name_accepts_and_normalizes() {
        assert_eq!(validate_asset_name("photo.png").unwrap(), "photo.png");
        assert_eq!(validate_asset_name("dir/photo.png").unwrap(), "photo.png");
        assert_eq!(validate_asset_name("C:\\a\\b\\photo.PNG").unwrap(), "photo.PNG");
        assert_eq!(validate_asset_name("my photo.png").unwrap(), "my photo.png");
        assert_eq!(validate_asset_name("photo(1).png").unwrap(), "photo(1).png");
        assert_eq!(validate_asset_name("photo.v2.jpeg").unwrap(), "photo.v2.jpeg");
    }

    #[test]
    fn dedupe_case_insensitive_with_suffix() {
        let entries = vec!["a.png".to_string(), "a-1.png".to_string(), "B.JPG".to_string()];
        assert_eq!(dedupe_asset_name(&entries, "a.png"), "a-2.png");
        assert_eq!(dedupe_asset_name(&entries, "A.PNG"), "A-2.PNG");
        assert_eq!(dedupe_asset_name(&entries, "b.jpg"), "b-1.jpg");
        assert_eq!(dedupe_asset_name(&entries, "c.png"), "c.png");
    }

    #[test]
    fn sniff_matches_extension_and_rejects_svg_and_mismatch() {
        assert!(sniff_image("png", &png_bytes()).is_ok());
        assert!(sniff_image("jpg", &[0xFF, 0xD8, 0xFF, 0xE0]).is_ok());
        assert!(sniff_image("gif", b"GIF89a").is_ok());
        assert!(sniff_image("webp", b"RIFF\x00\x00\x00\x00WEBPVP8 ").is_ok());
        assert!(sniff_image("bmp", b"BM\x00\x00").is_ok());
        assert!(sniff_image("ico", &[0x00, 0x00, 0x01, 0x00]).is_ok());
        // PNG 内容改名 .jpg → 拒
        assert!(sniff_image("jpg", &png_bytes()).is_err());
        // SVG/XML → 拒
        assert!(sniff_image("png", b"<svg xmlns=...>").is_err());
        assert!(sniff_image("png", b"<?xml version=\"1.0\"?>").is_err());
        // 垃圾字节 → 拒
        assert!(sniff_image("png", b"garbage").is_err());
    }

    #[test]
    fn save_asset_writes_bytes_and_rejects_unauthorized() {
        let dir = temp_dir("save");
        let doc = dir.join("note.md");
        std::fs::write(&doc, "x").unwrap();
        let gm = GrantsManager::new(dir.join("data"));

        // 未授权 → 拒
        assert!(save_asset_file_impl(&doc.to_string_lossy(), "a.png", "", &gm).is_err());

        grant_doc(&gm, &doc.to_string_lossy());
        let b64 = general_purpose::STANDARD.encode(png_bytes());
        let saved = save_asset_file_impl(&doc.to_string_lossy(), "a.png", &b64, &gm).unwrap();
        assert!(saved.name.ends_with("a.png"), "expected assets/a.png, got {}", saved.name);
        assert!(saved.path.ends_with("a.png"), "path should end with a.png");
        let on_disk = std::fs::read(&saved.path).unwrap();
        assert_eq!(on_disk, png_bytes());

        // 去重（保留输入大小写，-1 后缀）
        let b64_again = general_purpose::STANDARD.encode(png_bytes());
        let second = save_asset_file_impl(&doc.to_string_lossy(), "A.PNG", &b64_again, &gm).unwrap();
        assert!(second.name.ends_with("A-1.PNG"), "expected assets/A-1.PNG, got {}", second.name);

        // 坏 base64 → 拒
        assert!(save_asset_file_impl(&doc.to_string_lossy(), "b.png", "!!!", &gm).is_err());
        // SVG 内容 → 拒且不落盘
        let svg_b64 = general_purpose::STANDARD.encode(b"<svg></svg>");
        assert!(save_asset_file_impl(&doc.to_string_lossy(), "c.png", &svg_b64, &gm).is_err());

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn read_image_returns_data_url_and_rejects_mismatch() {
        let dir = temp_dir("pick");
        let img = dir.join("pic.png");
        std::fs::write(&img, png_bytes()).unwrap();
        let picked = read_image_as_data_url(&img).unwrap();
        assert_eq!(picked.name, "pic.png");
        assert!(picked.data_url.starts_with("data:image/png;base64,"));

        let fake = dir.join("fake.jpg");
        std::fs::write(&fake, png_bytes()).unwrap();
        assert!(read_image_as_data_url(&fake).is_err());
        let _ = std::fs::remove_dir_all(&dir);
    }
}