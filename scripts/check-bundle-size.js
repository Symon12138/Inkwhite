// 安装包体积监控：检查 src-tauri/target/release/bundle/nsis/*.exe 是否存在。
// 轻量守护：安装包应尽量小（当前目标 <20MB，楷体字体为护城河需保留）；
// 超过阈值才失败，未超出仅提示。目录不存在则跳过并提示先 build。
// 源码行数检查见 scripts/check-code-size.js，两者共同构成 npm run check 的体积守护。
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const MAX_BUNDLE_MB = 20;
const NSIS_DIR = join(ROOT, 'src-tauri', 'target', 'release', 'bundle', 'nsis');

function listInstallerExes() {
  try {
    return readdirSync(NSIS_DIR).filter((name) => name.toLowerCase().endsWith('.exe'));
  } catch {
    return null; // 目录不存在
  }
}

const exes = listInstallerExes();
if (exes === null) {
  console.log('[check-bundle-size] 未找到 ' + NSIS_DIR + '，跳过安装包体积检查（先运行 npm run tauri:build）。');
  process.exit(0);
}
if (exes.length === 0) {
  console.log('[check-bundle-size] nsis 目录下没有 .exe 安装包，跳过安装包体积检查（先运行 npm run tauri:build）。');
  process.exit(0);
}

const installers = exes.map((name) => {
  const bytes = statSync(join(NSIS_DIR, name)).size;
  return { name, mb: bytes / (1024 * 1024) };
});

const oversized = installers.filter((item) => item.mb >= MAX_BUNDLE_MB);
if (oversized.length > 0) {
  console.error('[check-bundle-size] 安装包超过 ' + MAX_BUNDLE_MB + 'MB 约束：');
  for (const item of oversized) {
    console.error('- ' + item.name + ': ' + item.mb.toFixed(2) + 'MB');
  }
  process.exit(1);
}

for (const item of installers) {
  console.log('[check-bundle-size] ' + item.name + ': ' + item.mb.toFixed(2) + 'MB（< ' + MAX_BUNDLE_MB + 'MB ✓）');
}
console.log('All bundle installers are < ' + MAX_BUNDLE_MB + 'MB.');
