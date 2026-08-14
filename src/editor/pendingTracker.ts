// S0.3 预览就绪原语（WP8a）：在途任务计数，计数归零时唤醒全部等待者。
// 消费方：diagramMethods（Mermaid 渲染在途计数）、viewMethods（本地图片
// 水合在途计数）；_awaitPreviewReady() 与未来导出流程（M2 长图）靠它判定
// "预览已就绪"。纯逻辑，由 tests/unit/pendingTracker.test.ts 直接覆盖。

export interface PendingTracker {
  /** 当前在途任务数（只读） */
  readonly pending: number;
  /** 开始一个在途任务 */
  inc(): void;
  /** 结束一个在途任务；计数归零时唤醒全部等待者。不会减成负数。 */
  dec(): void;
  /** 计数归零时 resolve；当前已空闲则立即 resolve */
  whenIdle(): Promise<void>;
}

export function createPendingTracker(): PendingTracker {
  let pending = 0;
  let waiters: Array<() => void> = [];

  function settle() {
    if (pending !== 0) return;
    const list = waiters;
    waiters = [];
    list.forEach((resolve) => resolve());
  }

  return {
    get pending() {
      return pending;
    },
    inc() {
      pending += 1;
    },
    dec() {
      // 钳制在 0：多余的 dec 不得让计数变负，否则 whenIdle 永远等不到归零
      if (pending > 0) pending -= 1;
      settle();
    },
    whenIdle() {
      if (pending === 0) return Promise.resolve();
      return new Promise((resolve) => waiters.push(resolve));
    }
  };
}
