// 基于 notify crate 的原生文件系统监听。
// 替代 Electron 版 localFileSyncMethods 中的 2 秒轮询（setInterval + stat lastModified）。
// 变更时通过 Tauri 事件 "mojian:file-changed" 推送到前端，携带变更文件的绝对路径。
//
// 去抖：同一路径的 Modify/Create 事件在时间窗（DEBOUNCE_WINDOW_MS）内合并，
// 窗口内静默满 DEBOUNCE_WINDOW_MS 才发射一次（trailing-edge 语义）。
// 防止单次保存触发多次事件；外部分块写入时，前端收到通知时写入已静默，
// 不会读到半成品。

use std::collections::HashMap;
use std::path::Path;
use std::sync::mpsc::{self, Receiver, Sender};
use std::sync::Mutex;
use std::thread;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use notify::{Config as NotifyConfig, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use tauri::{AppHandle, Emitter};

/// 去抖时间窗（毫秒）：同路径事件在此窗口内合并为一次通知。
/// 取值 200ms（任务要求 100-300ms 区间）：短到用户无感知，
/// 长到覆盖保存/同步工具产生的连发事件簇。
const DEBOUNCE_WINDOW_MS: u64 = 200;

/// 发送给监听线程的命令。
enum WatchCommand {
    /// 开始监听一个文件路径。
    Start(String),
    /// 停止监听一个文件路径。
    Stop(String),
}

/// 发送给去抖线程的命令。
enum DebounceCommand {
    /// 记录一次 Modify/Create 事件（携带事件时刻，毫秒）。
    Event { path: String, at_ms: u64 },
    /// 路径停止监听（或重建监听）：清除该路径的待发射状态，避免停止后补发。
    Clear(String),
}

/// 当前时间（Unix 毫秒）。
fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// 去抖判定核心（纯逻辑，可单测；线程循环见 run_debounce_loop）。
/// 语义：trailing-edge——路径自最近一次事件后静默满 window_ms 才算到期。
pub(crate) struct DebounceTracker {
    window_ms: u64,
    /// path → 最近一次事件时刻（毫秒）。
    last_event: HashMap<String, u64>,
}

impl DebounceTracker {
    pub(crate) fn new(window_ms: u64) -> Self {
        Self {
            window_ms,
            last_event: HashMap::new(),
        }
    }

    /// 记录一次事件（同路径连发事件只刷新时刻，不产生重复条目）。
    pub(crate) fn note(&mut self, path: String, at_ms: u64) {
        self.last_event.insert(path, at_ms);
    }

    /// 清除路径的待发射状态（停止监听 / 重建监听时调用）。
    pub(crate) fn clear(&mut self, path: &str) {
        self.last_event.remove(path);
    }

    /// 到期判定：now_ms 时刻静默 ≥ 窗口的路径集合（只读，不改变状态）。
    pub(crate) fn due(&self, now_ms: u64) -> Vec<String> {
        let mut due: Vec<String> = self
            .last_event
            .iter()
            .filter(|(_, &t)| now_ms.saturating_sub(t) >= self.window_ms)
            .map(|(p, _)| p.clone())
            .collect();
        due.sort(); // 确定性顺序，便于测试与日志
        due
    }

    /// 确认发射：从待发射集合移除（配合 due 使用）。
    pub(crate) fn settle(&mut self, paths: &[String]) {
        for p in paths {
            self.last_event.remove(p);
        }
    }

    /// 下一次到期时刻（毫秒）；无待发射路径时为 None（用于计算 recv_timeout）。
    pub(crate) fn next_deadline_ms(&self) -> Option<u64> {
        self.last_event
            .values()
            .map(|&t| t.saturating_add(self.window_ms))
            .min()
    }
}

/// 文件监听器：在独立后台线程中管理所有 watcher，另有独立去抖线程负责发射。
///
/// watcher 对象由监听线程拥有，避免平台特定 watcher 类型的 Send/Sync 约束。
/// 命令通过 std::sync::mpsc 通道传递，Tauri State 中只存储 Sender。
pub struct FileWatcher {
    sender: Mutex<Sender<WatchCommand>>,
}

impl FileWatcher {
    /// 创建文件监听器并启动后台监听线程与去抖线程。
    pub fn new(app: AppHandle) -> Self {
        let (tx, rx) = mpsc::channel::<WatchCommand>();
        let (debounce_tx, debounce_rx) = mpsc::channel::<DebounceCommand>();
        thread::spawn(move || Self::run_watcher_loop(rx, debounce_tx));
        thread::spawn(move || {
            Self::run_debounce_loop(debounce_rx, DEBOUNCE_WINDOW_MS, move |path| {
                let _ = app.emit("mojian:file-changed", path);
            })
        });
        Self {
            sender: Mutex::new(tx),
        }
    }

    /// 监听线程主循环：拥有所有 watcher，按命令增删；事件转发去抖线程。
    fn run_watcher_loop(rx: Receiver<WatchCommand>, debounce_tx: Sender<DebounceCommand>) {
        let mut watchers: HashMap<String, RecommendedWatcher> = HashMap::new();

        while let Ok(cmd) = rx.recv() {
            match cmd {
                WatchCommand::Start(path) => {
                    // 移除已有的同路径 watcher（重新建立监听），并清除该路径的
                    // 待发射状态（旧 watcher 的事件簇不应在新监听建立后补发）。
                    watchers.remove(&path);
                    let _ = debounce_tx.send(DebounceCommand::Clear(path.clone()));

                    let path_for_callback = path.clone();
                    let debounce_for_callback = debounce_tx.clone();

                    let watcher_result = RecommendedWatcher::new(
                        move |result: Result<notify::Event, notify::Error>| {
                            if let Ok(event) = result {
                                // 只在文件内容被修改或创建时通知（忽略属性变更等噪声）
                                if matches!(
                                    event.kind,
                                    EventKind::Modify(_) | EventKind::Create(_)
                                ) {
                                    let _ = debounce_for_callback.send(
                                        DebounceCommand::Event {
                                            path: path_for_callback.clone(),
                                            at_ms: now_ms(),
                                        },
                                    );
                                }
                            }
                        },
                        NotifyConfig::default(),
                    );

                    if let Ok(mut watcher) = watcher_result {
                        // 只监听文件本身（非递归），避免目录变更的噪声
                        if watcher
                            .watch(Path::new(&path), RecursiveMode::NonRecursive)
                            .is_ok()
                        {
                            watchers.insert(path, watcher);
                        }
                    }
                }
                WatchCommand::Stop(path) => {
                    // drop watcher 即停止监听；同时清除去抖待发射状态，
                    // 停止监听后不再为该路径补发事件。
                    watchers.remove(&path);
                    let _ = debounce_tx.send(DebounceCommand::Clear(path));
                }
            }
        }
    }

    /// 去抖线程主循环：把同路径事件簇合并为窗口静默后的一次发射。
    /// emit 抽象为闭包以便单测线程行为（生产环境为 app.emit）。
    fn run_debounce_loop<E: Fn(&str)>(rx: Receiver<DebounceCommand>, window_ms: u64, emit: E) {
        let mut tracker = DebounceTracker::new(window_ms);
        loop {
            // 有待发射路径时按最早到期时刻限时等待，否则阻塞等待下一条命令。
            let timeout_ms = tracker
                .next_deadline_ms()
                .map(|d| d.saturating_sub(now_ms()));
            let cmd = match timeout_ms {
                Some(ms) => rx.recv_timeout(Duration::from_millis(ms)),
                None => rx.recv().map_err(|_| mpsc::RecvTimeoutError::Disconnected),
            };
            match cmd {
                Ok(DebounceCommand::Event { path, at_ms }) => {
                    tracker.note(path, at_ms);
                    continue;
                }
                Ok(DebounceCommand::Clear(path)) => {
                    tracker.clear(&path);
                    continue;
                }
                Err(mpsc::RecvTimeoutError::Timeout) => {}
                Err(_) => break, // 通道关闭（app 退出 / 测试收尾）
            }
            // 到期检查：静默满窗口的路径各发射一次并清除。
            let due = tracker.due(now_ms());
            for path in &due {
                emit(path);
            }
            tracker.settle(&due);
        }
    }

    /// 开始监听一个文件。如已有同路径监听则替换。
    pub fn start_watching(&self, path: String) -> Result<(), String> {
        let guard = self.sender.lock().map_err(|e| e.to_string())?;
        guard
            .send(WatchCommand::Start(path))
            .map_err(|e| e.to_string())
    }

    /// 停止监听一个文件。
    pub fn stop_watching(&self, path: &str) {
        if let Ok(guard) = self.sender.lock() {
            let _ = guard.send(WatchCommand::Stop(path.to_string()));
        }
    }
}

// ===== 单测：去抖窗口判定（纯逻辑）与去抖线程（真实通道 + 真实时间）=====
//
// 纯逻辑部分用合成时间戳（无 sleep、无竞态）；线程部分用 50ms 小窗口 +
// 真实通道验证"合并为一次发射 / 停止后不补发 / 每路径各一次"。
// 实机验证项（无法在单测覆盖的线程接线）：notify 回调 → 去抖通道 → 发射的
// 全链路由 watch_file/unwatch_file 命令驱动，需在真实桌面会话中验证
// （保存一次仅收到一次 mojian:file-changed；停止监听后不再收到）。

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tracker_emits_once_after_quiet_window() {
        let mut t = DebounceTracker::new(200);
        t.note("a.md".to_string(), 0);
        assert!(t.due(199).is_empty(), "窗口未满不应发射");
        assert_eq!(t.due(200), vec!["a.md".to_string()], "静默满窗口应发射一次");
        t.settle(&["a.md".to_string()]);
        assert!(t.due(300).is_empty(), "发射后不再重复");
    }

    #[test]
    fn tracker_window_internal_events_extend_deadline() {
        let mut t = DebounceTracker::new(200);
        t.note("a.md".to_string(), 0);
        t.note("a.md".to_string(), 50); // 窗口内连发：以最后一次事件为准
        assert!(t.due(200).is_empty(), "连发后截止时刻顺延");
        assert_eq!(t.due(250), vec!["a.md".to_string()]);
    }

    #[test]
    fn tracker_clear_cancels_pending() {
        let mut t = DebounceTracker::new(200);
        t.note("a.md".to_string(), 0);
        t.clear("a.md");
        assert!(t.due(1000).is_empty(), "清除后不应发射");
    }

    #[test]
    fn tracker_paths_are_independent() {
        let mut t = DebounceTracker::new(200);
        t.note("a.md".to_string(), 0);
        t.note("b.md".to_string(), 150);
        assert_eq!(t.due(200), vec!["a.md".to_string()], "只有 a 静默满窗口");
        assert_eq!(
            t.due(350),
            vec!["a.md".to_string(), "b.md".to_string()],
            "两者都静默满窗口"
        );
    }

    #[test]
    fn tracker_next_deadline_tracks_earliest() {
        let mut t = DebounceTracker::new(200);
        assert_eq!(t.next_deadline_ms(), None, "无待发射时无截止时刻");
        t.note("a.md".to_string(), 100);
        t.note("b.md".to_string(), 300);
        assert_eq!(t.next_deadline_ms(), Some(300));
    }

    // ===== 线程行为（真实通道 + 真实时间，窗口 50ms）=====

    /// 启动去抖线程，返回命令发送端与发射接收端。
    fn spawn_loop(window_ms: u64) -> (Sender<DebounceCommand>, mpsc::Receiver<String>) {
        let (tx, rx) = mpsc::channel::<DebounceCommand>();
        let (emit_tx, emit_rx) = mpsc::channel::<String>();
        thread::spawn(move || {
            FileWatcher::run_debounce_loop(rx, window_ms, |p| {
                let _ = emit_tx.send(p.to_string());
            })
        });
        (tx, emit_rx)
    }

    #[test]
    fn debounce_loop_merges_event_burst_into_single_emit() {
        let (tx, emit_rx) = spawn_loop(50);
        let t = now_ms();
        for _ in 0..3 {
            tx.send(DebounceCommand::Event {
                path: "a.md".to_string(),
                at_ms: t,
            })
            .unwrap();
        }
        // 窗口静默后恰好发射一次
        assert_eq!(
            emit_rx
                .recv_timeout(Duration::from_secs(5))
                .expect("窗口后应发射一次"),
            "a.md"
        );
        assert!(
            emit_rx.recv_timeout(Duration::from_millis(300)).is_err(),
            "合并后不得重复发射"
        );
        drop(tx);
    }

    #[test]
    fn debounce_loop_clear_cancels_pending_emit() {
        let (tx, emit_rx) = spawn_loop(50);
        let t = now_ms();
        tx.send(DebounceCommand::Event {
            path: "a.md".to_string(),
            at_ms: t,
        })
        .unwrap();
        tx.send(DebounceCommand::Clear("a.md".to_string())).unwrap();
        assert!(
            emit_rx.recv_timeout(Duration::from_millis(300)).is_err(),
            "停止监听后不得补发"
        );
        drop(tx);
    }

    #[test]
    fn debounce_loop_emits_each_quiet_path_once() {
        let (tx, emit_rx) = spawn_loop(50);
        let t = now_ms();
        tx.send(DebounceCommand::Event {
            path: "b.md".to_string(),
            at_ms: t,
        })
        .unwrap();
        tx.send(DebounceCommand::Event {
            path: "a.md".to_string(),
            at_ms: t,
        })
        .unwrap();
        let mut got = Vec::new();
        for _ in 0..2 {
            got.push(
                emit_rx
                    .recv_timeout(Duration::from_secs(5))
                    .expect("每个静默路径各发射一次"),
            );
        }
        got.sort();
        assert_eq!(got, vec!["a.md".to_string(), "b.md".to_string()]);
        assert!(
            emit_rx.recv_timeout(Duration::from_millis(300)).is_err(),
            "无第三条发射"
        );
        drop(tx);
    }
}
