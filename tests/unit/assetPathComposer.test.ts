// M3-INSERT：图片资产策略纯逻辑（src/editor/assetPathComposer.ts）的单测。
// node 无 DOM：六个纯函数（校验/去重/尺寸估算/payload 检查/策略决策/Markdown 组装）
// 全部可脱离浏览器直跑；接线层（saveAssetFile → Rust save_asset_file）由轮 2 完成。
// 红测先行：本文件先写，跑一遍确认失败（模块不存在），再实现到全绿。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  IMAGE_EXTENSIONS,
  MAX_ASSET_NAME_LENGTH,
  MAX_IMAGE_BYTES,
  validateAssetName,
  dedupeAssetName,
  estimateImageSize,
  checkImagePayload,
  resolveInsertStrategy,
  buildImageMarkdown
} from '../../src/editor/assetPathComposer.ts';

// ─────────────────────────────────────────────────────────────────────────────
// validateAssetName：负例（全负例清单：空/控制字符/路径混入/非法字符/尾部点空格/
// 保留设备名/超长/非图片扩展名）
// ─────────────────────────────────────────────────────────────────────────────
test('空名与纯分隔符输入被拒绝', () => {
  assert.equal(validateAssetName(''), '文件名不能为空');
  assert.equal(validateAssetName('/'), '文件名不能为空');
  assert.equal(validateAssetName('dir/'), '文件名不能为空');
  assert.equal(validateAssetName('a\\b\\'), '文件名不能为空');
});

test('控制字符（\\u0000-\\u001F）被拒绝', () => {
  assert.equal(validateAssetName('photo\u0000.png'), '文件名包含控制字符');
  assert.equal(validateAssetName('photo\u0001.png'), '文件名包含控制字符');
  assert.equal(validateAssetName('photo\n.png'), '文件名包含控制字符');
});

test('路径穿越（..）被拒绝：裸名、前缀混入、反斜杠形式', () => {
  assert.equal(validateAssetName('..'), '文件名不能包含 ".."');
  assert.equal(validateAssetName('../photo.png'), '文件名不能包含 ".."');
  assert.equal(validateAssetName('..\\photo.png'), '文件名不能包含 ".."');
  assert.equal(validateAssetName('dir/../photo.png'), '文件名不能包含 ".."');
  assert.equal(validateAssetName('a..b.png'), '文件名不能包含 ".."');
});

test('Windows 非法字符逐个拒绝：< > : " | ? *', () => {
  const illegal = ['<', '>', ':', '"', '|', '?', '*'];
  for (const ch of illegal) {
    assert.equal(validateAssetName('photo' + ch + '.png'), '文件名包含非法字符（< > : " | ? *）', ch);
  }
});

test('尾部点或尾部空格被拒绝', () => {
  assert.equal(validateAssetName('photo.'), '文件名不能以点（.）或空格结尾');
  assert.equal(validateAssetName('photo.png.'), '文件名不能以点（.）或空格结尾');
  assert.equal(validateAssetName('photo.png '), '文件名不能以点（.）或空格结尾');
});

test('Windows 保留设备名被拒绝（大小写不敏感，含扩展名前缀形式）', () => {
  assert.equal(validateAssetName('CON.png'), '文件名是 Windows 保留设备名');
  assert.equal(validateAssetName('con.PNG'), '文件名是 Windows 保留设备名');
  assert.equal(validateAssetName('CON.foo.png'), '文件名是 Windows 保留设备名');
  assert.equal(validateAssetName('COM1.jpg'), '文件名是 Windows 保留设备名');
  assert.equal(validateAssetName('lpt9.webp'), '文件名是 Windows 保留设备名');
  assert.equal(validateAssetName('AUX'), '文件名是 Windows 保留设备名');
});

test('超过 200 字符被拒绝，恰 200 字符通过', () => {
  assert.equal(validateAssetName('a'.repeat(201) + '.png'), '文件名不能超过 200 个字符');
  const exactly = 'a'.repeat(196);
  assert.equal(validateAssetName(exactly + '.png'), exactly + '.png');
});

test('非图片扩展名被拒绝：txt/无扩展/svg/exe/点文件', () => {
  assert.equal(validateAssetName('photo.txt'), '不支持的图片格式（仅支持 png/jpg/jpeg/gif/webp/bmp/avif/ico）');
  assert.equal(validateAssetName('photo'), '不支持的图片格式（仅支持 png/jpg/jpeg/gif/webp/bmp/avif/ico）');
  assert.equal(validateAssetName('photo.svg'), '不支持的图片格式（仅支持 png/jpg/jpeg/gif/webp/bmp/avif/ico）');
  assert.equal(validateAssetName('photo.png.exe'), '不支持的图片格式（仅支持 png/jpg/jpeg/gif/webp/bmp/avif/ico）');
  assert.equal(validateAssetName('.png'), '不支持的图片格式（仅支持 png/jpg/jpeg/gif/webp/bmp/avif/ico）');
});

