// 文件授权清单管理：只允许读写用户通过对话框或系统「打开方式」明确指定过的文件。
// 授权清单持久化在 app_data_dir/granted-paths.json，重启后恢复。
// 对应 Electron 版 main.js 中的 grantedPaths / loadGrantedPaths / grantPath / assertGranted。

use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use serde::{Deserialize, Serialize};

/// 授权清单持久化格式
#[derive(Serialize, Deserialize)]
struct GrantedPathsFile {
    paths: Vec<String>,
}

/// 文件授权管理器：线程安全地管理已授权的文件/目录路径。
/// Clone 供 spawn_blocking 后台任务（搜索）使用，内部共享同一份清单。
#[derive(Clone)]
pub struct GrantsManager {
    granted_paths: Arc<Mutex<HashSet<String>>>,
    grants_file: PathBuf,
}

impl GrantsManager {
    /// 创建授权管理器并从磁盘加载已有授权。
    pub fn new(data_dir: PathBuf) -> Self {
        let grants_file = data_dir.join("granted-paths.json");
        let manager = Self {
            granted_paths: Arc::new(Mutex::new(HashSet::new())),
            grants_file,
        };
        manager.load();
        manager
    }

    /// 从 granted-paths.json 加载授权清单。
    fn load(&self) {
        if let Ok(content) = fs::read_to_string(&self.grants_file) {
            if let Ok(data) = serde_json::from_str::<GrantedPathsFile>(&content) {
                if let Ok(mut guard) = self.granted_paths.lock() {
                    for path in data.paths {
                        guard.insert(path);
                    }
                }
            }
        }
    }

    /// 将当前授权清单写入磁盘。
    fn save(&self) {
        if let Ok(guard) = self.granted_paths.lock() {
            let data = GrantedPathsFile {
                paths: guard.iter().cloned().collect(),
            };
            if let Ok(json) = serde_json::to_string_pretty(&data) {
                let _ = fs::write(&self.grants_file, json);
            }
        }
    }

    /// 授权一个路径（文件或目录）。路径会被规范化（展开 . 和 ..）。
    pub fn grant(&self, path: &str) {
        let normalized = Self::normalize(path);
        if let Ok(mut guard) = self.granted_paths.lock() {
            guard.insert(normalized);
        }
        self.save();
    }

    /// 授权路径及**父目录**。用于打开/另存 Markdown 文件：侧边栏「文件」页签
    /// 需要枚举文件所在目录（list_directory 走 assert_granted，父目录须在清单内）。
    /// 父目录授权随清单持久化，重启后目录浏览仍可用。
    pub fn grant_with_parent(&self, path: &str) {
        self.grant(path);
        let normalized = Self::normalize(path);
        if let Some(parent) = Path::new(&normalized).parent() {
            let parent_str = parent.to_string_lossy().to_string();
            if !parent_str.is_empty() {
                self.grant(&parent_str);
            }
        }
    }

    /// 检查路径是否已授权。
    pub fn is_granted(&self, path: &str) -> bool {
        let normalized = Self::normalize(path);
        if let Ok(guard) = self.granted_paths.lock() {
            // 精确匹配，或路径的某个祖先目录已授权
            if Self::contains_ci(&guard, &normalized) {
                return true;
            }
            let p = Path::new(&normalized);
            for ancestor in p.ancestors().skip(1) {
                let ancestor_str = ancestor.to_string_lossy().to_string();
                if ancestor_str.is_empty() {
                    continue;
                }
                if Self::contains_ci(&guard, &ancestor_str) {
                    return true;
                }
            }
            false
        } else {
            false
        }
    }

    /// 集合成员判断。Windows 文件系统大小写不敏感（NTFS），授权记录 `C:\Docs`
    /// 必须命中请求 `c:\docs\a.md`——canonicalize 后的大小写可能与对话框授权时
    /// 不一致，误拒会破坏合法流程。非 Windows 保持大小写敏感（fail-closed：
    /// 宁可误拒不可误放）。
    #[cfg(windows)]
    fn contains_ci(guard: &HashSet<String>, needle: &str) -> bool {
        guard.contains(needle) || guard.iter().any(|g| g.eq_ignore_ascii_case(needle))
    }

    #[cfg(not(windows))]
    fn contains_ci(guard: &HashSet<String>, needle: &str) -> bool {
        guard.contains(needle)
    }

    /// 断言路径已授权，未授权则返回错误。对应 Electron 版 assertGranted。
    pub fn assert_granted(&self, path: &str) -> Result<(), String> {
        if !self.is_granted(path) {
            return Err(format!("未授权的文件路径：{}", path));
        }
        Ok(())
    }

    /// 规范化路径：展开 . 和 .. 组件，不触碰文件系统（避免 symlink 解析差异）。
    /// 对应 Electron 版 Node.js 的 path.resolve()。
    fn normalize(path: &str) -> String {
        let p = Path::new(path);
        if p.is_absolute() {
            let mut result = PathBuf::new();
            for component in p.components() {
                match component {
                    std::path::Component::CurDir => {}
                    std::path::Component::ParentDir => {
                        result.pop();
                    }
                    other => result.push(other.as_os_str()),
                }
            }
            result.to_string_lossy().to_string()
        } else {
            // 相对路径：拼接当前工作目录后规范化
            let cwd = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
            let absolute = cwd.join(p);
            Self::normalize(absolute.to_string_lossy().as_ref())
        }
    }
}
