// @ts-nocheck
import DOMPurify from 'dompurify';
import { tauriBridge } from './tauriBridge.ts';
import { saveEditorState } from './storage.ts';
import { createPendingTracker } from './pendingTracker.ts';
import { renderMarkdown } from './markdownExtensions/markdownExtensionRegistry.ts';
import { outlineSlug } from './markdownExtensions/slugify.ts';
import { bodyText } from './bodyText.ts';
import { computeStats, formatStats } from './statsMethods.ts';

export class ViewMethods {
  _syncViewMode() {
    const split = this.splitRef.current;
    if (!split) return;
    split.classList.toggle('editor-mode-active', this.viewMode === 'editor');
    split.classList.toggle('preview-mode-active', this.viewMode === 'preview');
    const switcher = this.viewModeSwitcherRef.current;
    if (switcher) {
      switcher.querySelectorAll('[data-mode]').forEach((button) => {
        button.setAttribute('aria-pressed', button.dataset.mode === this.viewMode ? 'true' : 'false');
      });
    }
    if (typeof this._syncViewMenuChecks === 'function') this._syncViewMenuChecks();
  }

  // Typora 风格菜单勾选：视图菜单标注当前模式（CSS 勾选，不改文本）
  _syncViewMenuChecks() {
    if (typeof document === 'undefined') return;
    const viewMenu = document.querySelector('[data-menubar="view"] .menubar-menu');
    if (!viewMenu) return;
    const map = { '编辑视图': 'editor', '分屏视图': 'split', '预览视图': 'preview' };
    viewMenu.querySelectorAll('.header-menu-item').forEach((item) => {
      const mode = map[(item.textContent || '').trim()];
      item.classList.toggle('is-checked', mode === this.viewMode);
      item.setAttribute('aria-checked', mode === this.viewMode ? 'true' : 'false');
    });
  }


  setViewMode(mode) {
    if (!['editor', 'split', 'preview'].includes(mode)) return;
    this.viewMode = mode;
    if (mode !== 'editor') this._renderPreview();
    this._syncViewMode();
    if (typeof this._persist === 'function') this._persist(); // 模式记忆：切换即存，不依赖输入
    if (mode !== 'preview') {
      setTimeout(() => this.sourceRef.current && this.sourceRef.current.focus(), 0);
    }
  }

  // ===== theme =====

  _applyTheme() {
    try { document.body.setAttribute('data-theme', this.theme); } catch (e) {}
    if (this.themeIconRef.current) this.themeIconRef.current.textContent = this.theme === 'dark' ? '☾' : '☀';
    this._applyPaper();
  }


  toggleTheme() {
    this.theme = this.theme === 'dark' ? 'light' : 'dark';
    this._themeTouched = true;
    this._applyTheme();
    this._persist();
    this._setStatus('已切换为' + (this.theme === 'dark' ? '暗黑' : '亮色') + '模式');
  }

  // ===== paper（内容纸色，与框架主题解耦） =====

  PAPERS() {
    return [
      { id: 'ink', label: '墨黑' },
      { id: 'parchment', label: '羊皮纸' },
      { id: 'cream', label: '米黄' },
      { id: 'snow', label: '清爽白' },
      { id: 'green', label: '豆沙绿' }
    ];
  }

  _resolvedPaper() {
    // 纸色按主题分别记忆；未选择时暗→墨黑、亮→清爽白
    const pref = this.theme === 'light' ? this.paperLight : this.paperDark;
    return pref || (this.theme === 'light' ? 'snow' : 'ink');
  }

