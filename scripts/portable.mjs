// 打包免安装版：symark.exe + WebView2Loader.dll → 便携 zip（解压即用）。
// 用法：npm run portable （需先 npm run tauri:build）
import { execFileSync } from 'node:child_process';
import { readFileSync, mkdirSync, copyFileSync, existsSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const conf = JSON.parse(readFileSync(join(root, 'src-tauri/tauri.conf.json'), 'utf8'));
const version = conf.version;
const outDir = join(root, 'src-tauri', 'target', 'release', 'bundle', 'portable');
const exeSrc = join(root, 'src-tauri', 'target', 'release', 'symark.exe');
const dllSrc = join(root, 'src-tauri', 'resources', 'WebView2Loader.dll');
const stage = join(outDir, 'Inkwhite_' + version + '_x64');
const zipPath = join(outDir, 'Inkwhite_' + version + '_x64-portable.zip');

if (!existsSync(exeSrc)) {
  console.error('缺少 ' + exeSrc + '，请先 npm run tauri:build');
  process.exit(1);
}
mkdirSync(stage, { recursive: true });
copyFileSync(exeSrc, join(stage, 'Inkwhite.exe'));
copyFileSync(dllSrc, join(stage, 'WebView2Loader.dll'));
writeFileSync(join(stage, '使用说明.txt'),
  '飞白 Inkwhite ' + version + ' 免安装版\n\n解压到任意目录，直接运行 Inkwhite.exe 即可。\n需要系统已安装 WebView2 运行时（Windows 10/11 通常自带）。\n配置保存在用户目录，与安装版互不影响。\n');
execFileSync('powershell', ['-NoProfile', '-Command',
  'Compress-Archive -Path "' + stage + '\\*" -DestinationPath "' + zipPath + '" -Force'], { stdio: 'inherit' });
console.log('OK 便携包：' + zipPath);
