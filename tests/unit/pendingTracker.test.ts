import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPendingTracker } from '../../src/editor/pendingTracker.ts';

// S0.3 预览就绪原语（WP8a）：pendingTracker 是在途计数纯逻辑，
// diagramMethods（Mermaid 渲染）与 viewMethods（本地图片水合）共用，
// _awaitPreviewReady() 与未来导出流程（M2）靠它判定"预览已就绪"。

test('无在途任务时 whenIdle 立即解决', async () => {
  const tracker = createPendingTracker();
  await tracker.whenIdle();
});

test('在途计数归零时才唤醒等待者', async () => {
  const tracker = createPendingTracker();
  tracker.inc();
  tracker.inc();
  const idle = tracker.whenIdle();
  let settled = false;
  idle.then(() => { settled = true; });

  tracker.dec();
  assert.equal(tracker.pending, 1);
  assert.equal(settled, false, '还有在途任务时不得提前解决');

  tracker.dec();
  assert.equal(tracker.pending, 0);
  await idle;
  assert.equal(settled, true);
});

test('多个等待者同时被唤醒', async () => {
  const tracker = createPendingTracker();
  tracker.inc();
  const a = tracker.whenIdle();
  const b = tracker.whenIdle();
  tracker.dec();
  await Promise.all([a, b]);
});

test('inc 在 dec 之后仍可再次进入忙碌-空闲周期', async () => {
  const tracker = createPendingTracker();
  tracker.inc();
  tracker.dec();
  await tracker.whenIdle();

  tracker.inc();
  tracker.inc();
  const idle = tracker.whenIdle();
  tracker.dec();
  tracker.dec();
  await idle;
});

test('多余的 dec 不会把计数减成负数', () => {
  const tracker = createPendingTracker();
  tracker.dec();
  tracker.dec();
  assert.equal(tracker.pending, 0);
});