  _applyPaper() {
    const active = this._resolvedPaper();
    try { document.body.setAttribute('data-paper', active); } catch (e) {}
    const picker = this.paperPickerRef.current;
    if (!picker) return;
    picker.querySelectorAll('.paper-dot').forEach((dot) => {
      const on = dot.dataset.paper === active;
      dot.classList.toggle('is-active', on);
      dot.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
  }

  setPaper(id) {
    if (this.theme === 'light') this.paperLight = id;
    else this.paperDark = id;
    this._applyPaper();
    this._persist();
    const item = this.PAPERS().find((p) => p.id === id);
    this._setStatus('纸色已切换为「' + (item ? item.label : id) + '」');
  }

  _buildPaperPicker() {
    const picker = this.paperPickerRef.current;
    if (!picker) return;
    picker.innerHTML = '';
    this.PAPERS().forEach((p) => {
      const dot = document.createElement('button');
      dot.type = 'button';
      dot.className = 'paper-dot';
      dot.dataset.paper = p.id;
      dot.title = '纸色：' + p.label;
      dot.setAttribute('aria-label', '纸色：' + p.label);
      dot.style.background = 'var(--paper-swatch-' + p.id + ')'; // 色值唯一源在 tokens.css
      dot.addEventListener('click', () => {
        // 小屏下色点收起为当前色：第一次点击先展开整排
        const collapsed = window.matchMedia && window.matchMedia('(max-width: 760px)').matches;
        if (collapsed && !picker.classList.contains('is-open')) {
          picker.classList.add('is-open');
          return;
        }
        this.setPaper(p.id);
        picker.classList.remove('is-open');
      });
      picker.appendChild(dot);
    });
    this._applyPaper();
  }

  // ===== 菜单栏 & 顶栏溢出菜单（见 menubarMethods.ts） =====



  togglePreviewFullscreen(force) {
    const pane = this.previewPaneRef.current;
    if (!pane) return;
    const next = typeof force === 'boolean' ? force : !this.previewFullscreen;
    this.previewFullscreen = next;
    this._syncPreviewEditable();
    pane.classList.toggle('preview-pane-fullscreen', this.previewFullscreen);
    pane.classList.toggle('immersive-wide', this.previewFullscreen && this.immersiveWide);
    this._syncFullscreenLayout();
    document.body.style.overflow = this.previewFullscreen ? 'hidden' : '';
    if (this.previewFullscreen) this._bindImmersiveToolbar();
    else this._unbindImmersiveToolbar();
    if (this.fullscreenLabelRef.current) {
      this.fullscreenLabelRef.current.textContent = this.previewFullscreen ? '退出阅读' : '沉浸式阅读';
    }
    if (this.fullscreenIconRef.current) {
      this.fullscreenIconRef.current.innerHTML = this.previewFullscreen
        ? '<path d="M9 3v6H3M15 3v6h6M9 21v-6H3M15 21v-6h6"></path>'
        : '<path d="M8 3H3v5M16 3h5v5M8 21H3v-5M16 21h5v-5"></path>';
    }
    this._setStatus(this.previewFullscreen ? '已进入沉浸式阅读 · 按 Esc 退出' : '已退出沉浸式阅读');
  }

  _syncPreviewEditable() {
    const prev = this.previewRef.current;
    if (!prev) return;
    prev.setAttribute('contenteditable', 'false');
    if (this.previewTitleRef.current) {
      this.previewTitleRef.current.textContent = '预览 · 仅阅读';
    }
  }

  // ===== 沉浸式：宽屏切换与工具条自动隐藏 =====

  toggleImmersiveWide() {
    this.immersiveWide = !this.immersiveWide;
    const pane = this.previewPaneRef.current;
    if (pane) pane.classList.toggle('immersive-wide', this.previewFullscreen && this.immersiveWide);
    this._syncImmersiveWideButton();
    this._persist();
    this._setStatus(this.immersiveWide ? '已切换为宽屏阅读' : '已切换为标准宽度');
  }

  _syncImmersiveWideButton() {
    const btn = this.immersiveWideRef.current;
    if (!btn) return;
    btn.textContent = this.immersiveWide ? '标准' : '宽屏';
    btn.title = this.immersiveWide ? '切换为标准宽度' : '切换为宽屏阅读';
    btn.setAttribute('aria-pressed', this.immersiveWide ? 'true' : 'false');
  }

  _bindImmersiveToolbar() {
    if (this._immersiveScrollH) return;
    const prev = this.previewRef.current;
    if (!prev) return;
    this._toolbarPeek = false;
    this._immersiveScrollH = () => this._updateImmersiveToolbar();
    this._immersiveMouseH = (e) => {
      if (!this.previewFullscreen) return;
      if (e.clientY <= 44) this._toolbarPeek = true;
      else if (e.clientY > 160) this._toolbarPeek = false;
      this._updateImmersiveToolbar();
    };
    prev.addEventListener('scroll', this._immersiveScrollH);
    document.addEventListener('mousemove', this._immersiveMouseH);
    this._updateImmersiveToolbar();
  }

  _unbindImmersiveToolbar() {
    const prev = this.previewRef.current;
    if (prev && this._immersiveScrollH) prev.removeEventListener('scroll', this._immersiveScrollH);
    if (this._immersiveMouseH) document.removeEventListener('mousemove', this._immersiveMouseH);
    this._immersiveScrollH = null;
    this._immersiveMouseH = null;
    const pane = this.previewPaneRef.current;
    if (pane) pane.classList.remove('immersive-toolbar-hidden');
  }

  _updateImmersiveToolbar() {
    const pane = this.previewPaneRef.current, prev = this.previewRef.current;
    if (!pane || !prev) return;
    if (!this.previewFullscreen) { pane.classList.remove('immersive-toolbar-hidden'); return; }
    const toolbar = pane.querySelector('.pane-toolbar');
    const keep = prev.scrollTop <= 8
      || this._toolbarPeek
      || (toolbar && toolbar.matches(':hover'));
    pane.classList.toggle('immersive-toolbar-hidden', !keep);
  }


  _renderPreview() {
    const src = this.sourceRef.current, prev = this.previewRef.current;
    if (!src || !prev || !window.marked) return;
    const markdown = src.value;
    this._syncPreviewEditable();
    // M1 单管线：lexer → 扩展 token 变换 → parser（renderMarkdown，与旧
    // marked.parse 逐字节等价，见 tests/unit/markdownSinglePipeline.test.ts）。
    // tokens 缓存到 _lastTokens 供 P4/P8（表格操作等）复用——本期只缓存不消费。
    const { html, tokens } = renderMarkdown(markdown);
    this._lastTokens = tokens;
    // 安全注入：marked 输出先经 DOMPurify 净化，杜绝 <img onerror> 等 XSS 载荷
    // 执行脚本后经 Tauri IPC 读写任意已授权文件。默认配置保留 span/class/inline
    // style，批注高亮（_applyHighlights 按 textContent 偏移包裹 span data-comment-id）
    // 与长图克隆预览 innerHTML（_buildPosterNode）都依赖这些结构，不受影响。
    // M1（WP4 决策）：ADD_TAGS 保留 KaTeX 的 <semantics>/<annotation> 语义标注
    // （无障碍/复制粘贴），见 tests/e2e/katexDecision.spec.ts 端到端用例。
    prev.innerHTML = DOMPurify.sanitize(html, { ADD_TAGS: ['semantics', 'annotation'] });
    this._renderMermaidDiagrams(prev);
    this._highlightCodeBlocks(prev);
    this._addCodeCopyButtons(prev);
    this._hydrateLocalImages(prev);
    this._applyHighlights();
    // 预览重渲染使旧 Range 失效，搜索打开时按新 DOM 重建高亮（不抢滚动）
    if (this.previewSearchOpen && this._updatePreviewSearchMatches) {
      this._updatePreviewSearchMatches({ keepIndex: true, silent: true });
    }
    this._renderOutline();
    this._updateCount();
    // S0.3 就绪原语钩子：挂版心元素（不新增 window 全局），供 E2E/导出等待就绪；幂等。
    if (!prev.__awaitPreviewReady) prev.__awaitPreviewReady = () => this._awaitPreviewReady();
    // 阅读位置：仅打开/切标签打标后恢复一次；编辑重渲染不干预
    if (this._readPosPending && typeof this._restoreReadPosSoon === 'function') this._restoreReadPosSoon();
  }

  // 桌面端：把预览里的相对路径图片换成 data URL（HTTP 页面拿不到磁盘文件）。
  // 逐张异步替换并按「文档路径::原始 src」缓存，输入过程中的重复渲染不再重复读盘。
  // S0.3 就绪原语：每张待水合图片计入在途，resolve/fail 都减一，
  // _awaitPreviewReady 等计数归零。浏览器环境 tauriBridge 为 null，本方法整体不执行。
  _hydrateLocalImages(root) {
    if (!root || !root.querySelectorAll) return;
    const desktop = tauriBridge;
    if (!desktop || !desktop.readAsset || !this.localFilePath) return;
    if (!this._localImageCache) this._localImageCache = new Map();
    if (!this._imageTracker) this._imageTracker = createPendingTracker();
    const docPath = this.localFilePath;
    root.querySelectorAll('img[src]').forEach((img) => {
      const src = img.getAttribute('src') || '';
      if (!src || /^(https?:|data:|blob:|file:|asset:|http:\/\/asset\.)/i.test(src)) return;
      const key = docPath + '::' + src;
      const cached = this._localImageCache.get(key);
      if (cached) { img.src = cached; return; }
      this._imageTracker.inc();
      // P1-3: 优先尝试 asset 协议（零拷贝，省 33% base64），失败回落到 data URL
      const useAsset = desktop.getAssetPath
        ? desktop.getAssetPath(docPath, src).then(async (assetPath) => {
            if (assetPath) {
              try {
                const { convertFileSrc } = await import('@tauri-apps/api/core');
                const url = convertFileSrc(assetPath);
                this._localImageCache.set(key, url);
                img.src = url;
                return true;
              } catch {}
            }
            return false;
          }).catch(() => false)
        : Promise.resolve(false);
      useAsset.then((hit) => {
        if (hit) return;
        return desktop.readAsset(docPath, src).then((asset) => {
          if (asset && asset.dataUrl) {
            this._localImageCache.set(key, asset.dataUrl);
            img.src = asset.dataUrl;
          }
        });
      }).catch(() => {}).finally(() => {
        this._imageTracker.dec();
      });
    });
  }

  // S0.3 就绪原语：本地图片水合在途计数归零时 resolve（无在途任务时立即 resolve）。
  _whenImagesIdle() {
    return this._imageTracker ? this._imageTracker.whenIdle() : Promise.resolve();
  }

  // S0.3 预览就绪原语：字体加载 + Mermaid 渲染 + 本地图片水合全部就绪后 resolve。
  // 设计给导出流程（M2 长图）与 E2E 复用；本期不接任何导出 UI。
  _awaitPreviewReady() {
    const waits = [];
    if (document.fonts && document.fonts.ready) {
      // fonts.ready 理论上不 reject，防御性吞掉，避免就绪等待被字体问题卡死
      waits.push(Promise.resolve(document.fonts.ready).catch(() => {}));
    }
    if (typeof this._whenMermaidIdle === 'function') waits.push(this._whenMermaidIdle());
    if (typeof this._whenImagesIdle === 'function') waits.push(this._whenImagesIdle());
    return Promise.all(waits);
  }


  _highlightCodeBlocks(root) {
    root.querySelectorAll('pre code').forEach((code) => {
      const text = code.textContent || '';
      const lang = this._codeLanguage(code, text);
      const tokens = this._codeTokens(text, lang);
      if (!tokens) return;
      code.replaceChildren(...tokens.map((token) => this._codeTokenNode(token)));
    });
  }
  _addCodeCopyButtons(r){r.querySelectorAll('pre').forEach(p=>{if(p.querySelector('.code-copy-btn'))return;const b=document.createElement('button');b.type='button';b.className='code-copy-btn';b.textContent='复制';b.title='复制代码';b.addEventListener('click',async()=>{try{await navigator.clipboard.writeText((p.querySelector('code')||p).textContent||'');const o=b.textContent;b.textContent='已复制';b.classList.add('is-copied');setTimeout(()=>{b.textContent=o;b.classList.remove('is-copied')},1200)}catch{}});p.style.position='relative';p.appendChild(b)})}

  _codeLanguage(code, text) {
    const className = code.className || '';
    const match = /\blanguage-([a-z0-9_-]+)/i.exec(className);
    const lang = match ? match[1].toLowerCase() : '';
    if (['ts', 'tsx', 'typescript'].includes(lang)) return 'ts';
    if (['js', 'jsx', 'javascript'].includes(lang)) return 'js';
    if (['json', 'jsonc'].includes(lang)) return 'json';
    if (['sh', 'bash', 'zsh', 'shell'].includes(lang)) return 'shell';
    return this._inferCodeLanguage(text);
  }

  _inferCodeLanguage(text) {
    const trimmed = text.trimStart();
    const first = trimmed.charCodeAt(0);
    if (first === 123 || first === 91) return 'json';
    const firstLine = trimmed.split('\n', 1)[0] || '';
    if (['$', 'npm ', 'pnpm ', 'yarn ', 'git ', 'cd ', 'mkdir ', 'rm '].some((prefix) => firstLine.startsWith(prefix))) return 'shell';
    if (['export ', 'const ', 'let ', 'interface ', 'type ', 'async ', 'await ', 'Promise<'].some((part) => text.includes(part))) return 'ts';
    return '';
  }

  _codeTokens(text, lang) {
    if (!lang) return null;
    if (lang === 'json') return this._tokenizeCode(text, this._jsonCodeRules());
    if (lang === 'shell') return this._tokenizeCode(text, this._shellCodeRules());
    return this._tokenizeCode(text, this._scriptCodeRules());
  }

  _tokenizeCode(text, rules) {
    const tokens = [];
    let index = 0;
    while (index < text.length) {
      const match = this._nextCodeToken(text, index, rules);
      if (!match) {
        tokens.push({ type: '', text: text[index] });
        index += 1;
      } else {
        tokens.push(match);
        index += match.text.length;
      }
    }
    return tokens;
  }

  _nextCodeToken(text, index, rules) {
    for (const rule of rules) {
      rule.re.lastIndex = index;
      const match = rule.re.exec(text);
      if (match && match.index === index) return { type: rule.type, text: match[0] };
    }
    return null;
  }

  _codeTokenNode(token) {
    if (!token.type) return document.createTextNode(token.text);
    const span = document.createElement('span');
    span.className = 'syntax-' + token.type;
    span.textContent = token.text;
    return span;
  }

  _scriptCodeRules() {
    return [
      { type: 'comment', re: /\/\*[\s\S]*?\*\/|\/\/[^\n]*/gy },
      { type: 'string', re: /`(?:\\[\s\S]|[^`\\])*`|'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"/gy },
      { type: 'number', re: /\b\d+(?:\.\d+)?\b/gy },
      { type: 'keyword', re: /\b(?:async|await|break|case|catch|class|const|continue|default|else|export|extends|finally|for|from|function|if|implements|import|interface|let|new|private|protected|public|return|switch|throw|try|type|var|while)\b/gy },
      { type: 'literal', re: /\b(?:false|null|true|undefined|void)\b/gy },
      { type: 'function', re: /\b[A-Za-z_$][\w$]*(?=\s*\()/gy },
      { type: 'type', re: /\b[A-Z][A-Za-z0-9_$]*\b/gy }
    ];
  }

  _jsonCodeRules() {
    return [
      { type: 'string', re: /"(?:\\.|[^"\\])*"(?=\s*:)/gy },
      { type: 'value', re: /"(?:\\.|[^"\\])*"/gy },
      { type: 'number', re: /-?\b\d+(?:\.\d+)?(?:e[+-]?\d+)?\b/gyi },
      { type: 'literal', re: /\b(?:false|null|true)\b/gy }
    ];
  }

  _shellCodeRules() {
    return [
      { type: 'comment', re: /#[^\n]*/gy },
      { type: 'string', re: /'(?:[^'])*'|"(?:\\.|[^"\\])*"/gy },
      { type: 'keyword', re: /\b(?:case|do|done|elif|else|esac|fi|for|function|if|in|then|while)\b/gy },
      { type: 'number', re: /\b\d+(?:\.\d+)?\b/gy },
      { type: 'function', re: /\b[A-Za-z0-9_.-]+(?=\s)/gy }
    ];
  }


  _renderOutline() {
    const preview = this.previewRef.current;
    const list = this.outlineListRef.current;
    if (!preview || !list) return;
    const headings = Array.from(preview.querySelectorAll('h1,h2,h3,h4,h5,h6'));
    const used = new Set();
    list.innerHTML = '';
    headings.forEach((heading, index) => {
      // M1：slug 统一走 markdownExtensions/slugify.ts 的 outlineSlug
      // （TOC 扩展 M1-5 复用；行为与抽取前 _outlineSlug 一致）。
      // 文本源用 bodyText 而非 textContent：KaTeX 双轨（.katex-mathml 含
      // mathml+annotation 副本）会让 textContent 重复（`# $z$` → 'zzz'），
      // 与 TOC 扩展的剥取规则（'z'）不同源；bodyText 排除 .katex-mathml，
      // 与 TOC 一致。普通标题两者等价，行为不变。
      const headingText = bodyText(heading);
      heading.id = outlineSlug(headingText, index, used);
      heading.dataset.outlineIndex = String(index);
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'outline-item outline-level-' + heading.tagName.slice(1);
      button.dataset.outlineTarget = heading.id;
      button.textContent = headingText.trim() || '未命名标题';
      button.title = button.textContent;
      button.addEventListener('click', () => {
        this._outlineJumpTarget = heading.id;
        if (this.viewMode === 'editor') {
          // 编辑视图：预览隐藏，大纲点击跳转源码对应行
          this._scrollSourceToHeading(heading.dataset.outlineIndex);
        } else {
          this._scrollPreviewTo(heading);
        }
        this._setActiveOutlineItem(heading.id);
        clearTimeout(this._outlineJumpT);
        this._outlineJumpT = setTimeout(() => {
          this._outlineJumpTarget = '';
          this._syncActiveOutlineItem();
        }, 700);
        if (window.matchMedia && window.matchMedia('(max-width: 760px)').matches) {
          this.toggleOutline(false);
        }
      });
      list.appendChild(button);
    });
    if (!headings.length) {
      const empty = document.createElement('div');
      empty.className = 'outline-empty';
      empty.textContent = '当前文章还没有标题。使用 #、## 等 Markdown 标题后，大纲会自动生成。';
      list.appendChild(empty);
    }
    if (this.outlineCountRef.current) {
      this.outlineCountRef.current.textContent = String(headings.length);
    }
    if (this.outlineButtonRef.current) {
      this.outlineButtonRef.current.disabled = headings.length === 0;
      this.outlineButtonRef.current.title = headings.length ? '查看文章大纲' : '当前文章没有标题';
    }
    this._syncActiveOutlineItem();
  }


