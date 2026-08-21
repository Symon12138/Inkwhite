// 本地图片资产读取（P2 拆分自 commands.rs，控制其行数在 ≤800 门禁内）。
// 职责：相对路径 → data URL（read_asset）与绝对路径解析（get_asset_path，
// 供前端 convertFileSrc 走 asset 协议）。安全不变量与 commands 一致：
// 授权断言 + percent 解码 + canonicalize 穿越防护 + 扩展名白名单。

use std::path::{Path, PathBuf};

use base64::{engine::general_purpose, Engine as _};
use serde::Serialize;
use tauri::State;

use crate::grants::GrantsManager;


/// 本地图片资产的 data URL。
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AssetData {
    pub data_url: String,
}



/// 百分号解码（对应 Electron 版 decodeURIComponent）。
fn percent_decode(input: &str) -> String {
    let bytes = input.as_bytes();
    let mut result = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            if let (Some(h), Some(l)) = (hex_digit(bytes[i + 1]), hex_digit(bytes[i + 2])) {
                result.push(h * 16 + l);
                i += 3;
                continue;
            }
        }
        result.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&result).to_string()
}

/// 十六进制字符转数值。
fn hex_digit(byte: u8) -> Option<u8> {
    match byte {
        b'0'..=b'9' => Some(byte - b'0'),
        b'a'..=b'f' => Some(byte - b'a' + 10),
        b'A'..=b'F' => Some(byte - b'A' + 10),
        _ => None,
    }
}



/// 图片 MIME 类型映射（对应 Electron 版 localAssets.js 的 IMAGE_MIME）。
fn image_mime(ext: &str) -> Option<&'static str> {
    match ext {
        "png" => Some("image/png"),
        "jpg" | "jpeg" => Some("image/jpeg"),
        "gif" => Some("image/gif"),
        "webp" => Some("image/webp"),
        "svg" => Some("image/svg+xml"),
        "avif" => Some("image/avif"),
        "bmp" => Some("image/bmp"),
        "ico" => Some("image/x-icon"),
        _ => None,
    }
}

/// 读取本地图片资产，返回 data URL。
/// 对应 Electron 版 localAssets.js 的 readLocalAsset。
fn read_local_asset(doc_path: &str, src: &str) -> Option<AssetData> {
    if doc_path.is_empty() || src.is_empty() {
        return None;
    }

    let relative = percent_decode(src);
    let doc_dir = Path::new(doc_path).parent().unwrap_or(Path::new("."));
    let target: PathBuf = doc_dir.join(&relative);

    // 路径穿越防护：canonicalize 解析符号链接并归一化路径（失败即视为不可读），
    // 再确认解析后的目标仍位于文档目录内，`../` 等逃逸写法一律拒绝。
    let canon_doc_dir = doc_dir.canonicalize().ok()?;
    let canon_target = target.canonicalize().ok()?;
    if !canon_target.starts_with(&canon_doc_dir) {
        return None;
    }

    let ext = canon_target
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_lowercase())
        .unwrap_or_default();

    let mime = image_mime(&ext)?;

    match std::fs::read(&canon_target) {
        Ok(bytes) => {
            let b64 = general_purpose::STANDARD.encode(&bytes);
            Some(AssetData {
                data_url: format!("data:{};base64,{}", mime, b64),
            })
        }
        Err(_) => None,
    }
}



/// 读取本地图片资产，返回 data URL。
/// 对应 Electron 版 desktop:read-asset。
#[tauri::command]
pub fn read_asset(
    doc_path: String,
    src: String,
    grants: State<'_, GrantsManager>,
) -> Result<Option<AssetData>, String> {
    grants.assert_granted(&doc_path)?;
    Ok(read_local_asset(&doc_path, &src))
}


/// 解析本地图片资产的绝对路径（供前端 convertFileSrc 使用，性能优于 data URL）。
/// 校验与 read_local_asset 一致（路径穿越防护 + 扩展名白名单），只返回路径，不读文件内容。
pub(crate) fn resolve_asset_path(doc_path: &str, src: &str) -> Option<String> {
    if doc_path.is_empty() || src.is_empty() {
        return None;
    }
    let relative = percent_decode(src);
    let doc_dir = Path::new(doc_path).parent().unwrap_or(Path::new("."));
    let target = doc_dir.join(&relative);
    let canon_doc_dir = doc_dir.canonicalize().ok()?;
    let canon_target = target.canonicalize().ok()?;
    if !canon_target.starts_with(&canon_doc_dir) {
        return None;
    }
    let ext = canon_target
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_lowercase())
        .unwrap_or_default();
    image_mime(&ext)?;
    Some(canon_target.to_string_lossy().to_string())
}

