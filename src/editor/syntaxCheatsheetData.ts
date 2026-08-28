// @ts-nocheck
// 语法大全数据层（纯数据 + 过滤逻辑，可单测）
// 数据来源：https://www.cnblogs.com/miki-peng/articles/12502985.html（菜鸟教程/WebFX 体系）
//        + 本项目 Markdown 扩展（inlineSyntax / task / footnote / math / toc / frontMatter 等）
// 每个条目包含：标题、分类、说明、语法示例、插入模板。插入模板的占位词会被选中，方便用户直接输入。

export interface SyntaxEntry {
  id: string;
  title: string;
  category: string;
  description: string;
  syntax: string;
  syntaxLang?: string;
  insertText: string;
  placeholder?: string;
  tip?: string;
}

export interface SyntaxCategory {
  id: string;
  label: string;
}

export const SYNTAX_CATEGORIES: SyntaxCategory[] = [
  { id: 'headers', label: '标题' },
  { id: 'text', label: '文本样式' },
  { id: 'paragraph', label: '段落与换行' },
  { id: 'lists', label: '列表' },
  { id: 'blockquote', label: '引用' },
  { id: 'code', label: '代码' },
  { id: 'links', label: '链接' },
  { id: 'images', label: '图片' },
  { id: 'tables', label: '表格' },
  { id: 'hr', label: '分割线' },
  { id: 'footnotes', label: '脚注' },
  { id: 'toc', label: '目录' },
  { id: 'math', label: '数学公式' },
  { id: 'task', label: '任务列表' },
  { id: 'emoji', label: 'Emoji' },
  { id: 'frontmatter', label: 'Front Matter' },
  { id: 'other', label: '其他' },
];