  _scrollSourceToHeading(idx) {
    const tokens = this._lastTokens || [];
    const headings = [];
    const walk = (list) => {
      for (const t of list || []) {
        if (t && t.type === 'heading') headings.push(t);
        if (t && t.tokens) walk(t.tokens);
      }
    };
    walk(tokens);
    const token = headings[Number(idx)];
    const src = this.sourceRef.current;
    if (!token || !src) return;
    const offset = src.value.indexOf(token.raw);
    if (offset < 0) return;
    const line = src.value.slice(0, offset).split('\n').length - 1;
    if (typeof this._scrollSourceToLine === 'function') this._scrollSourceToLine(line);
  }


  _setActiveOutlineItem(targetId) {
    const list = this.outlineListRef.current;
    if (!list) return;
    list.querySelectorAll('.outline-item').forEach((item) => {
      item.classList.toggle('is-active', item.dataset.outlineTarget === targetId);
    });
  }


  _syncActiveOutlineItem() {
    const preview = this.previewRef.current;
    if (!preview) return;
    const headings = Array.from(preview.querySelectorAll('h1,h2,h3,h4,h5,h6'));
    if (!headings.length) return;
    if (this._outlineJumpTarget) {
      this._setActiveOutlineItem(this._outlineJumpTarget);
      return;
    }
    if (preview.scrollTop + preview.clientHeight >= preview.scrollHeight - 8) {
      this._setActiveOutlineItem(headings[headings.length - 1].id);
      return;
    }
    const previewTop = preview.getBoundingClientRect().top;
    const marker = previewTop + 80;
    let active = headings[0];
    let distance = Math.abs(active.getBoundingClientRect().top - marker);
    headings.slice(1).forEach((heading) => {
      const nextDistance = Math.abs(heading.getBoundingClientRect().top - marker);
      if (nextDistance < distance) {
        active = heading;
        distance = nextDistance;
      }
    });
    this._setActiveOutlineItem(active.id);
  }