// ─────────────────────────────────────────────────────────────────────────────
// validateAssetName：正例（返回规范化 basename）
// ─────────────────────────────────────────────────────────────────────────────
test('合法图片名返回自身', () => {
  assert.equal(validateAssetName('photo.png'), 'photo.png');
});

test('路径前缀被剥掉后返回末段（防 dir/name.png 混入）', () => {
  assert.equal(validateAssetName('dir/photo.png'), 'photo.png');
  assert.equal(validateAssetName('C:\\Users\\me\\photo.png'), 'photo.png');
  assert.equal(validateAssetName('a/b/c/photo.png'), 'photo.png');
});

test('扩展名大小写不敏感，返回值保留原始大小写', () => {
  assert.equal(validateAssetName('photo.PNG'), 'photo.PNG');
  assert.equal(validateAssetName('PHOTO.Jpeg'), 'PHOTO.Jpeg');
});

test('白名单八种扩展名全部通过', () => {
  assert.deepEqual(
    [...IMAGE_EXTENSIONS].sort(),
    ['avif', 'bmp', 'gif', 'ico', 'jpeg', 'jpg', 'png', 'webp']
  );
  for (const ext of IMAGE_EXTENSIONS) {
    assert.equal(validateAssetName('photo.' + ext), 'photo.' + ext, ext);
  }
});

test('含空格与括号的合法名通过（Markdown 引用由 buildImageMarkdown 处理）', () => {
  assert.equal(validateAssetName('my photo.png'), 'my photo.png');
  assert.equal(validateAssetName('photo(1).png'), 'photo(1).png');
  assert.equal(validateAssetName('photo.v2.png'), 'photo.v2.png');
});

// ─────────────────────────────────────────────────────────────────────────────
// dedupeAssetName：同名 → -1 → -2 ……
// ─────────────────────────────────────────────────────────────────────────────
test('无冲突时原样返回', () => {
  assert.equal(dedupeAssetName(['a.png', 'b.png'], 'photo.png'), 'photo.png');
  assert.equal(dedupeAssetName([], 'photo.png'), 'photo.png');
});

test('同名冲突追加 -1，占用后继续 -2（保留扩展名）', () => {
  assert.equal(dedupeAssetName(['photo.png'], 'photo.png'), 'photo-1.png');
  assert.equal(dedupeAssetName(['photo.png', 'photo-1.png'], 'photo.png'), 'photo-2.png');
  assert.equal(dedupeAssetName(['photo.png', 'photo-1.png', 'photo-2.png'], 'photo.png'), 'photo-3.png');
});

test('大小写不敏感比较（Windows 语义），返回值保留请求名大小写', () => {
  assert.equal(dedupeAssetName(['PHOTO.PNG'], 'photo.png'), 'photo-1.png');
  assert.equal(dedupeAssetName(['photo.png'], 'PHOTO.PNG'), 'PHOTO-1.PNG');
});

test('caseInsensitive=false 时大小写不同不算冲突', () => {
  assert.equal(dedupeAssetName(['Photo.png'], 'photo.png', false), 'photo.png');
});

test('目录名同样参与冲突判定；无扩展名时后缀接在末尾', () => {
  assert.equal(dedupeAssetName(['assets'], 'assets'), 'assets-1');
  assert.equal(dedupeAssetName(['logo'], 'logo'), 'logo-1');
  assert.equal(dedupeAssetName(['photo.png', 'assets'], 'photo.png'), 'photo-1.png');
});

// ─────────────────────────────────────────────────────────────────────────────
// estimateImageSize：base64 解码字节数估算（对合法 base64 精确）
// ─────────────────────────────────────────────────────────────────────────────
test('裸 base64 按 4 字符 ≈ 3 字节精确折算', () => {
  assert.equal(estimateImageSize('QQ=='), 1);
  assert.equal(estimateImageSize('QUI='), 2);
  assert.equal(estimateImageSize('QUJD'), 3);
  assert.equal(estimateImageSize('QUJDRA=='), 4);
  assert.equal(estimateImageSize('QUJDRA'), 4); // 无填充形态
});

test('data URL 形态剥掉前缀后按载荷折算', () => {
  assert.equal(estimateImageSize('data:image/png;base64,QUJD'), 3);
  assert.equal(estimateImageSize('data:image/jpeg;base64,QUJDRA=='), 4);
});

test('空输入与空载荷估算为 0', () => {
  assert.equal(estimateImageSize(''), 0);
  assert.equal(estimateImageSize('data:image/png;base64,'), 0);
});