#[tauri::command]
pub fn get_asset_path(
    doc_path: String,
    src: String,
    grants: State<'_, GrantsManager>,
) -> Result<Option<String>, String> {
    grants.assert_granted(&doc_path)?;
    Ok(resolve_asset_path(&doc_path, &src))
}


#[cfg(test)]
mod tests {
    use super::*;

    /// 构造一个带唯一后缀的临时目录，测试后清理。
    fn temp_dir(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "inkwhite-read-asset-{}-{}",
            std::process::id(),
            tag
        ));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(dir.join("doc")).unwrap();
        dir
    }

    /// 最小合法 PNG 头（read_local_asset 只按扩展名判 MIME，内容无需完整）。
    fn write_png(path: &Path) {
        std::fs::write(path, [0x89u8, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A]).unwrap();
    }

    #[test]
    fn read_local_asset_accepts_relative_path_inside_doc_dir() {
        let dir = temp_dir("ok");
        let doc_dir = dir.join("doc");
        write_png(&doc_dir.join("pic.png"));
        let doc_path = doc_dir.join("note.md").to_string_lossy().to_string();

        let asset = read_local_asset(&doc_path, "pic.png");
        assert!(asset.is_some(), "目录内正常相对路径应可读取");
        assert!(asset.unwrap().data_url.starts_with("data:image/png;base64,"));

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn read_local_asset_rejects_path_traversal() {
        let dir = temp_dir("traversal");
        let doc_dir = dir.join("doc");
        write_png(&doc_dir.join("pic.png"));
        write_png(&dir.join("secret.png"));
        let doc_path = doc_dir.join("note.md").to_string_lossy().to_string();

        // `../` 逃逸出文档目录
        assert!(read_local_asset(&doc_path, "../secret.png").is_none());
        // 百分号编码的 `../` 同样被拒
        assert!(read_local_asset(&doc_path, "%2e%2e/secret.png").is_none());
        // 深层逃逸
        assert!(read_local_asset(&doc_path, "../../secret.png").is_none());
        // 目录内正常路径仍然可用
        assert!(read_local_asset(&doc_path, "pic.png").is_some());

        let _ = std::fs::remove_dir_all(&dir);
    }

    // ===== 红队对抗用例（红队审查补充）=====

    /// 反斜杠编码的 `..\` 逃逸：percent_decode 会把 %5c 还原成 `\`，必须同样被拒。
    #[test]
    fn read_local_asset_rejects_backslash_encoded_traversal() {
        let dir = temp_dir("backslash");
        let doc_dir = dir.join("doc");
        write_png(&doc_dir.join("pic.png"));
        write_png(&dir.join("secret.png"));
        let doc_path = doc_dir.join("note.md").to_string_lossy().to_string();

        assert!(read_local_asset(&doc_path, "%2e%2e%5csecret.png").is_none());
        assert!(read_local_asset(&doc_path, "%2e%2e%5c%2e%2e%5csecret.png").is_none());
        assert!(read_local_asset(&doc_path, "..%5csecret.png").is_none());
        assert!(read_local_asset(&doc_path, "pic.png").is_some());

        let _ = std::fs::remove_dir_all(&dir);
    }

    /// 双重编码 %252e%252e：percent_decode 只解码一层，应视为字面文件名（不存在）而拒绝。
    #[test]
    fn read_local_asset_rejects_double_encoded_traversal() {
        let dir = temp_dir("double");
        let doc_dir = dir.join("doc");
        write_png(&doc_dir.join("pic.png"));
        write_png(&dir.join("secret.png"));
        let doc_path = doc_dir.join("note.md").to_string_lossy().to_string();

        assert!(read_local_asset(&doc_path, "%252e%252e/secret.png").is_none());
        assert!(read_local_asset(&doc_path, "%252e%252e%255csecret.png").is_none());
        assert!(read_local_asset(&doc_path, "pic.png").is_some());

        let _ = std::fs::remove_dir_all(&dir);
    }

    /// 绝对路径 src：join 时直接替换目标，canonicalize 后 starts_with 必须拒绝。
    #[test]
    fn read_local_asset_rejects_absolute_src_outside_doc_dir() {
        let dir = temp_dir("absolute");
        let doc_dir = dir.join("doc");
        write_png(&doc_dir.join("pic.png"));
        write_png(&dir.join("secret.png"));
        let doc_path = doc_dir.join("note.md").to_string_lossy().to_string();
        let abs_secret = dir.join("secret.png").to_string_lossy().to_string();

        assert!(read_local_asset(&doc_path, &abs_secret).is_none());
        assert!(read_local_asset(&doc_path, "pic.png").is_some());

        let _ = std::fs::remove_dir_all(&dir);
    }

    /// doc_path 自身含 `..`：授权检查会先 normalize，read_local_asset 必须仍然把目标
    /// 限定在归一化后的文档目录内（不能因 doc_path 含 `..` 而扩大读取范围）。
    #[test]
    fn read_local_asset_doc_path_with_dotdot_stays_confined() {
        let dir = temp_dir("docdotdot");
        let doc_dir = dir.join("doc");
        write_png(&doc_dir.join("pic.png"));
        write_png(&dir.join("secret.png"));
        // doc_path 写成 doc/../doc/note.md —— 归一化后仍是 doc 目录
        let doc_path = doc_dir
            .join("..")
            .join("doc")
            .join("note.md")
            .to_string_lossy()
            .to_string();

        // 目录内正常读取
        assert!(read_local_asset(&doc_path, "pic.png").is_some());
        // 逃逸仍被拒
        assert!(read_local_asset(&doc_path, "../secret.png").is_none());

        let _ = std::fs::remove_dir_all(&dir);
    }

    /// starts_with 组件级比较边界：`safe` 目录不能通过 `safe-evil` 前缀逃逸。
    #[test]
    fn read_local_asset_rejects_sibling_prefix_dir_escape() {
        let dir = temp_dir("sibling");
        let safe = dir.join("safe");
        let safe_evil = dir.join("safe-evil");
        std::fs::create_dir_all(&safe).unwrap();
        std::fs::create_dir_all(&safe_evil).unwrap();
        write_png(&safe.join("pic.png"));
        write_png(&safe_evil.join("evil.png"));
        let doc_path = safe.join("note.md").to_string_lossy().to_string();

        // 试图从 safe 逃逸到 safe-evil（前缀相似但组件不同）
        assert!(read_local_asset(&doc_path, "../safe-evil/evil.png").is_none());
        assert!(read_local_asset(&doc_path, "pic.png").is_some());

        let _ = std::fs::remove_dir_all(&dir);
    }

    /// Windows 符号链接/junction 逃逸：canonicalize 应解析链接，逃逸目标必须被拒。
    #[cfg(windows)]
    #[test]
    fn read_local_asset_rejects_junction_escape_outside_doc_dir() {
        let dir = temp_dir("junction");
        let doc_dir = dir.join("doc");
        let outside = dir.join("outside");
        std::fs::create_dir_all(&outside).unwrap();
        write_png(&outside.join("secret.png"));

        // 尝试创建 junction：doc/link -> outside（mklink /J 无需管理员）
        let link = doc_dir.join("link");
        let created = std::process::Command::new("cmd")
            .args(["/c", "mklink", "/J"])
            .arg(&link)
            .arg(&outside)
            .output();
        let ok = created.map(|o| o.status.success()).unwrap_or(false);
        if !ok {
            // 无权限创建 junction 时跳过（记录为不可验证）
            eprintln!("SKIP: junction creation failed (no privilege?)");
            let _ = std::fs::remove_dir_all(&dir);
            return;
        }

        let doc_path = doc_dir.join("note.md").to_string_lossy().to_string();
        // 经由 junction 读取目录外的图片：必须拒绝
        assert!(read_local_asset(&doc_path, "link/secret.png").is_none());
        // 目录内正常读取不受影响
        write_png(&doc_dir.join("pic.png"));
        assert!(read_local_asset(&doc_path, "pic.png").is_some());

        let _ = std::fs::remove_dir_all(&dir);
    }

    /// 授权模型放大风险记录：list_directory 对任意路径自动 grant + is_granted 的祖先
    /// 匹配，使一次 `list_directory("C:\\")` 即可把整个盘符纳入授权。这是设计行为，
    /// 但构成 XSS 成功后的最大危害半径（任意读 + 任意写）。此测试用于固定该行为，
    /// 防止未来"收紧"时误伤，也作为红队证据。
    #[cfg(windows)]
    #[test]
    fn grant_root_directory_authorizes_arbitrary_descendant() {
        use crate::grants::GrantsManager;
        let dir = temp_dir("grant");
        // 模拟 list_directory 的自动授权：grant 一个根/高层目录
        let gm = GrantsManager::new(dir.clone());
        gm.grant("C:\\");
        // 盘符下的任意文件都被视为已授权（祖先匹配）
        assert!(gm.is_granted("C:\\Windows\\System32\\drivers\\etc\\hosts"));
        assert!(gm.is_granted("C:\\Users\\someone\\Documents\\secret.txt"));
        // 未授权的其他盘符仍被拒（fail-closed 的边界）
        assert!(!gm.is_granted("D:\\some\\file.txt"));
        let _ = std::fs::remove_dir_all(&dir);
    }
}
