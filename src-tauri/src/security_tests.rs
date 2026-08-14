// S0.2 授权即校验（WP3 路径安全收紧）的红队单测。
// 与被测命令核心逻辑（commands.rs 中的 read_granted_file 等）同 crate 分文件，
// 保持 commands.rs 在 800 行以内。仅 #[cfg(test)] 编译，不影响运行时产物。

use std::path::{Path, PathBuf};

use crate::commands::{
    list_directory_entries, read_granted_file, resolve_granted_path, resolve_watch_target,
    stat_granted_file, strip_verbatim_prefix, write_granted_file,
};
use crate::grants::GrantsManager;

/// 构造一个带唯一后缀的临时目录，测试后清理。
fn temp_dir(tag: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!(
        "inkwhite-read-asset-{}-{}",
        std::process::id(),
        tag
    ));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    dir
}

/// 创建 junction/目录符号链接（Windows）。优先 symlink_dir（符号链接），
/// 失败回退 cmd mklink /J（junction，无需管理员）；都失败返回 false（调用方跳过）。
#[cfg(windows)]
fn try_create_junction(link: &Path, target: &Path) -> bool {
    use std::os::windows::fs::symlink_dir;
    if symlink_dir(target, link).is_ok() {
        return true;
    }
    std::process::Command::new("cmd")
        .args(["/c", "mklink", "/J"])
        .arg(link)
        .arg(target)
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}

/// 已授权目录内的 junction 指向目录外：read/write/stat/watch/unwatch 一律拒绝。
/// 逃逸路径词法上位于授权目录内，canonicalize 解析到目录外，必须被拒；
/// 授权目录内正常文件不受影响。junction 创建失败时跳过（记录为不可验证）。
#[cfg(windows)]
#[test]
fn junction_escape_is_rejected_for_all_path_commands() {
    let dir = temp_dir("junction-cmds");
    let granted = dir.join("granted");
    let outside = dir.join("outside");
    std::fs::create_dir_all(&granted).unwrap();
    std::fs::create_dir_all(&outside).unwrap();
    std::fs::write(outside.join("secret.md"), "top secret").unwrap();

    let link = granted.join("link");
    if !try_create_junction(&link, &outside) {
        eprintln!("SKIP: junction creation failed (no privilege?)");
        let _ = std::fs::remove_dir_all(&dir);
        return;
    }

    let gm = GrantsManager::new(dir.join("data"));
    // 同时授权原始与 canonical（去 \\?\ 前缀）形式：若临时目录本身位于
    // junction/symlink 之下，两种形式都能命中；目录外的目标两种形式都覆盖不到。
    gm.grant(&granted.to_string_lossy().to_string());
    gm.grant(&strip_verbatim_prefix(&granted.canonicalize().unwrap().to_string_lossy()));

    let secret = link.join("secret.md").to_string_lossy().to_string();
    assert!(read_granted_file(&secret, &gm).is_err(), "read_file 必须拒绝 junction 逃逸");
    assert!(write_granted_file(&secret, "x", &gm).is_err(), "write_file 必须拒绝 junction 逃逸");
    assert!(stat_granted_file(&secret, &gm).is_err(), "stat_file 必须拒绝 junction 逃逸");
    assert!(resolve_watch_target(&secret, &gm).is_err(), "watch_file 必须拒绝 junction 逃逸");
    assert!(resolve_granted_path(&secret, &gm).is_err(), "unwatch_file 必须拒绝 junction 逃逸");

    // 目录外的目标文件未被触碰
    assert_eq!(
        std::fs::read_to_string(outside.join("secret.md")).unwrap(),
        "top secret",
        "逃逸写入不得发生"
    );

    // 授权目录内正常文件不受影响
    let inside = granted.join("ok.md");
    std::fs::write(&inside, "ok").unwrap();
    let inside_str = inside.to_string_lossy().to_string();
    assert!(read_granted_file(&inside_str, &gm).is_ok(), "目录内读取不应被误拒");
    assert!(write_granted_file(&inside_str, "ok2", &gm).is_ok(), "目录内写入不应被误拒");
    assert!(stat_granted_file(&inside_str, &gm).is_ok(), "目录内 stat 不应被误拒");
    assert!(resolve_watch_target(&inside_str, &gm).is_ok(), "目录内 watch 不应被误拒");

    let _ = std::fs::remove_dir_all(&dir);
}

/// 非 Windows 平台的符号链接逃逸：同一 canonicalize 防线，同样必须拒绝。
#[cfg(unix)]
#[test]
fn symlink_escape_is_rejected_for_all_path_commands() {
    let dir = temp_dir("symlink-cmds");
    let granted = dir.join("granted");
    let outside = dir.join("outside");
    std::fs::create_dir_all(&granted).unwrap();
    std::fs::create_dir_all(&outside).unwrap();
    std::fs::write(outside.join("secret.md"), "top secret").unwrap();

    let link = granted.join("link");
    std::os::unix::fs::symlink(&outside, &link).unwrap();

    // 授权 canonical 路径（macOS /var→/private/var 之类符号链接环境下保持一致）
    let gm = GrantsManager::new(dir.join("data"));
    gm.grant(&granted.canonicalize().unwrap().to_string_lossy().to_string());

    let secret = link.join("secret.md").to_string_lossy().to_string();
    assert!(read_granted_file(&secret, &gm).is_err());
    assert!(write_granted_file(&secret, "x", &gm).is_err());
    assert!(stat_granted_file(&secret, &gm).is_err());
    assert!(resolve_watch_target(&secret, &gm).is_err());
    assert!(resolve_granted_path(&secret, &gm).is_err());
    assert_eq!(
        std::fs::read_to_string(outside.join("secret.md")).unwrap(),
        "top secret"
    );

    let inside = granted.join("ok.md");
    std::fs::write(&inside, "ok").unwrap();
    let inside_str = inside.to_string_lossy().to_string();
    assert!(read_granted_file(&inside_str, &gm).is_ok());
    assert!(write_granted_file(&inside_str, "ok2", &gm).is_ok());
    assert!(stat_granted_file(&inside_str, &gm).is_ok());
    assert!(resolve_watch_target(&inside_str, &gm).is_ok());

    let _ = std::fs::remove_dir_all(&dir);
}