// ─────────────────────────────────────────────────────────────────────────────
// checkImagePayload：空 / 坏 base64 / 超大 → 错误信息；通过 → null
// ─────────────────────────────────────────────────────────────────────────────
test('空输入被拒绝：裸空串、空白、data URL 空载荷', () => {
  assert.equal(checkImagePayload(''), '图片数据为空');
  assert.equal(checkImagePayload('   '), '图片数据为空');
  assert.equal(checkImagePayload('data:image/png;base64,'), '图片数据为空');
});

test('非 base64 字符被拒绝（裸形态与 data URL 载荷）', () => {
  assert.equal(checkImagePayload('not base64!'), '图片数据不是有效的 base64');
  assert.equal(checkImagePayload('QUJD***'), '图片数据不是有效的 base64');
  assert.equal(checkImagePayload('data:image/png;base64,QUJD***'), '图片数据不是有效的 base64');
});

test('以 data: 开头但不是 ;base64, 形态被拒绝', () => {
  assert.equal(checkImagePayload('data:foo'), '图片数据格式不正确（仅支持裸 base64 或 data:image/...;base64,...）');
  assert.equal(checkImagePayload('data:image/png;base64'), '图片数据格式不正确（仅支持裸 base64 或 data:image/...;base64,...）');
  assert.equal(checkImagePayload('data:image/png;charset=utf-8,QUJD'), '图片数据格式不正确（仅支持裸 base64 或 data:image/...;base64,...）');
});

test('两种形态通过时返回 null', () => {
  assert.equal(checkImagePayload('QUJD'), null);
  assert.equal(checkImagePayload('data:image/png;base64,QUJD'), null);
});

test('超过 maxBytes 返回明确错误而非截断；边界值通过', () => {
  assert.equal(checkImagePayload('QUJDRA==', { maxBytes: 4 }), null); // 恰 4 字节不超限
  assert.equal(checkImagePayload('QUJDRA==', { maxBytes: 3 }), '图片超过大小限制（上限 1 KB）');
});

test('默认 10 MB 上限：恰满通过，超一字节拒绝', () => {
  assert.equal(MAX_IMAGE_BYTES, 10 * 1024 * 1024);
  // 13981012 个 base64 字符 = 10485759 字节（10MB - 1），通过
  assert.equal(checkImagePayload('A'.repeat(13981012)), null);
  // 13981016 个字符 = 10485762 字节，超限报错
  assert.equal(
    checkImagePayload('A'.repeat(13981016)),
    '图片超过大小限制（上限 10.0 MB）'
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// resolveInsertStrategy：save / inline / prompt-save 三分支
// ─────────────────────────────────────────────────────────────────────────────
test('本地文档 + 桌面端 → save（saveAssetFile 落盘）', () => {
  assert.equal(resolveInsertStrategy({ hasDocPath: true, tauriAvailable: true }), 'save');
});

test('未命名文档 + 桌面端 → prompt-save（先弹另存为）', () => {
  assert.equal(resolveInsertStrategy({ hasDocPath: false, tauriAvailable: true }), 'prompt-save');
});

test('浏览器端（tauriBridge 为 null）→ inline，与 docPath 无关', () => {
  assert.equal(resolveInsertStrategy({ hasDocPath: true, tauriAvailable: false }), 'inline');
  assert.equal(resolveInsertStrategy({ hasDocPath: false, tauriAvailable: false }), 'inline');
});

// ─────────────────────────────────────────────────────────────────────────────
// buildImageMarkdown：![alt](src)
// ─────────────────────────────────────────────────────────────────────────────
test('基础组装：![alt](src)', () => {
  assert.equal(buildImageMarkdown({ src: 'photo.png', alt: '照片' }), '![照片](photo.png)');
  assert.equal(buildImageMarkdown({ src: 'photo.png' }), '![](photo.png)');
});

test('alt 转义 [ ] 与换行', () => {
  assert.equal(buildImageMarkdown({ src: 'p.png', alt: 'a[b]c' }), '![a\\[b\\]c](p.png)');
  assert.equal(buildImageMarkdown({ src: 'p.png', alt: '第一行\n第二行' }), '![第一行 第二行](p.png)');
  assert.equal(buildImageMarkdown({ src: 'p.png', alt: 'a\r\nb' }), '![a b](p.png)');
});

test('src 含空格或括号时用尖括号包裹，避免被当作链接终点', () => {
  assert.equal(buildImageMarkdown({ src: 'my photo.png', alt: '' }), '![](<my photo.png>)');
  assert.equal(buildImageMarkdown({ src: 'photo(1).png', alt: '' }), '![](<photo(1).png>)');
  assert.equal(buildImageMarkdown({ src: 'my dir/photo.png', alt: '' }), '![](<my dir/photo.png>)');
});

test('src 干净时不包裹', () => {
  assert.equal(buildImageMarkdown({ src: 'photo.png', alt: '' }), '![](photo.png)');
});