export const SYNTAX_ENTRIES: SyntaxEntry[] = [
  // ===== 标题 =====
  { id: 'h-hash', title: '# 号标题', category: 'headers', description: '1–6 级标题，# 数量对应级别', syntax: '# 一级标题\n## 二级标题\n### 三级标题', insertText: '## 标题', placeholder: '标题', tip: '快捷：Ctrl+1/2/3 或菜单 段落 → 标题' },
  { id: 'h-setext', title: 'Setext 标题', category: 'headers', description: '用 = / - 下划线表示一、二级标题', syntax: '我是一级标题\n=================\n\n我是二级标题\n-----------------', insertText: '标题\n===', placeholder: '标题' },

  // ===== 段落与换行 =====
  { id: 'p-break', title: '段落换行', category: 'paragraph', description: '段落间空一行；行内换行用两个空格 + 回车', syntax: '第一段内容\n\n第二段内容\n\n行尾两个空格  \n下一行', insertText: '段落内容', placeholder: '段落内容' },

  // ===== 文本样式 =====
  { id: 'italic-star', title: '斜体', category: 'text', description: '单星号或单下划线包裹', syntax: '*斜体文本*\n_斜体文本_', insertText: '*斜体文本*', placeholder: '斜体文本' },
  { id: 'bold', title: '粗体', category: 'text', description: '双星号或双下划线包裹', syntax: '**粗体文本**\n__粗体文本__', insertText: '**粗体文本**', placeholder: '粗体文本' },
  { id: 'bold-italic', title: '粗斜体', category: 'text', description: '三星号或三下划线', syntax: '***粗斜体文本***', insertText: '***粗斜体文本***', placeholder: '粗斜体文本' },
  { id: 'del', title: '删除线', category: 'text', description: '双波浪线包裹', syntax: '~~删除线文本~~', insertText: '~~删除线文本~~', placeholder: '删除线文本' },
  { id: 'underline', title: '下划线', category: 'text', description: 'HTML 标签实现', syntax: '<u>带下划线文本</u>', insertText: '<u>下划线文本</u>', placeholder: '下划线文本' },
  { id: 'highlight', title: '高亮', category: 'text', description: '双等号包裹（本项目扩展）', syntax: '==高亮文本==', insertText: '==高亮文本==', placeholder: '高亮文本' },
  { id: 'sup', title: '上标', category: 'text', description: '前后 ^ 包裹', syntax: 'x^2^', insertText: 'x^2^', placeholder: '2' },
  { id: 'sub', title: '下标', category: 'text', description: '前后 ~ 包裹（单波浪）', syntax: 'H~2~O', insertText: 'H~2~O', placeholder: '2' },

  // ===== 列表 =====
  { id: 'ul', title: '无序列表', category: 'lists', description: '*, +, - 均可', syntax: '- 第一项\n- 第二项\n- 第三项', insertText: '- 列表项', placeholder: '列表项' },
  { id: 'ol', title: '有序列表', category: 'lists', description: '数字 + 点', syntax: '1. 第一项\n2. 第二项\n3. 第三项', insertText: '1. 列表项', placeholder: '列表项' },
  { id: 'list-nest', title: '嵌套列表', category: 'lists', description: '子项前加 4 空格或 2 空格缩进', syntax: '1. 第一项：\n    - 嵌套项一\n    - 嵌套项二', insertText: '- 父项\n    - 子项', placeholder: '子项' },

  // ===== 任务列表 =====
  { id: 'task', title: '任务列表', category: 'task', description: 'GFM 任务列表，可点击勾选', syntax: '- [ ] 未完成\n- [x] 已完成', insertText: '- [ ] 待办事项', placeholder: '待办事项' },

  // ===== 引用 =====
  { id: 'quote', title: '区块引用', category: 'blockquote', description: '行首 > + 空格', syntax: '> 区块引用\n> 第二行', insertText: '> 引用内容', placeholder: '引用内容' },
  { id: 'quote-nest', title: '引用内嵌套', category: 'blockquote', description: '引用中可含列表、代码等', syntax: '> 区块中使用列表\n> 1. 第一项\n> 2. 第二项', insertText: '> 引用内容\n> 1. 列表项', placeholder: '引用内容' },

  // ===== 代码 =====
  { id: 'inline-code', title: '行内代码', category: 'code', description: '单反引号包裹', syntax: '`行内代码`', insertText: '`代码`', placeholder: '代码' },
  { id: 'fenced-code', title: '代码块', category: 'code', description: '三反引号围栏，可指定语言', syntax: '```python\nprint("Hello")\n```', syntaxLang: 'python', insertText: '```python\n代码\n```', placeholder: '代码' },

  // ===== 链接 =====
  { id: 'link-inline', title: '行内链接', category: 'links', description: '中括号文本 + 圆括号地址', syntax: '[链接文字](https://example.com)', insertText: '[链接文字](https://example.com)', placeholder: '链接文字' },
  { id: 'link-auto', title: '自动链接', category: 'links', description: '尖括号直接包裹 URL', syntax: '<https://example.com>', insertText: '<https://example.com>', placeholder: 'https://example.com' },
  { id: 'link-ref', title: '引用式链接', category: 'links', description: '用变量集中管理地址', syntax: '[Google][1]\n\n[1]: https://google.com', insertText: '[链接文字][1]\n\n[1]: https://example.com', placeholder: '链接文字' },

  // ===== 图片 =====
  { id: 'image', title: '图片', category: 'images', description: '感叹号 + 方括号 + 圆括号', syntax: '![替代文字](https://example.com/img.png)', insertText: '![替代文字](https://example.com/img.png)', placeholder: '替代文字' },
  { id: 'image-title', title: '带标题图片', category: 'images', description: '地址后加引号标题', syntax: '![alt](https://example.com/img.png "标题")', insertText: '![替代文字](https://example.com/img.png "标题")', placeholder: '替代文字' },
  { id: 'image-size', title: '指定尺寸', category: 'images', description: '用 HTML 标签控制宽高', syntax: '<img src="https://example.com/img.png" width="50%">', insertText: '<img src="https://example.com/img.png" width="50%">', placeholder: 'https://example.com/img.png' },

  // ===== 表格 =====
  { id: 'table', title: '基础表格', category: 'tables', description: '| 分隔单元格，- 分隔表头', syntax: '| 表头 | 表头 |\n| ---- | ---- |\n| 单元格 | 单元格 |', insertText: '| 表头 | 表头 |\n| ---- | ---- |\n| 单元格 | 单元格 |', placeholder: '表头' },
  { id: 'table-align', title: '对齐方式', category: 'tables', description: ':- 左对齐，-: 右对齐，:-: 居中', syntax: '| 左对齐 | 右对齐 | 居中 |\n| :---- | ----: | :----: |\n| 单元格 | 单元格 | 单元格 |', insertText: '| 左对齐 | 右对齐 | 居中 |\n| :---- | ----: | :----: |\n| 单元格 | 单元格 | 单元格 |', placeholder: '左对齐' },

  // ===== 分割线 =====
  { id: 'hr', title: '分割线', category: 'hr', description: '三个以上 * - _，可含空格', syntax: '---\n\n***\n\n* * *', insertText: '---', placeholder: '---' },

  // ===== 脚注 =====
  { id: 'footnote', title: '脚注', category: 'footnotes', description: '正文中 [^标识]，文末定义', syntax: '正文含脚注[^1]\n\n[^1]: 脚注说明文字', insertText: '正文[^1]\n\n[^1]: 脚注说明', placeholder: '脚注说明' },

  // ===== 目录 =====
  { id: 'toc', title: '目录 [TOC]', category: 'toc', description: '独占一行自动生成目录', syntax: '[TOC]', insertText: '[TOC]', placeholder: '[TOC]' },

  // ===== 数学公式 =====
  { id: 'math-inline', title: '行内公式', category: 'math', description: '单 $ 或 \\( \\) 包裹', syntax: '$E=mc^2$\n\n\\(a^2 + b^2 = c^2\\)', insertText: '$公式$', placeholder: '公式' },
  { id: 'math-block', title: '块级公式', category: 'math', description: '双 $$ 或 \\[ \\] 独占行', syntax: '$$\nE=mc^2\n$$', insertText: '$$\n公式\n$$', placeholder: '公式' },

  // ===== Emoji =====
  { id: 'emoji', title: 'Emoji 表情', category: 'emoji', description: '冒号包裹短代码（支持中文语境）', syntax: ':smile: :heart: :+1: :-1:', insertText: ':smile:', placeholder: 'smile' },

  // ===== Front Matter =====
  { id: 'frontmatter', title: 'Front Matter', category: 'frontmatter', description: '文档开头 --- 包裹 YAML 元数据', syntax: '---\ntitle: 文章标题\ntags: [标签]\n---', insertText: '---\ntitle: 标题\n---\n', placeholder: '标题' },

  // ===== 其他 =====
  { id: 'escape', title: '转义', category: 'other', description: '反斜杠转义特殊字符', syntax: '\\* \` \\# 保持字面', insertText: '\\*', placeholder: '*' },
];

export function filterEntries(query: string, entries: SyntaxEntry[] = SYNTAX_ENTRIES): SyntaxEntry[] {
  const q = query.trim().toLowerCase();
  if (!q) return entries;
  return entries.filter((e) =>
    e.title.toLowerCase().includes(q) ||
    e.category.toLowerCase().includes(q) ||
    e.description.toLowerCase().includes(q) ||
    e.syntax.toLowerCase().includes(q)
  );
}

export function getCategories(): SyntaxCategory[] {
  return SYNTAX_CATEGORIES.slice();
}

export function getEntriesByCategory(categoryId: string): SyntaxEntry[] {
  return SYNTAX_ENTRIES.filter((e) => e.category === categoryId);
}

export function findEntry(id: string): SyntaxEntry | undefined {
  return SYNTAX_ENTRIES.find((e) => e.id === id);
}