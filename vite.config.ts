import { defineConfig } from 'vite';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const appVersion = require('./package.json').version as string;

// Tauri 友好的 Vite 配置：
// - 固定端口 1420，Tauri dev 需要确切知道前端地址
// - clearScreen false，避免 Tauri 终端输出被 Vite 清屏
// - 忽略 src-tauri 目录的文件变更监听（Rust 编译有独立流程）
export default defineConfig({
  define: { __APP_VERSION__: JSON.stringify(appVersion) },
  base: './',
  clearScreen: false,
  server: {
    host: '127.0.0.1',
    port: 1420,
    strictPort: true,
    watch: {
      ignored: ['**/src-tauri/**'],
    },
  },
  build: {
    target: 'es2022',
  },
});