  toggleOutline(force) {
    this.outlineOpen = typeof force === 'boolean' ? force : !this.outlineOpen;
    const sidebar = this.documentSidebarRef.current;
    const button = this.outlineButtonRef.current;
    if (this.outlineOpen) {
      // 大纲已迁入左侧边栏「大纲」页签：打开时展开侧边栏并切页签
      if (sidebar) {
        sidebar.classList.remove('is-collapsed');
        sidebar.classList.add('is-mobile-open');
      }
      this._setSidebarTab('outline');
    }
    if (button) {
      button.classList.toggle('is-active', this.outlineOpen);
      button.setAttribute('aria-expanded', this.outlineOpen ? 'true' : 'false');
    }
    if (this.outlineOpen) this._syncActiveOutlineItem();
  }


  // ===== 分屏滚动同步（源码 ↔ 预览双向按比例） =====

  _initScrollSync() {
    const src = this.sourceRef.current, prev = this.previewRef.current;
    if (!src || !prev) return;
    this._scrollSyncSrc = src;
    this._scrollSyncPrev = prev;
    src.addEventListener('scroll', () => this._onScrollSync('source'), { passive: true });
    prev.addEventListener('scroll', () => this._onScrollSync('preview'), { passive: true });
  }


  _onScrollSync(from) {
    const now = Date.now();
    // 防回环：上次同步的被写方在窗口期内再滚动（即回写事件）直接忽略。
    // 新方向的滚动（用户操作/平滑动画帧）不受窗口影响，永远立即同步。
    if (this._lastSyncTo === from && this._lastSyncAt && now - this._lastSyncAt < 120) return;
    const src = this._scrollSyncSrc, prev = this._scrollSyncPrev;
    if (!src || !prev) return;
    const fromEl = from === 'source' ? src : prev;
    const toEl = from === 'source' ? prev : src;
    const fromMax = fromEl.scrollHeight - fromEl.clientHeight;
    if (fromMax <= 0) return;
    const toMax = toEl.scrollHeight - toEl.clientHeight;
    if (toMax <= 0) return;
    const ratio = Math.min(1, Math.max(0, fromEl.scrollTop / fromMax));
    toEl.scrollTop = ratio * toMax;
    this._lastSyncTo = toEl === src ? 'source' : 'preview';
    this._lastSyncAt = now;
  }


