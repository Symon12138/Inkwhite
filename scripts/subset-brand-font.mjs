// 把 OFL 授权的柳建毛草（Liu Jian Mao Cao，草书）裁成品牌「飞白」二字子集。
// 仅用于左上角品牌字（tabMethods 品牌图/文字），随包分发合法（SIL OFL 1.1，
// 见 fonts-src/liujian-maocao/OFL.txt）。产物 public/fonts/brand/feibai-brand.woff2。
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import subsetFont from "subset-font";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourcePath = path.join(root, "fonts-src", "liujian-maocao", "LiuJianMaoCao-Regular.ttf");
const outputPath = path.join(root, "public", "fonts", "brand", "feibai-brand.woff2");

// 品牌字集：「飞白」二字 + 基础拉丁兜底（防 font-family 回退闪烁）
const BRAND_CHARS = "飞白";

const source = await readFile(sourcePath);
const subset = await subsetFont(source, BRAND_CHARS, { targetFormat: "woff2" });
await mkdir(path.dirname(outputPath), { recursive: true });
await writeFile(outputPath, subset);

console.log(
  `Brand font subset: ${BRAND_CHARS.length} chars, ${(source.length / 1024 / 1024).toFixed(1)}MB -> ${(subset.length / 1024).toFixed(1)}KB -> ${path.relative(root, outputPath)}`
);
