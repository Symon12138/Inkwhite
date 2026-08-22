// 发布脚本：读取 src-tauri 版本 → 检查 exe/msi 产物 → 打 tag 并推送 →
// 创建（或更新）GitHub Release 并上传两个安装包。幂等：同版本可重跑，
// 已存在的 tag 强推、已存在的资产用 --clobber 覆盖。
//
// 用法：node scripts/release.mjs [--notes "发布说明"]
import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const REPO = 'Symon12138/Inkwhite';

// ---- 参数：--notes 可选 ----
const notesIdx = process.argv.indexOf('--notes');
const notes = notesIdx >= 0 ? process.argv[notesIdx + 1] : null;

// ---- 读版本 ----
const conf = JSON.parse(readFileSync(join(root, 'src-tauri/tauri.conf.json'), 'utf8'));
const version = conf.version;
const tag = 'v' + version;
const nsisDir = join(root, 'src-tauri', 'target', 'release', 'bundle', 'nsis');
const exe = join(nsisDir, `Inkwhite_${version}_x64-setup.exe`);
const portable = join(root, 'src-tauri', 'target', 'release', 'bundle', 'portable', `Inkwhite_${version}_x64-portable.zip`);
const msi = join(root, 'src-tauri', 'target', 'release', 'bundle', 'msi', `Inkwhite_${version}_x64_en-US.msi`);

function run(cmd, args, opts = { stdio: 'inherit' }) {
  try {
    return execFileSync(cmd, args, { encoding: 'utf8', ...opts });
  } catch (e) {
    if (opts.allowFail) return null;
    console.error(`命令失败：${cmd} ${args.join(' ')}`);
    console.error(e && e.message ? e.message : e);
    process.exit(1);
  }
}

// ---- 1) 产物检查 ----
const missing = [];
if (!existsSync(exe)) missing.push(exe);
if (!existsSync(portable)) missing.push(portable);
if (!existsSync(msi)) missing.push(msi);
if (missing.length) {
  console.error(`缺少产物，请先 npm run tauri:build：\n  ${missing.join('\n  ')}`);
  process.exit(1);
}

// ---- 2) gh 可用且已登录 ----
run('gh', ['--version']);
const auth = run('gh', ['auth', 'status'], { stdio: 'pipe', allowFail: true });
if (!auth) {
  console.error('gh 未登录，请先 `gh auth login`');
  process.exit(1);
}

// ---- 3) 打 tag 并推送（-f 保证同版本重跑）----
run('git', ['tag', tag, '-f']);
run('git', ['push', 'origin', tag, '-f']);

// ---- 4) Release：已存在则跳过 create，只做资产覆盖 ----
const existing = run('gh', ['release', 'view', tag, '--json', 'tagName', '--jq', '.tagName'], { stdio: 'pipe', allowFail: true });
const exists = existing && String(existing).trim() === tag;
if (!exists) {
  const title_ = `飞白 Inkwhite ${version}`;
  const note_ = notes || `Inkwhite ${version} Windows 安装包（NSIS.exe / MSI）。`;
  run('gh', ['release', 'create', tag, '--repo', REPO, '--title', title_, '--notes', note_]);
} else if (notes) {
  // 已有 release 且传了新说明：更新 notes
  run('gh', ['release', 'edit', tag, '--repo', REPO, '--notes', notes]);
}

// ---- 5) 上传资产（--clobber 覆盖同名）----
run('gh', ['release', 'upload', tag, '--repo', REPO, exe, msi, portable, '--clobber']);

console.log(`\n✅ Release ${tag} 就绪：https://github.com/${REPO}/releases/tag/${tag}`);