  _openPreviewLink(event) {
    const target = event.target && event.target.closest ? event.target.closest('a') : null;
    const preview = this.previewRef.current;
    if (!target || !preview || !preview.contains(target)) return;
    const rawHref = target.getAttribute('href') || '';
    if (!rawHref || /^\s*(javascript|data|vbscript):/i.test(rawHref)) {
      event.preventDefault();
      return;
    }
    event.preventDefault();
    if (rawHref.startsWith('#')) {
      const id = decodeURIComponent(rawHref.slice(1));
      const destination = id && document.getElementById(id);
      if (destination && preview.contains(destination)) {
        destination.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
      return;
    }
    try {
      const url = new URL(rawHref, window.location.href);
      // M4（B23）：桌面端外链经系统浏览器打开（Rust 校验 http/https），
      // 应用窗口不导航；浏览器端保持 window.open。
      if (tauriBridge && tauriBridge.openExternal && /^https?:$/.test(url.protocol)) {
        tauriBridge.openExternal(url.href).catch(() => {
          this._setStatus('无法打开链接 · ' + rawHref);
        });
      } else {
        window.open(url.href, '_blank', 'noopener,noreferrer');
      }
    } catch {
      this._setStatus('无法打开链接 · ' + rawHref);
    }
  }


  _updateCount() {
    const src = this.sourceRef.current;
    if (!src) return;
    const text = src.value || '';
    // M4（B22）：四项统计口径（见 statsMethods.ts，测试固化）
    this.countRef.current.textContent = formatStats(computeStats(text));
  }


  _touch() {
    this._setDirty(true);
    if (this._saveT) clearTimeout(this._saveT);
    this._saveT = setTimeout(() => this._autosave(), 600);
  }


  _setDirty(d) {
    this.dirty = d;
    if (this.dirtyDotRef.current) this.dirtyDotRef.current.style.background = d ? 'var(--accent)' : 'var(--text-4)';
  }


  _autosave() {
    const src = this.sourceRef.current;
    if (!src) return;
    this._persist();
    const t = new Date();
    const hh = String(t.getHours()).padStart(2, '0');
    const mm = String(t.getMinutes()).padStart(2, '0');
    this._setStatus('已自动保存草稿 · ' + hh + ':' + mm);
    // 打开了本地文件时，草稿同时写穿回本地（异步，不阻塞输入）。
    if (typeof this._maybeWriteThroughLocalFile === 'function') this._maybeWriteThroughLocalFile();
    // M5：同步活动标签（内容/dirty/标题）
    if (typeof this._syncActiveTabFromEditor === 'function') this._syncActiveTabFromEditor();
  }


  _setStatus(msg) { if (this.saveStatusRef.current) this.saveStatusRef.current.textContent = msg; }


  _applyFont() {
    const sourcePx = this.fontSize;
    const previewPx = this.previewFontSize != null ? this.previewFontSize : this.fontSize;
    const prev = this.previewRef.current, src = this.sourceRef.current;
    if (prev) prev.style.fontSize = previewPx + 'px';
    if (src) src.style.fontSize = sourcePx + 'px';
    if (this.fontSizeRef.current) this.fontSizeRef.current.textContent = sourcePx + 'px';
    const previewRef = this.previewFontSizeRef && this.previewFontSizeRef.current;
    if (previewRef) previewRef.textContent = previewPx + 'px';
    if (this.fullscreenFontSizeRef.current) this.fullscreenFontSizeRef.current.textContent = previewPx + 'px';
  }


  _setFont(px) {
    const clamped = Math.max(12, Math.min(28, px));
    this.fontSize = clamped;
    this.previewFontSize = clamped;
    this._applyFont();
    this._persist();
    this._setStatus('字号 ' + clamped + 'px');
  }

  _setSourceFont(px) {
    this.fontSize = Math.max(12, Math.min(28, px));
    this._applyFont();
    this._persist();
    this._setStatus('源码字号 ' + this.fontSize + 'px');
  }

  _setPreviewFont(px) {
    this.previewFontSize = Math.max(12, Math.min(28, px));
    this._applyFont();
    this._persist();
    this._setStatus('预览字号 ' + this.previewFontSize + 'px');
  }


  _setFileName(name) {
    this.fileName = name;
    if (this.fileNameRef.current) this.fileNameRef.current.textContent = name;
    if (typeof this._syncFileNameTooltip === 'function') this._syncFileNameTooltip();
    if (typeof this._updateFooterPath === 'function') this._updateFooterPath();
  }


  // ===== 本地草稿持久化（从 bridgeMethods 迁移，移除 bridge 同步） =====

  _persist() {
    const src = this.sourceRef.current;
    const savedAt = Date.now();
    this._draftSavedAt = savedAt;
    saveEditorState({
      content: src ? src.value : '',
      fileName: this.fileName,
      fontSize: this.fontSize,
      previewFontSize: this.previewFontSize,
      viewMode: this.viewMode,
      theme: this.theme,
      paperDark: this.paperDark || undefined,
      paperLight: this.paperLight || undefined,
      immersiveWide: this.immersiveWide || undefined,
      longImageWidth: this.longImageWidth || undefined,
      longImageMarks: this.longImageMarks === false ? false : undefined,
      typewriterActive: this.typewriterActive || undefined,
      fontFamily: this.fontFamily || undefined,
      comments: this.comments
    });
  }


  // ===== 底部文件路径显示 =====

  _updateFooterPath() {
    const el = this.footerPathRef && this.footerPathRef.current;
    if (!el) return;
    const path = this.localFilePath || '';
    el.textContent = path;
    el.title = path;
    if (el.classList) el.classList.toggle('has-path', !!path);
  }


  // ===== 文档侧栏（文件 | 大纲 两页签，Typora 风格） =====

  _setSidebarTab(name) {
    const sidebar = this.documentSidebarRef.current;
    if (!sidebar) return;
    sidebar.querySelectorAll('.sidebar-tab').forEach((tab) => {
      const on = tab.dataset.sidebarTab === name;
      tab.classList.toggle('is-active', on);
      tab.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    sidebar.querySelectorAll('.sidebar-panel').forEach((panel) => {
      panel.classList.toggle('is-active', panel.dataset.sidebarPanel === name);
    });
  }


  toggleDocumentSidebar() {
    const sidebar = this.documentSidebarRef.current;
    if (!sidebar) return;
    if (window.matchMedia && window.matchMedia('(max-width: 760px)').matches) {
      sidebar.classList.toggle('is-mobile-open');
    } else {
      sidebar.classList.toggle('is-collapsed');
    }
    // 展开侧边栏且停在「文件」页签时，渲染当前目录文件列表（折叠守卫会忽略这次调用）
    if (!sidebar.classList.contains('is-collapsed')) {
      const filesPanel = sidebar.querySelector('[data-sidebar-panel="files"]');
      if (filesPanel && filesPanel.classList.contains('is-active')
        && typeof this._renderCurrentDirFiles === 'function') {
        this._renderCurrentDirFiles();
      }
    }
  }


  closeDocumentSidebar() {
    const sidebar = this.documentSidebarRef.current;
    if (!sidebar) return;
    sidebar.classList.add('is-collapsed');
    sidebar.classList.remove('is-mobile-open');
  }

}