/// 授权只来自用户手势：list_directory 不再自动授权。未授权路径必须报错；
/// 已授权目录正常枚举；子目录经祖先匹配可枚举；目录之外仍被拒。
#[test]
fn list_directory_requires_grant_and_enumerates_granted_subdirs() {
    let dir = temp_dir("listdir");
    std::fs::create_dir_all(dir.join("sub")).unwrap();
    std::fs::write(dir.join("a.md"), "a").unwrap();

    let gm = GrantsManager::new(dir.join("data"));

    // 未授权：必须报错（收紧前 list_directory 会自动授权，此处固定新行为）
    let dir_str = dir.to_string_lossy().to_string();
    assert!(list_directory_entries(&dir_str, &gm).is_err(), "未授权目录必须拒绝枚举");

    // 授权后：正常枚举
    gm.grant(&dir_str);
    let entries = list_directory_entries(&dir_str, &gm).unwrap();
    let names: Vec<&str> = entries.iter().map(|e| e.name.as_str()).collect();
    assert!(names.contains(&"a.md"), "应枚举到文件");
    assert!(names.contains(&"sub"), "应枚举到子目录");

    // 子目录经祖先匹配可枚举
    let sub_str = dir.join("sub").to_string_lossy().to_string();
    assert!(list_directory_entries(&sub_str, &gm).is_ok(), "子目录祖先匹配应可枚举");

    // 目录之外（未授权）仍被拒
    let outside = dir.join("..").to_string_lossy().to_string();
    assert!(list_directory_entries(&outside, &gm).is_err(), "未授权目录必须拒绝");

    let _ = std::fs::remove_dir_all(&dir);
}

/// Windows 大小写不敏感匹配：授权 `C:\Docs` 命中 `c:\docs\a.md`；
/// `..` 词法归一（不触碰文件系统）后仍命中；未授权盘符 fail-closed。
/// 非 Windows 保持大小写敏感（fail-closed）。
#[test]
fn grant_matching_is_case_insensitive_on_windows_and_normalizes_dotdot() {
    let dir = temp_dir("case");
    let gm = GrantsManager::new(dir.join("data"));
    gm.grant("C:\\Docs");

    #[cfg(windows)]
    {
        assert!(gm.is_granted("c:\\docs\\a.md"), "Windows 上精确匹配应大小写不敏感");
        assert!(gm.is_granted("C:\\DOCS\\sub\\b.md"), "祖先匹配应大小写不敏感");
        assert!(gm.is_granted("C:\\docs\\..\\docs\\a.md"), "`..` 词法归一后仍命中");
        assert!(!gm.is_granted("D:\\docs\\a.md"), "未授权盘符必须拒绝");
    }
    #[cfg(not(windows))]
    {
        assert!(!gm.is_granted("C:\\docs\\a.md"), "非 Windows 保持大小写敏感（fail-closed）");
        assert!(!gm.is_granted("c:\\docs\\a.md"), "非 Windows 保持大小写敏感（fail-closed）");
    }

    // `..` 词法归一（平台无关）：base/../<dirname>/a.md 归一后命中 base 授权
    let base = dir.canonicalize().unwrap();
    gm.grant(&base.to_string_lossy().to_string());
    let with_dotdot = base
        .join("..")
        .join(base.file_name().unwrap())
        .join("a.md")
        .to_string_lossy()
        .to_string();
    assert!(gm.is_granted(&with_dotdot), "`..` 词法归一后仍命中");

    let _ = std::fs::remove_dir_all(&dir);
}

/// Windows 上 canonicalize 的 `\\?\` 扩展长度前缀必须还原为常规路径形式，
/// 否则与对话框授权记录（无前缀）永远无法匹配，合法流程会被全部误拒。
#[cfg(windows)]
#[test]
fn strip_verbatim_prefix_converts_extended_paths() {
    assert_eq!(
        strip_verbatim_prefix(r"\\?\C:\Users\me\a.md"),
        "C:\\Users\\me\\a.md"
    );
    assert_eq!(
        strip_verbatim_prefix(r"\\?\UNC\srv\share\f.md"),
        "\\\\srv\\share\\f.md"
    );
    // 无前缀的常规路径原样返回（含普通 UNC）
    assert_eq!(strip_verbatim_prefix("C:\\plain\\p.md"), "C:\\plain\\p.md");
    assert_eq!(
        strip_verbatim_prefix("\\\\srv\\share\\f.md"),
        "\\\\srv\\share\\f.md"
    );
}
